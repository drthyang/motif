// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * PDB, Quantum ESPRESSO (pw.x input) and CASTEP (.cell) -> Structure.
 *
 * - PDB: CRYST1 (cell and space-group symbol) and ATOM / HETATM records (Cartesian angstrom in the PDB's standard
 *   axes: a along x, b in the xy plane, which are MOTIF's). A PDB file names its space group only by symbol, and
 *   MOTIF builds symmetry only from operations a file lists, so only a P 1 crystal is drawn as a crystal; any other
 *   file (or one without a real CRYST1) is drawn as the model it lists, with no cell.
 * - Quantum ESPRESSO: ibrav = 0 with CELL_PARAMETERS (alat, bohr or angstrom; alat from celldm(1) in bohr or A in
 *   angstrom), ATOMIC_SPECIES (label -> element) and ATOMIC_POSITIONS (crystal, angstrom, bohr or alat). Other
 *   ibrav values build the lattice by QE's own formulas and are refused.
 * - CASTEP: %BLOCK LATTICE_CART (angstrom, or bohr when the block says so) or LATTICE_ABC (in MOTIF's axes, as
 *   CASTEP places it), and POSITIONS_FRAC or POSITIONS_ABS. Symmetry operations in the file are not needed:
 *   CASTEP lists every atom of the cell.
 */

import { BOHR, elementOf, fractionalInCell, latticeFromVectors, LINES, moleculeStructure, numbers, p1Structure, words, type Atom, type Lattice } from "./lattice";
import type { Cell, Structure, Vec3 } from "./types";

export const isPdb = (fileName: string): boolean => /\.(pdb|ent)$/i.test(fileName);
export const isEspresso = (fileName: string, text: string): boolean => /\.(pwi|in|qe)$/i.test(fileName) && /&system/i.test(text);
export const isCastep = (fileName: string): boolean => /\.cell$/i.test(fileName);

export function readPdb(text: string, fileName = "structure.pdb"): Structure {
  let cell: Cell | null = null;
  let group = "";
  let title = "";
  const atoms: { element: string; cart: Vec3; label: string; occupancy: number }[] = [];
  for (const line of text.split(LINES)) {
    const record = line.slice(0, 6).trim().toUpperCase();
    if (record === "ENDMDL") break; // the first model only
    if (record === "TITLE" && !title) title = line.slice(10).trim();
    if (record === "CRYST1") {
      const v = [line.slice(6, 15), line.slice(15, 24), line.slice(24, 33), line.slice(33, 40), line.slice(40, 47), line.slice(47, 54)].map(Number);
      if (v.every(Number.isFinite)) cell = { a: v[0]!, b: v[1]!, c: v[2]!, alpha: v[3]!, beta: v[4]!, gamma: v[5]! };
      group = line.slice(55, 66).trim();
    }
    if (record === "ATOM" || record === "HETATM") {
      const p = [line.slice(30, 38), line.slice(38, 46), line.slice(46, 54)].map(Number);
      if (!p.every(Number.isFinite)) throw new Error(`An ${record} record has no coordinates: "${line.trim()}".`);
      const name = line.slice(12, 16).trim();
      // The element columns (77-78); older files leave them empty and the atom name starts with it.
      const symbol = line.slice(76, 78).trim() || name.replace(/^\d+/, "").slice(0, /^[A-Z][a-z]/.test(name) ? 2 : 1);
      const element = elementOf(symbol);
      if (!element) throw new Error(`Atom "${name}" names no element ("${symbol}").`);
      const occ = Number(line.slice(54, 60));
      atoms.push({ element, cart: p as unknown as Vec3, label: name || element, occupancy: Number.isFinite(occ) && line.slice(54, 60).trim() !== "" ? occ : 1 });
    }
  }
  const name = title || fileName.replace(/\.(pdb|ent)$/i, "");
  // CRYST1 1 1 1 90 90 90 P 1 is the PDB's way of saying "no cell".
  const realCell = cell && !(cell.a === 1 && cell.b === 1 && cell.c === 1);
  if (realCell && group.replace(/\s+/g, "").toUpperCase() === "P1") {
    return p1Structure(name, cell!, atoms.map((a) => ({ element: a.element, frac: fractionalInCell(cell!, a.cart), label: a.label, occupancy: a.occupancy })), "P1 (PDB, every atom listed)");
  }
  const why = realCell ? `space group ${group} not applied: a PDB file gives only its symbol` : "no cell";
  return moleculeStructure(name, atoms, `The model as listed (PDB; ${why}), drawn in a box with room around it`);
}

/** Blocks and namelists of a pw.x input: the card name with its option, and the lines under it. */
export function readEspresso(text: string, fileName = "pw.in"): Structure {
  const lines = text.split(LINES).map((l) => l.replace(/[!#].*/, "").trim());
  const joined = lines.join("\n");
  const value = (key: string): string | undefined => new RegExp(`\\b${key.replace(/[()]/g, "\\$&")}\\s*=\\s*([^,\\s/]+)`, "i").exec(joined)?.[1]?.replace(/['"]/g, "");
  const num = (key: string): number | undefined => {
    const v = value(key);
    return v === undefined ? undefined : Number(v.replace(/[dD]/, "e"));
  };
  const ibrav = num("ibrav");
  if (ibrav === undefined) throw new Error("The &SYSTEM namelist gives no ibrav.");
  if (ibrav !== 0) throw new Error(`ibrav = ${ibrav}: Quantum ESPRESSO builds this lattice by its own formulas, which MOTIF does not reproduce. Give the cell as ibrav = 0 with CELL_PARAMETERS.`);
  const celldm1 = num("celldm(1)");
  const aAngstrom = num("A");
  const alat = celldm1 !== undefined ? celldm1 * BOHR : aAngstrom;
  const card = (name: string): { option: string; rows: string[][] } | null => {
    const at = lines.findIndex((l) => l.toUpperCase().startsWith(name));
    if (at < 0) return null;
    const option = (/[({]?\s*(\w+)\s*[)}]?\s*$/.exec(lines[at]!.slice(name.length))?.[1] ?? "").toLowerCase();
    const rows: string[][] = [];
    for (let i = at + 1; i < lines.length; i++) {
      const l = lines[i]!;
      if (l === "" || /^[A-Z_]{6,}/.test(l) || l.startsWith("&") || l === "/") break;
      rows.push(words(l));
    }
    return { option, rows };
  };
  const unitOf = (option: string, what: string): number => {
    if (option === "bohr") return BOHR;
    if (option === "angstrom") return 1;
    if (option === "alat" || option === "") {
      if (alat === undefined) throw new Error(`${what} is in units of alat, but neither celldm(1) nor A is given.`);
      return alat;
    }
    throw new Error(`${what}: the unit "${option}" is not read.`);
  };
  const cellCard = card("CELL_PARAMETERS");
  if (!cellCard || cellCard.rows.length < 3) throw new Error("ibrav = 0 needs a CELL_PARAMETERS card with three vectors.");
  const scale = unitOf(cellCard.option, "CELL_PARAMETERS");
  const vectors = cellCard.rows.slice(0, 3).map((r, k) => {
    const v = numbers(r.slice(0, 3));
    if (!v || v.length !== 3) throw new Error(`CELL_PARAMETERS vector ${k + 1} must be three numbers.`);
    return v.map((x) => x * scale) as unknown as Vec3;
  });
  const lattice = latticeFromVectors(vectors);
  const species = new Map<string, string>();
  for (const r of card("ATOMIC_SPECIES")?.rows ?? []) {
    const label = r[0]!;
    const e = elementOf(label.split(/[_\-.\d]/)[0]!) ?? elementOf((r[2] ?? "").split(/[_\-.]/)[0]!);
    if (e) species.set(label, e);
  }
  const positions = card("ATOMIC_POSITIONS");
  if (!positions || positions.rows.length === 0) throw new Error("The input has no ATOMIC_POSITIONS card.");
  const atoms: Atom[] = positions.rows.map((r, i) => {
    const label = r[0]!;
    const element = species.get(label) ?? elementOf(label.split(/[_\-.\d]/)[0]!);
    if (!element) throw new Error(`Atom ${i + 1}: "${label}" is not in ATOMIC_SPECIES and names no element.`);
    const v = numbers(r.slice(1, 4));
    if (!v || v.length !== 3) throw new Error(`Atom ${i + 1} (${label}) must give three coordinates.`);
    const p = v as unknown as Vec3;
    const frac = positions.option === "crystal" ? p : lattice.toFractional(p.map((x) => x * unitOf(positions.option, "ATOMIC_POSITIONS")) as unknown as Vec3);
    return { element, frac, label: `${label}${i + 1}` };
  });
  return p1Structure(fileName.replace(/\.(pwi|in|qe)$/i, ""), lattice.cell, atoms, "P1 (Quantum ESPRESSO input, every atom listed)");
}

export function readCastep(text: string, fileName = "structure.cell"): Structure {
  const lines = text.split(LINES).map((l) => l.replace(/[!#].*/, "").trim());
  const block = (name: string): string[][] | null => {
    const start = lines.findIndex((l) => new RegExp(`^%block\\s+${name}\\b`, "i").test(l));
    if (start < 0) return null;
    const rows: string[][] = [];
    for (let i = start + 1; i < lines.length && !/^%endblock/i.test(lines[i]!); i++) if (lines[i]) rows.push(words(lines[i]!));
    return rows;
  };
  const unitRow = (rows: string[][]): number => {
    if (rows[0]?.length === 1 && /^[a-z]+$/i.test(rows[0][0]!)) {
      const u = rows.shift()![0]!.toLowerCase();
      if (u === "bohr" || u === "a0") return BOHR;
      if (u === "ang" || u === "angstrom") return 1;
      if (u === "nm") return 10;
      throw new Error(`The unit "${u}" is not read.`);
    }
    return 1;
  };
  let lattice: Lattice | null = null;
  let cell: Cell;
  const cart = block("lattice_cart");
  const abc = block("lattice_abc");
  if (cart) {
    const k = unitRow(cart);
    const vectors = cart.slice(0, 3).map((r, i) => {
      const v = numbers(r.slice(0, 3));
      if (!v || v.length !== 3) throw new Error(`LATTICE_CART vector ${i + 1} must be three numbers.`);
      return v.map((x) => x * k) as unknown as Vec3;
    });
    lattice = latticeFromVectors(vectors);
    cell = lattice.cell;
  } else if (abc) {
    const k = unitRow(abc);
    const v = numbers([...(abc[0] ?? []).slice(0, 3), ...(abc[1] ?? []).slice(0, 3)]);
    if (!v || v.length !== 6) throw new Error("LATTICE_ABC must give a b c, then alpha beta gamma.");
    cell = { a: v[0]! * k, b: v[1]! * k, c: v[2]! * k, alpha: v[3]!, beta: v[4]!, gamma: v[5]! };
  } else throw new Error("The .cell file has neither LATTICE_CART nor LATTICE_ABC.");
  const atomRows = (rows: string[][], toFrac: (p: Vec3) => Vec3, what: string): Atom[] =>
    rows.map((r, i) => {
      const element = elementOf(r[0]!.split(/[:_\-.\d]/)[0]!);
      if (!element) throw new Error(`${what} row ${i + 1}: "${r[0]}" is not an element symbol.`);
      const v = numbers(r.slice(1, 4));
      if (!v || v.length !== 3) throw new Error(`${what} row ${i + 1} must give three coordinates.`);
      return { element, frac: toFrac(v as unknown as Vec3) };
    });
  const fracRows = block("positions_frac");
  const absRows = block("positions_abs");
  let atoms: Atom[];
  if (fracRows) atoms = atomRows(fracRows, (p) => p, "POSITIONS_FRAC");
  else if (absRows) {
    const k = unitRow(absRows);
    const toFrac = (p: Vec3): Vec3 => {
      const q = p.map((x) => x * k) as unknown as Vec3;
      return lattice ? lattice.toFractional(q) : fractionalInCell(cell, q);
    };
    atoms = atomRows(absRows, toFrac, "POSITIONS_ABS");
  } else throw new Error("The .cell file has neither POSITIONS_FRAC nor POSITIONS_ABS.");
  return p1Structure(fileName.replace(/\.cell$/i, ""), cell, atoms, "P1 (CASTEP .cell, every atom listed)");
}
