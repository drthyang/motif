// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * VASP POSCAR / CONTCAR -> Structure (P1).
 *
 * Line 1 a comment; line 2 the scale: one number (a factor for the lattice and Cartesian positions, or, when
 * negative, the cell volume in cubic angstrom) or three (one factor per lattice direction); lines 3-5 the
 * lattice vectors; then the species names (VASP 5; a VASP 4 file without them is read only when its comment
 * line names one element per count) and the counts; optionally "Selective dynamics"; then "Direct" (fractional)
 * or a word starting with C or K (Cartesian, scaled like the lattice), and one line per atom.
 */

import { elementOf, latticeFromVectors, LINES, numbers, p1Structure, words, type Atom } from "./lattice";
import type { Structure, Vec3 } from "./types";

export function isPoscar(fileName: string): boolean {
  return /(^|[\\/])(POSCAR|CONTCAR)([._-][^\\/]*)?$/i.test(fileName) || /\.(vasp|poscar)$/i.test(fileName);
}

export function readPoscar(text: string, fileName = "POSCAR"): Structure {
  const lines = text.split(LINES);
  let at = 0;
  const next = (what: string): string => {
    if (at >= lines.length) throw new Error(`The POSCAR file ends before ${what}.`);
    return lines[at++]!;
  };
  const comment = next("the comment line").trim();
  const scaleWords = numbers(words(next("the scale line")));
  if (!scaleWords || !(scaleWords.length === 1 || scaleWords.length === 3)) throw new Error("Line 2 must be the scale: one number, or three.");
  const raw = [0, 1, 2].map((k) => {
    const v = numbers(words(next(`lattice vector ${k + 1}`)).slice(0, 3));
    if (!v || v.length !== 3) throw new Error(`Lattice vector ${k + 1} (line ${k + 3}) must be three numbers.`);
    return v as unknown as Vec3;
  });
  let vectors: Vec3[];
  // Cartesian positions are scaled as the lattice is: by the one factor, or by one factor per axis.
  let factors: Vec3 = [1, 1, 1];
  if (scaleWords.length === 3) {
    factors = scaleWords as unknown as Vec3;
    if (!scaleWords.every((s) => s > 0)) throw new Error("Three scale factors must all be positive.");
    vectors = raw.map((v) => [v[0] * scaleWords[0]!, v[1] * scaleWords[1]!, v[2] * scaleWords[2]!] as Vec3);
  } else {
    const s = scaleWords[0]!;
    if (s === 0) throw new Error("The scale cannot be zero.");
    let factor = s;
    if (s < 0) {
      // A negative scale is the wanted cell volume.
      const unscaled = Math.abs(latticeVolume(raw));
      factor = Math.cbrt(-s / unscaled);
    }
    vectors = raw.map((v) => v.map((x) => x * factor) as unknown as Vec3);
    factors = [factor, factor, factor];
  }
  const scaleCart = (p: Vec3): Vec3 => [p[0] * factors[0], p[1] * factors[1], p[2] * factors[2]];
  const lattice = latticeFromVectors(vectors);

  // Species names (VASP 5) or straight to the counts (VASP 4).
  let line = words(next("the species or the counts"));
  let names: string[];
  let counts = numbers(line);
  if (counts === null) {
    names = line;
    counts = numbers(words(next("the counts")));
    if (!counts) throw new Error("The line after the species names must be the number of atoms of each.");
  } else {
    names = words(comment);
    if (names.length !== counts.length || !names.every((n) => elementOf(n.split(/[_/.]/)[0]!))) {
      throw new Error("This POSCAR has no species names (VASP 4 style), and its comment line does not name one element per count. Add the names line above the counts.");
    }
  }
  if (names.length !== counts.length) throw new Error(`${names.length} species names but ${counts.length} counts.`);
  if (!counts.every((n) => Number.isInteger(n) && n >= 0)) throw new Error("The counts must be whole numbers.");
  const elements = names.map((n) => {
    // POTCAR names: "Fe_pv", "O_s", "Fe/abc123".
    const e = elementOf(n.split(/[_/.]/)[0]!);
    if (!e) throw new Error(`"${n}" is not an element symbol.`);
    return e;
  });

  line = words(next("the coordinate line"));
  if (/^s/i.test(line[0] ?? "")) line = words(next("the coordinate line")); // Selective dynamics
  const cartesian = /^[ck]/i.test(line[0] ?? "");
  if (!cartesian && !/^d/i.test(line[0] ?? "")) throw new Error(`Expected "Direct" or "Cartesian", found "${line.join(" ")}".`);

  const atoms: Atom[] = [];
  elements.forEach((element, k) => {
    for (let i = 0; i < counts![k]!; i++) {
      const p = numbers(words(next(`atom ${atoms.length + 1}`)).slice(0, 3));
      if (!p || p.length !== 3) throw new Error(`Atom ${atoms.length + 1} must start with three numbers (line ${at}).`);
      const v = p as unknown as Vec3;
      atoms.push({ element, frac: cartesian ? lattice.toFractional(scaleCart(v)) : v });
    }
  });
  const name = comment || fileName;
  return p1Structure(name, lattice.cell, atoms, "P1 (VASP POSCAR, every atom listed)");
}

function latticeVolume(v: readonly Vec3[]): number {
  const [a, b, c] = v as [Vec3, Vec3, Vec3];
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
}
