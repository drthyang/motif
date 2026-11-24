// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Formats that list Cartesian positions in angstrom, with or without a cell -> Structure.
 *
 * - XYZ: the atom count, a comment line, then "element x y z" per atom. Extended XYZ gives the cell in the comment
 *   line (Lattice="ax ay az bx by bz cx cy cz") and the columns in Properties=species:S:1:pos:R:3:...; without
 *   a lattice the atoms are a molecule. Only the first frame of a file with several is read.
 * - XSF (XCrySDen): CRYSTAL (or SLAB, POLYMER) with PRIMVEC and PRIMCOORD; or ATOMS for a molecule.
 *   Animated XSF files are not read.
 * - FHI-aims geometry.in: "lattice_vector x y z" (three, or none for a molecule), "atom x y z El" (Cartesian)
 *   and "atom_frac x y z El".
 *
 * Elements are symbols or atomic numbers; anything else is refused rather than guessed.
 */

import { elementOf, latticeFromVectors, LINES, moleculeStructure, numbers, p1Structure, words, type Atom } from "./lattice";
import type { Structure, Vec3 } from "./types";

const element = (token: string, where: string): string => {
  const e = elementOf(token);
  if (!e) throw new Error(`"${token}" (${where}) is not an element symbol or atomic number.`);
  return e;
};

const three = (tokens: readonly string[], where: string): Vec3 => {
  const v = numbers(tokens.slice(0, 3));
  if (!v || v.length !== 3) throw new Error(`${where} must give three numbers.`);
  return v as unknown as Vec3;
};

export const isXyz = (fileName: string): boolean => /\.(xyz|extxyz)$/i.test(fileName);
export const isXsf = (fileName: string): boolean => /\.xsf$/i.test(fileName);
export const isAims = (fileName: string, text: string): boolean =>
  /(^|[\\/])geometry\.in(\.[^\\/]*)?$/i.test(fileName) || (/\.in$/i.test(fileName) && /^\s*atom(_frac)?\s/m.test(text) && !/&system/i.test(text));

/** The extended-XYZ key=value pairs of a comment line (values may be quoted). */
function keyValues(line: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /([A-Za-z_][\w-]*)\s*=\s*("([^"]*)"|'([^']*)'|\{([^}]*)\}|(\S+))/g;
  for (let m = re.exec(line); m; m = re.exec(line)) out.set(m[1]!.toLowerCase(), m[3] ?? m[4] ?? m[5] ?? m[6] ?? "");
  return out;
}

export function readXyz(text: string, fileName = "structure.xyz"): Structure {
  const lines = text.split(LINES);
  let first = 0;
  while (first < lines.length && lines[first]!.trim() === "") first++;
  const n = Number(lines[first]?.trim());
  if (!Number.isInteger(n) || n < 1) throw new Error("The first line of an XYZ file must be the number of atoms.");
  const comment = lines[first + 1] ?? "";
  const kv = keyValues(comment);
  // Columns: species and position, from Properties= when given, else the first four.
  let speciesAt = 0;
  let posAt = 1;
  const props = kv.get("properties");
  if (props) {
    const parts = props.split(":");
    let column = 0;
    for (let i = 0; i + 2 < parts.length; i += 3) {
      const [nameP, , countP] = [parts[i]!.toLowerCase(), parts[i + 1], Number(parts[i + 2])];
      if (nameP === "species") speciesAt = column;
      if (nameP === "pos") posAt = column;
      column += Number.isInteger(countP) ? countP : 1;
    }
  }
  const atoms: { element: string; cart: Vec3 }[] = [];
  for (let i = 0; i < n; i++) {
    const w = words(lines[first + 2 + i] ?? "");
    if (w.length < Math.max(speciesAt + 1, posAt + 3)) throw new Error(`The file declares ${n} atoms but atom ${i + 1} is missing or short.`);
    atoms.push({ element: element(w[speciesAt]!, `atom ${i + 1}`), cart: three(w.slice(posAt), `Atom ${i + 1}`) });
  }
  const name = fileName.replace(/\.(ext)?xyz$/i, "");
  const latticeText = kv.get("lattice");
  if (latticeText) {
    const v = numbers(words(latticeText));
    if (!v || v.length !== 9) throw new Error('Lattice="..." must hold nine numbers (a, b, c as three vectors).');
    const lattice = latticeFromVectors([v.slice(0, 3), v.slice(3, 6), v.slice(6, 9)] as unknown as Vec3[]);
    return p1Structure(name, lattice.cell, atoms.map((a) => ({ element: a.element, frac: lattice.toFractional(a.cart) })), "P1 (extended XYZ, every atom listed)");
  }
  return moleculeStructure(name, atoms, "No cell (XYZ): a molecule, drawn in a box with room around it");
}

export function readXsf(text: string, fileName = "structure.xsf"): Structure {
  const lines = text.split(LINES).map((l) => l.replace(/#.*/, "").trim());
  const find = (keyword: string) => lines.findIndex((l) => l.toUpperCase().startsWith(keyword));
  const name = fileName.replace(/\.xsf$/i, "");
  if (find("ANIMSTEPS") >= 0) throw new Error("Animated XSF files are not read; save one step.");
  const atomLine = (l: string, where: string) => {
    const w = words(l);
    return { element: element(w[0]!, where), cart: three(w.slice(1), where) };
  };
  const primvec = find("PRIMVEC");
  if (primvec >= 0) {
    const vectors = [1, 2, 3].map((k) => three(words(lines[primvec + k] ?? ""), `PRIMVEC vector ${k}`));
    const lattice = latticeFromVectors(vectors);
    const coord = find("PRIMCOORD");
    if (coord < 0) throw new Error("The XSF file has PRIMVEC but no PRIMCOORD block.");
    const n = Number(words(lines[coord + 1] ?? "")[0]);
    if (!Number.isInteger(n) || n < 1) throw new Error("PRIMCOORD must be followed by the number of atoms.");
    const atoms: Atom[] = [];
    for (let i = 0; i < n; i++) {
      const a = atomLine(lines[coord + 2 + i] ?? "", `PRIMCOORD atom ${i + 1}`);
      atoms.push({ element: a.element, frac: lattice.toFractional(a.cart) });
    }
    return p1Structure(name, lattice.cell, atoms, "P1 (XSF, every atom listed)");
  }
  const atomsAt = find("ATOMS");
  if (atomsAt < 0) throw new Error("The XSF file has neither a crystal (PRIMVEC, PRIMCOORD) nor a molecule (ATOMS).");
  const atoms = [];
  for (let i = atomsAt + 1; i < lines.length && lines[i] !== "" && /^\S+\s+[-+.\d]/.test(lines[i]!); i++) atoms.push(atomLine(lines[i]!, `ATOMS line ${i - atomsAt}`));
  return moleculeStructure(name, atoms, "No cell (XSF ATOMS): a molecule, drawn in a box with room around it");
}

export function readAims(text: string, fileName = "geometry.in"): Structure {
  const vectors: Vec3[] = [];
  const cart: { element: string; cart: Vec3 }[] = [];
  const frac: Atom[] = [];
  text.split(LINES).forEach((raw, i) => {
    const w = words(raw.replace(/#.*/, ""));
    if (w.length === 0) return;
    const key = w[0]!.toLowerCase();
    if (key === "lattice_vector") vectors.push(three(w.slice(1), `lattice_vector (line ${i + 1})`));
    else if (key === "atom") cart.push({ cart: three(w.slice(1), `atom (line ${i + 1})`), element: element(w[4] ?? "", `line ${i + 1}`) });
    else if (key === "atom_frac") frac.push({ frac: three(w.slice(1), `atom_frac (line ${i + 1})`), element: element(w[4] ?? "", `line ${i + 1}`) });
  });
  const name = fileName.replace(/\.in$/i, "");
  if (vectors.length === 0) {
    if (frac.length) throw new Error("atom_frac needs a cell, but the file has no lattice_vector lines.");
    return moleculeStructure(name, cart, "No cell (FHI-aims): a molecule, drawn in a box with room around it");
  }
  if (vectors.length !== 3) throw new Error(`A periodic geometry.in needs three lattice_vector lines, found ${vectors.length}.`);
  const lattice = latticeFromVectors(vectors);
  const atoms = [...cart.map((a) => ({ element: a.element, frac: lattice.toFractional(a.cart) })), ...frac];
  return p1Structure(name, lattice.cell, atoms, "P1 (FHI-aims geometry.in, every atom listed)");
}
