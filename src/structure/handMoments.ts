// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Magnetic moments added by hand (the user's choice, 2026-11-24): each moment is stated, its size in Bohr magnetons
 * and its direction as a crystal direction [u v w], for the atoms of one element, optionally only those at a given
 * fractional coordinate along a, b or c. It is set on those atoms of one unit cell only; nothing is spread by symmetry,
 * so no magnetic order is assumed. The structure becomes its unit-cell contents (P1), marked as having moments by hand.
 *
 * MOTIF holds a moment as its components along the unit vectors of a, b, c (the mCIF "crystalaxis" form, see
 * readCif.ts). A direction [u v w] is the lattice vector u a + v b + w c; in a cell whose axes are not at right
 * angles these are not the same numbers, so the direction is turned into Cartesian, scaled to the size, and written
 * back as components along the unit vectors.
 */

import { orthogonalizationMatrix } from "./cell";
import { expandToUnitCell } from "./expand";
import { parseSymmetryOperation } from "./symmetry";
import type { Cell, Site, Structure, Vec3 } from "./types";

export interface MomentRule {
  /** The element whose atoms get this moment. */
  readonly element: string;
  /** Only the atoms at this fractional coordinate along a, b or c (within `tolerance`, default 0.02, modulo 1). */
  readonly where?: { readonly axis: "a" | "b" | "c"; readonly at: number; readonly tolerance?: number };
  /** The direction, as a crystal direction [u v w]. */
  readonly along: readonly [number, number, number];
  /** The size in Bohr magnetons (0 to 15). */
  readonly size: number;
}

/** A moment of `size` along the crystal direction [u v w], as components along the unit vectors of a, b, c. */
export function momentAlong(cell: Cell, uvw: readonly number[], size: number): Vec3 {
  const m = orthogonalizationMatrix(cell);
  const cart = [0, 1, 2].map((i) => m[i]![0]! * uvw[0]! + m[i]![1]! * uvw[1]! + m[i]![2]! * uvw[2]!);
  const length = Math.hypot(cart[0]!, cart[1]!, cart[2]!);
  if (!(length > 0)) throw new Error("The direction [0 0 0] has no direction.");
  const target = cart.map((x) => (x / length) * size);
  // The unit vectors along a, b, c are the columns of M divided by the cell edges; solve E m = target.
  const edges = [cell.a, cell.b, cell.c];
  const e = [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[i]![j]! / edges[j]!));
  return solve3(e, target as [number, number, number]);
}

function solve3(a: number[][], b: [number, number, number]): Vec3 {
  const det = (m: number[][]) =>
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const d = det(a);
  const column = (k: number) => a.map((row, i) => row.map((x, j) => (j === k ? b[i]! : x)));
  const clean = (x: number) => (Math.abs(x) < 1e-12 ? 0 : x);
  return [clean(det(column(0)) / d), clean(det(column(1)) / d), clean(det(column(2)) / d)];
}

/** The atoms of one unit cell as a P1 structure: each atom its own site (a shared site gives one site per element). */
export function cellContents(structure: Structure): Structure {
  const sites: Site[] = [];
  for (const atom of expandToUnitCell(structure).atoms) {
    for (const c of atom.components) {
      sites.push({
        label: atom.components.length > 1 ? `${atom.label}_${c.element}` : atom.label,
        element: c.element,
        frac: atom.frac,
        occupancy: c.occupancy,
        ...(atom.moment ? { moment: atom.moment } : {}),
      });
    }
  }
  const { distortion: _d, ...rest } = structure;
  void _d;
  return { ...rest, operations: [parseSymmetryOperation("x,y,z")], sites, spaceGroupName: `P1 (the unit cell of ${structure.spaceGroupName ?? "the file"})` };
}

const near = (x: number, at: number, tolerance: number) => {
  const d = (((x - at) % 1) + 1.5) % 1 - 0.5;
  return Math.abs(d) <= tolerance;
};

/**
 * The unit-cell contents with the stated moments. Later rules win where two match one atom. Throws, with the reason,
 * when a rule names an element not in the structure, matches no atom, or has an unusable size or direction.
 * Returns the structure and how many atoms each rule set.
 */
export function withHandMoments(structure: Structure, rules: readonly MomentRule[]): { structure: Structure; counts: number[] } {
  if (rules.length === 0) throw new Error("Give at least one moment.");
  const cell = cellContents(structure);
  const elements = [...new Set(cell.sites.map((s) => s.element))];
  const moments = rules.map((r, k) => {
    if (!elements.includes(r.element)) throw new Error(`Moment ${k + 1}: there is no ${r.element} in this structure (it has ${elements.join(", ")}).`);
    if (!(r.size >= 0 && r.size <= 15)) throw new Error(`Moment ${k + 1}: the size must be 0 to 15 μB.`);
    if (!(r.along.length === 3 && r.along.every(Number.isFinite) && r.along.some((x) => x !== 0))) throw new Error(`Moment ${k + 1}: the direction must be three numbers [u v w], not all zero.`);
    return momentAlong(structure.cell, r.along, r.size);
  });
  const counts = rules.map(() => 0);
  const axis = { a: 0, b: 1, c: 2 } as const;
  const sites = cell.sites.map((s) => {
    let moment: Vec3 | undefined;
    rules.forEach((r, k) => {
      if (r.element !== s.element) return;
      if (r.where && !near(s.frac[axis[r.where.axis]], r.where.at, r.where.tolerance ?? 0.02)) return;
      moment = moments[k]!;
      counts[k]!++;
    });
    if (moment) return { ...s, moment };
    const { moment: _m, ...plain } = s;
    void _m;
    return plain;
  });
  rules.forEach((r, k) => {
    if (counts[k] === 0) throw new Error(`Moment ${k + 1} (${r.element}${r.where ? ` at ${r.where.axis} = ${r.where.at}` : ""}) matches no atom of the cell.`);
  });
  return { structure: { ...cell, sites, magnetic: false, momentsByHand: true }, counts };
}
