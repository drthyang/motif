// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * CIF text -> Structure (cell, symmetry operations, sites).
 * Site reading adapted from MATERIA (src/parsers/cif.ts), by the same author.
 */

import { parseChildAxes, parseK, represents } from "./propagation";
import { cifText, findLoop, parseCifBlocks, parseCifNumber, BLOCK_NAME, type Loop } from "./cifSyntax";
import { elementFromLetters, elementsForLabel, formulaElements, labelUsesCase, type LabelContext } from "./elements";
import { readDistortion, withDisplacements } from "./distortion";
import { composeOperations, operationKey, parseMagneticSymmetryOperation, parseSymmetryOperation } from "./symmetry";
import type { Cell, Site, Structure, SymmetryOperation, Vec3 } from "./types";

function readCell(items: Map<string, string>): Cell {
  const get = (key: string): number => {
    const v = items.get(key);
    if (v === undefined) throw new Error(`The file has no ${key}.`);
    return parseCifNumber(v);
  };
  const cell = {
    a: get("_cell_length_a"),
    b: get("_cell_length_b"),
    c: get("_cell_length_c"),
    alpha: get("_cell_angle_alpha"),
    beta: get("_cell_angle_beta"),
    gamma: get("_cell_angle_gamma"),
  };
  if (!(cell.a > 0 && cell.b > 0 && cell.c > 0)) throw new Error("The cell lengths must be positive.");
  for (const angle of [cell.alpha, cell.beta, cell.gamma]) {
    if (!(angle > 0 && angle < 180)) throw new Error("The cell angles must lie between 0 and 180 degrees.");
  }
  return cell;
}

/** The centring translations a lattice letter stands for (hexagonal axes for R). */
const CENTRING: Readonly<Record<string, readonly Vec3[]>> = {
  A: [[0, 0.5, 0.5]],
  B: [[0.5, 0, 0.5]],
  C: [[0.5, 0.5, 0]],
  I: [[0.5, 0.5, 0.5]],
  F: [[0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]],
};

/**
 * The operations listed in the file. MOTIF does not build a space group from
 * its symbol: a file without an operation list is refused rather than guessed.
 * The list is checked to be a complete group (identity present, no duplicates,
 * closed under composition) and to hold the centring its lattice letter says.
 */
function readOperations(items: Map<string, string>, loops: Loop[], spaceGroupName: string | undefined): SymmetryOperation[] {
  const loop = findLoop(loops, (h) =>
    h.some((k) => k.includes("space_group_symop_operation_xyz") || k.includes("symmetry_equiv_pos_as_xyz")),
  );
  let texts: string[] = [];
  if (loop) {
    const idx = loop.headers.findIndex((h) => h.toLowerCase().includes("xyz"));
    texts = loop.rows.map((row) => row[idx]!);
  } else {
    // A single operation may be written as a plain item (a P1 file).
    const single = cifText(items.get("_space_group_symop_operation_xyz") ?? items.get("_symmetry_equiv_pos_as_xyz"));
    if (single !== undefined) texts = [single];
  }
  if (texts.length === 0) {
    throw new Error(
      "The file lists no symmetry operations (_space_group_symop_operation_xyz or _symmetry_equiv_pos_as_xyz). " +
        "MOTIF does not yet build them from the space-group symbol alone.",
    );
  }
  return checkedGroup(texts.map(parseSymmetryOperation), spaceGroupName);
}

/** mCIF tags come in two spellings ("_space_group_symop_magn_operation.xyz" and "_space_group_symop.magn_operation_xyz"). */
const magTag = (tag: string): string => tag.toLowerCase().replace(/\./g, "_");

/**
 * The magnetic operations of an mCIF, or null for an ordinary CIF. An mCIF splits the magnetic
 * group over two loops, the operations and the centring translations (each with its time
 * reversal); the group is every product of one from each.
 */
function readMagneticOperations(loops: Loop[]): SymmetryOperation[] | null {
  const column = (needle: string): string[] | null => {
    const loop = findLoop(loops, (h) => h.some((k) => magTag(k).includes(needle)));
    if (!loop) return null;
    const idx = loop.headers.findIndex((h) => magTag(h).includes(needle));
    return loop.rows.map((row) => row[idx]!);
  };
  const operations = column("space_group_symop_magn_operation_xyz");
  if (!operations) return null;
  const centrings = column("space_group_symop_magn_centering_xyz") ?? ["x,y,z,+1"];
  const all: SymmetryOperation[] = [];
  for (const c of centrings.map(parseMagneticSymmetryOperation)) {
    for (const op of operations.map(parseMagneticSymmetryOperation)) all.push(composeOperations(c, op));
  }
  return checkedGroup(all, undefined);
}

/** Check that the operations are a complete group (see readOperations) and return them. */
function checkedGroup(operations: SymmetryOperation[], spaceGroupName: string | undefined): SymmetryOperation[] {
  for (const op of operations) {
    for (const row of op.rotation) {
      for (const v of row) {
        if (!Number.isInteger(v) || Math.abs(v) > 1) throw new Error(`Symmetry operation "${op.xyz}" is not a crystallographic operation.`);
      }
    }
  }

  const keys = new Set(operations.map(operationKey));
  if (keys.size !== operations.length) {
    throw new Error(
      operations.some((op) => op.timeReversal === -1)
        ? "The file lists a symmetry operation twice, or lists one both with and without time reversal (a non-magnetic, paramagnetic group)."
        : "The file lists a symmetry operation twice.",
    );
  }
  const reversal = new Map(operations.map((op) => [operationKey(op), op.timeReversal ?? 1]));
  if (!keys.has(operationKey(parseSymmetryOperation("x,y,z")))) throw new Error("The symmetry operations do not include the identity x,y,z.");
  for (const p of operations) {
    for (const q of operations) {
      const product = composeOperations(p, q);
      if (!keys.has(operationKey(product))) {
        throw new Error(
          `The symmetry operations in the file are not a complete group: "${p.xyz}" followed by "${q.xyz}" gives an operation that is not listed.`,
        );
      }
      if (reversal.get(operationKey(product)) !== (product.timeReversal ?? 1)) {
        throw new Error(`The time-reversal signs of the magnetic operations are inconsistent: "${p.xyz}" followed by "${q.xyz}" has the wrong sign in the list.`);
      }
    }
  }
  const letter = spaceGroupName?.trim().charAt(0).toUpperCase();
  for (const t of (letter !== undefined ? CENTRING[letter] : undefined) ?? []) {
    const key = operationKey({ rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: t, xyz: "" });
    if (!keys.has(key)) {
      throw new Error(
        `The space group "${spaceGroupName}" is ${letter}-centred, but the listed operations do not contain the centring translation (${t.join(", ")}).`,
      );
    }
  }
  return operations;
}

function elementOfType(type: string): string {
  const m = /^(\d+)?([A-Za-z]{1,2})(?![A-Za-z])/.exec(type.trim());
  const element = m ? elementFromLetters(m[2]!) : undefined;
  if (!m || element === undefined || element.length !== m[2]!.length) {
    throw new Error(`Atom type symbol "${type}" is not an element symbol.`);
  }
  return element;
}

function elementOfLabel(label: string, context: LabelContext): string {
  const found = elementsForLabel(label, context);
  if (found.length === 1) return found[0]!;
  if (found.length === 0) throw new Error(`There is no _atom_site_type_symbol and the label "${label}" names no element.`);
  throw new Error(`There is no _atom_site_type_symbol and the label "${label}" could be ${found.join(" or ")}.`);
}

function readSites(items: Map<string, string>, loops: Loop[]): Site[] {
  const loop = findLoop(loops, (h) => h.some((k) => k === "_atom_site_fract_x"));
  if (!loop) throw new Error("The file has no atom positions (_atom_site_fract_x).");
  const col = (name: string): number => loop.headers.findIndex((h) => h.toLowerCase() === name);
  const iLabel = col("_atom_site_label");
  const iType = col("_atom_site_type_symbol");
  const iX = col("_atom_site_fract_x");
  const iY = col("_atom_site_fract_y");
  const iZ = col("_atom_site_fract_z");
  const iOcc = col("_atom_site_occupancy");
  const iMult = col("_atom_site_site_symmetry_multiplicity") >= 0 ? col("_atom_site_site_symmetry_multiplicity") : col("_atom_site_symmetry_multiplicity");
  if (iY < 0 || iZ < 0) throw new Error("The atom list lacks _atom_site_fract_y or _atom_site_fract_z.");
  if (iLabel < 0 && iType < 0) throw new Error("The atom list has neither _atom_site_label nor _atom_site_type_symbol.");
  const formula = cifText(items.get("_chemical_formula_sum"));
  const context: LabelContext = {
    caseAware: iLabel >= 0 && loop.rows.some((r) => labelUsesCase(r[iLabel] ?? "")),
    ...(formula !== undefined ? { formula: formulaElements(formula) } : {}),
  };
  return loop.rows.map((row) => {
    const typeText = iType >= 0 ? cifText(row[iType]) : undefined;
    const element = typeText !== undefined ? elementOfType(typeText) : elementOfLabel(row[iLabel] ?? "", context);
    const occText = iOcc >= 0 ? cifText(row[iOcc]) : undefined;
    const multText = iMult >= 0 ? cifText(row[iMult]) : undefined;
    return {
      label: iLabel >= 0 ? row[iLabel]! : element,
      element,
      frac: [parseCifNumber(row[iX]!), parseCifNumber(row[iY]!), parseCifNumber(row[iZ]!)],
      occupancy: occText !== undefined ? parseCifNumber(occText) : 1,
      ...(multText !== undefined ? { statedMultiplicity: parseInt(multText, 10) } : {}),
    };
  });
}

/** Attach the moments of the file's moment list to the sites they name. */
function withMoments(sites: Site[], loops: Loop[]): Site[] {
  const loop = findLoop(loops, (h) => h.some((k) => magTag(k).includes("atom_site_moment_label")));
  if (!loop) return sites;
  const col = (needle: string): number => loop.headers.findIndex((h) => magTag(h).includes(needle));
  const [iLabel, iX, iY, iZ] = [col("atom_site_moment_label"), col("crystalaxis_x"), col("crystalaxis_y"), col("crystalaxis_z")];
  if (iX < 0 || iY < 0 || iZ < 0) {
    throw new Error("The moments in this file are not given along the crystal axes (_atom_site_moment.crystalaxis_x, _y, _z), the only form MOTIF reads.");
  }
  const moments = new Map<string, Vec3>();
  for (const row of loop.rows) {
    const number = (i: number): number => (cifText(row[i]) === undefined ? 0 : parseCifNumber(row[i]!));
    moments.set(row[iLabel]!, [number(iX), number(iY), number(iZ)]);
  }
  for (const label of moments.keys()) {
    if (!sites.some((s) => s.label === label)) throw new Error(`The moment list names "${label}", which is not in the atom list.`);
  }
  return sites.map((s) => {
    const m = moments.get(s.label);
    return m && (m[0] !== 0 || m[1] !== 0 || m[2] !== 0) ? { ...s, moment: m } : s;
  });
}

/**
 * The propagation vectors k a file names (`_parent_propagation_vector.kxkykz`, in a loop or alone; the DDL1 spelling
 * with "_kxkykz" too), and those the drawn cell does not represent (propagation.ts). Absent when the file names none,
 * or only k = 0.
 */
function readPropagation(items: Map<string, string>, loops: readonly { headers: string[]; rows: string[][] }[]): Structure["propagation"] | undefined {
  const tags = ["_parent_propagation_vector.kxkykz", "_parent_propagation_vector_kxkykz"];
  const texts: string[] = [];
  for (const t of tags) if (items.has(t)) texts.push(items.get(t)!);
  for (const l of loops) {
    const column = l.headers.findIndex((h) => tags.includes(h.toLowerCase()));
    if (column >= 0) for (const row of l.rows) if (row[column] !== undefined) texts.push(row[column]!);
  }
  if (texts.length === 0) return undefined;
  const vectors = texts.map((text) => {
    const k = parseK(text);
    if (!k) throw new Error(`The propagation vector "${text}" is not three numbers.`);
    return k;
  });
  if (vectors.every((k) => k.every((x) => x === 0))) return undefined;
  const transform = items.get("_parent_space_group.child_transform_pp_abc") ?? items.get("_parent_space_group_child_transform_pp_abc");
  const axes = transform ? parseChildAxes(transform) : ([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as [Vec3, Vec3, Vec3]);
  if (!axes) throw new Error(`The magnetic cell's transform "${transform}" could not be read.`);
  return { vectors, unrepresented: vectors.filter((k) => !represents(k, axes)) };
}

/** Read the first data block that has atom positions. Throws a plain-language Error on anything it cannot read safely. */
export function readCif(text: string): Structure {
  const { items, loops } = parseCifBlocks(text);
  if (items.size === 0 && loops.length === 0) throw new Error("This does not look like a CIF file (no data block found).");
  const cell = readCell(items);
  const spaceGroupName = cifText(
    items.get("_space_group_name_h-m_alt") ?? items.get("_symmetry_space_group_name_h-m") ?? items.get("_space_group_name_hall") ?? items.get("_symmetry_space_group_name_hall"),
  );
  if (items.has("_cell_modulation_dimension") || loops.some((l) => l.headers.some((h) => h.toLowerCase().startsWith("_cell_wave_vector")))) {
    throw new Error("This file describes a modulated (incommensurate) structure, which MOTIF cannot draw yet.");
  }
  const magneticOperations = readMagneticOperations(loops);
  const magnetic = magneticOperations !== null;
  const operations = magneticOperations ?? readOperations(items, loops, cifText(items.get("_space_group_name_h-m_alt") ?? items.get("_symmetry_space_group_name_h-m")));
  const sites = withMoments(readSites(items, loops), loops);
  const magneticName = cifText(items.get("_space_group_magn.name_bns") ?? items.get("_space_group_magn_name_bns") ?? items.get("_space_group.magn_name_bns"));
  const name =
    cifText(items.get("_chemical_name_mineral")) ??
    cifText(items.get("_chemical_name_common")) ??
    cifText(items.get("_chemical_formula_sum"))?.replace(/\s+/g, "") ??
    cifText(items.get(BLOCK_NAME)) ??
    "structure";
  const groupName = magnetic ? magneticName : spaceGroupName;
  const distortion = readDistortion(items, loops, sites);
  const propagation = readPropagation(items, loops);
  const structure: Structure = { name, cell, ...(groupName !== undefined ? { spaceGroupName: groupName } : {}), operations, sites, magnetic, ...(distortion ? { distortion } : {}), ...(propagation ? { propagation } : {}) };
  // An ISODISTORT file: every displacive mode at the amplitude the file gives.
  return withDisplacements(structure);
}
