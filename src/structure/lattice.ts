// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * What the readers of other formats share: a cell from three lattice vectors, Cartesian to fractional
 * coordinates, a P1 structure from a list of atoms, and a molecule (atoms with no cell) placed in a box.
 *
 * Fractional coordinates do not depend on how a file orients its lattice in space, so MOTIF rebuilds the cell
 * from the vectors' lengths and angles in its own axes (a along x, b in the xy plane): the same crystal turned
 * rigidly. A left-handed set of vectors is refused, because that rebuild would draw the crystal mirrored.
 */

import { elementFromLetters, ELEMENT_SYMBOLS } from "./elements";
import { orthogonalizationMatrix } from "./cell";
import { parseSymmetryOperation } from "./symmetry";
import type { Cell, Mat3, Site, Structure, Vec3 } from "./types";

/** Angstrom in one bohr (CODATA 2018). */
export const BOHR = 0.529177210903;

/** A lattice whose volume is below this fraction of |a||b||c| is singular. */
const SINGULAR = 1e-8;

/** Space left around a molecule in its box, angstrom: copies in neighbouring boxes are then too far to bond. */
export const MOLECULE_PAD = 10;

const det3 = (m: Mat3): number =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

function inverse3(m: Mat3): Mat3 {
  const d = det3(m);
  const c = (r0: number, c0: number, r1: number, c1: number) => m[r0]![c0]! * m[r1]![c1]! - m[r0]![c1]! * m[r1]![c0]!;
  return [
    [c(1, 1, 2, 2) / d, -c(0, 1, 2, 2) / d, c(0, 1, 1, 2) / d],
    [-c(1, 0, 2, 2) / d, c(0, 0, 2, 2) / d, -c(0, 0, 1, 2) / d],
    [c(1, 0, 2, 1) / d, -c(0, 0, 2, 1) / d, c(0, 0, 1, 1) / d],
  ];
}

export interface Lattice {
  readonly cell: Cell;
  /** Fractional coordinates of a Cartesian point given in the file's own axes (the axes of its vectors). */
  readonly toFractional: (cart: Vec3) => Vec3;
}

/** The cell of three lattice vectors (rows, angstrom), with the conversion of the file's Cartesian points. */
export function latticeFromVectors(vectors: readonly Vec3[]): Lattice {
  if (vectors.length !== 3 || !vectors.every((v) => v.length === 3 && v.every(Number.isFinite))) throw new Error("The lattice must be three vectors of three finite numbers.");
  const m = vectors as unknown as Mat3;
  const length = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
  const d = det3(m);
  if (!(Math.abs(d) > SINGULAR * length(m[0]) * length(m[1]) * length(m[2]))) throw new Error("The lattice vectors are singular (zero cell volume).");
  if (d < 0) throw new Error("The lattice vectors form a left-handed set. MOTIF draws only right-handed axes, so this crystal would be drawn mirrored; it is not read.");
  const angle = (u: Vec3, v: Vec3) => (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (length(u) * length(v))))) * 180) / Math.PI;
  const cell: Cell = { a: length(m[0]), b: length(m[1]), c: length(m[2]), alpha: angle(m[1], m[2]), beta: angle(m[0], m[2]), gamma: angle(m[0], m[1]) };
  // cart = f . L (rows of L are the vectors), so f = cart . L^-1.
  const inv = inverse3(m);
  const toFractional = (p: Vec3): Vec3 => [0, 1, 2].map((j) => p[0] * inv[0][j]! + p[1] * inv[1][j]! + p[2] * inv[2][j]!) as unknown as Vec3;
  return { cell, toFractional };
}

/** Fractional coordinates of a Cartesian point in MOTIF's own axes for a cell (a along x, b in xy): PDB, CASTEP. */
export function fractionalInCell(cell: Cell, p: Vec3): Vec3 {
  const m = orthogonalizationMatrix(cell); // cart = M . f
  const inv = inverse3(m);
  return [0, 1, 2].map((i) => inv[i]![0]! * p[0] + inv[i]![1]! * p[1] + inv[i]![2]! * p[2]) as unknown as Vec3;
}

/**
 * The element a token names, strictly: a symbol in any case ("Fe", "FE"), optionally followed by a suffix after
 * "_", "/", "." or digits ("Fe_pv", "Fe1", "O2-"), or an atomic number ("26"). Undefined otherwise, so that "Ox"
 * is not read as oxygen.
 */
export function elementOf(token: string): string | undefined {
  const t = token.trim();
  if (/^\d+$/.test(t)) return ELEMENT_SYMBOLS[Number(t) - 1];
  const letters = /^[A-Za-z]+/.exec(t)?.[0];
  if (!letters || letters.length > 2) return undefined;
  const e = elementFromLetters(letters);
  return e !== undefined && e.length === letters.length ? e : undefined;
}

/** An atom as a reader found it. */
export interface Atom {
  readonly element: string;
  readonly frac: Vec3;
  readonly occupancy?: number;
  readonly label?: string;
}

/** A structure with no symmetry: each atom is its own site. */
export function p1Structure(name: string, cell: Cell, atoms: readonly Atom[], description: string): Structure {
  if (atoms.length === 0) throw new Error("The file holds no atoms.");
  const counts = new Map<string, number>();
  const sites: Site[] = atoms.map((a) => {
    const n = (counts.get(a.element) ?? 0) + 1;
    counts.set(a.element, n);
    return { label: a.label ?? `${a.element}${n}`, element: a.element, frac: a.frac, occupancy: a.occupancy ?? 1 };
  });
  return { name, cell, spaceGroupName: description, operations: [parseSymmetryOperation("x,y,z")], sites, magnetic: false };
}

/**
 * Atoms with no cell (a molecule), placed in an orthogonal box MOLECULE_PAD larger on every side than the atoms
 * span, so the whole molecule is in one cell and its copies in neighbouring boxes are too far away to bond.
 * The structure is marked as a molecule, so the page does not draw the box as a unit cell.
 */
export function moleculeStructure(name: string, atoms: readonly { element: string; cart: Vec3; label?: string; occupancy?: number }[], description: string): Structure {
  if (atoms.length === 0) throw new Error("The file holds no atoms.");
  const lo = [0, 1, 2].map((i) => Math.min(...atoms.map((a) => a.cart[i]!)));
  const hi = [0, 1, 2].map((i) => Math.max(...atoms.map((a) => a.cart[i]!)));
  const size = [0, 1, 2].map((i) => hi[i]! - lo[i]! + 2 * MOLECULE_PAD);
  const cell: Cell = { a: size[0]!, b: size[1]!, c: size[2]!, alpha: 90, beta: 90, gamma: 90 };
  const placed = atoms.map((a) => ({
    element: a.element,
    frac: [0, 1, 2].map((i) => (a.cart[i]! - lo[i]! + MOLECULE_PAD) / size[i]!) as unknown as Vec3,
    ...(a.label ? { label: a.label } : {}),
    ...(a.occupancy !== undefined ? { occupancy: a.occupancy } : {}),
  }));
  return { ...p1Structure(name, cell, placed, description), molecule: true };
}

/** Numbers of a line, or null when a token is not a number. */
export function numbers(tokens: readonly string[]): number[] | null {
  const out: number[] = [];
  for (const t of tokens) {
    const v = Number(t.replace(/[dD]/, "e"));
    if (t === "" || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

export const LINES = /\r\n|\r|\n/;
export const words = (line: string): string[] => line.trim().split(/\s+/).filter(Boolean);
