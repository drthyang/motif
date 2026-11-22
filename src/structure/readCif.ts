/**
 * CIF text -> Structure (cell, symmetry operations, sites).
 * Site reading adapted from MATERIA (src/parsers/cif.ts), by the same author.
 */

import { cifText, findLoop, parseCifBlocks, parseCifNumber, BLOCK_NAME, type Loop } from "./cifSyntax";
import { elementFromLetters, elementsForLabel, formulaElements, labelUsesCase, type LabelContext } from "./elements";
import { composeOperations, operationKey, parseSymmetryOperation } from "./symmetry";
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
  const operations = texts.map(parseSymmetryOperation);
  for (const op of operations) {
    for (const row of op.rotation) {
      for (const v of row) {
        if (!Number.isInteger(v) || Math.abs(v) > 1) throw new Error(`Symmetry operation "${op.xyz}" is not a crystallographic operation.`);
      }
    }
  }

  const keys = new Set(operations.map(operationKey));
  if (keys.size !== operations.length) throw new Error("The file lists a symmetry operation twice.");
  if (!keys.has(operationKey(parseSymmetryOperation("x,y,z")))) throw new Error("The symmetry operations do not include the identity x,y,z.");
  for (const p of operations) {
    for (const q of operations) {
      if (!keys.has(operationKey(composeOperations(p, q)))) {
        throw new Error(
          `The symmetry operations in the file are not a complete group: "${p.xyz}" followed by "${q.xyz}" gives an operation that is not listed.`,
        );
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

/** Read the first data block that has atom positions. Throws a plain-language Error on anything it cannot read safely. */
export function readCif(text: string): Structure {
  const { items, loops } = parseCifBlocks(text);
  if (items.size === 0 && loops.length === 0) throw new Error("This does not look like a CIF file (no data block found).");
  const cell = readCell(items);
  const spaceGroupName = cifText(
    items.get("_space_group_name_h-m_alt") ?? items.get("_symmetry_space_group_name_h-m") ?? items.get("_space_group_name_hall") ?? items.get("_symmetry_space_group_name_hall"),
  );
  const operations = readOperations(items, loops, cifText(items.get("_space_group_name_h-m_alt") ?? items.get("_symmetry_space_group_name_h-m")));
  const sites = readSites(items, loops);
  const name =
    cifText(items.get("_chemical_name_mineral")) ??
    cifText(items.get("_chemical_name_common")) ??
    cifText(items.get("_chemical_formula_sum"))?.replace(/\s+/g, "") ??
    cifText(items.get(BLOCK_NAME)) ??
    "structure";
  return { name, cell, ...(spaceGroupName !== undefined ? { spaceGroupName } : {}), operations, sites };
}
