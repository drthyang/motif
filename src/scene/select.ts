// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/** Which atoms are shown: every atom whose fractional coordinates fall in a chosen range along a, b and c. */
import { expandToUnitCell } from "../structure/expand";
import type { CellAtom, Structure, Vec3 } from "../structure/types";

/**
 * "both": an atom on the boundary of the range is drawn at both ends (from <= x <= to), so one cell
 *         looks complete; an atom at a corner appears at all eight corners.
 * "once": each atom of the crystal appears once per cell (from <= x < to): the true cell content.
 */
export type BoundaryRule = "both" | "once";

export interface Range {
  /** Lower limits along a, b, c, in fractional coordinates. */
  readonly from: Vec3;
  /** Upper limits along a, b, c. */
  readonly to: Vec3;
  readonly boundary: BoundaryRule;
}

export const ONE_CELL: Range = { from: [0, 0, 0], to: [1, 1, 1], boundary: "both" };

/** An atom this close to a limit (in fractional units) counts as on it, so 0.9999 or 0.33333 in a file is not lost. */
export const BOUNDARY_TOLERANCE = 1e-3;
/**
 * In a cell folded from an RMC supercell, a site is an average of many copies and lands near, not on, a cell
 * edge (0.9988 for a site on the corner). There an atom within 0.01 of a limit counts as on it (the user's
 * choice, 2026-11-23); its position stays the measured average.
 */
export const FOLDED_BOUNDARY_TOLERANCE = 0.01;

/** The tolerance for a structure: wider for a folded RMC cell. */
export function boundaryTolerance(structure: Structure): number {
  return structure.rmc?.folded ? FOLDED_BOUNDARY_TOLERANCE : BOUNDARY_TOLERANCE;
}

/** More atoms than this is refused: the figure would be unreadable and the page slow. */
export const MAX_ATOMS = 100000;

export function checkRange(range: Range): void {
  for (let i = 0; i < 3; i++) {
    const [lo, hi] = [range.from[i]!, range.to[i]!];
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error("Every limit of the range must be a number.");
    if (hi < lo) throw new Error(`Along ${"abc"[i]}, "to" (${hi}) is below "from" (${lo}).`);
  }
}

export interface Selection {
  /** The atoms in the range; `frac` is the actual position, not wrapped into one cell. */
  readonly atoms: readonly CellAtom[];
  readonly warnings: readonly string[];
}

export function atomsInRange(structure: Structure, range: Range, limit: number = MAX_ATOMS): Selection {
  checkRange(range);
  const { atoms: cellAtoms, warnings } = expandToUnitCell(structure);
  const tol = boundaryTolerance(structure);
  // The whole-cell shifts n for which f + n lies in the range along axis i (f is in [0, 1)).
  const shifts = (f: number, i: number): number[] => {
    const lo = range.from[i]! - tol;
    const first = Math.ceil(lo - f);
    const out: number[] = [];
    for (let n = first; ; n++) {
      const x = f + n;
      const inside = range.boundary === "both" ? x <= range.to[i]! + tol : x < range.to[i]! - tol;
      if (!inside) break;
      out.push(n);
    }
    return out;
  };
  const atoms: CellAtom[] = [];
  for (const atom of cellAtoms) {
    const [na, nb, nc] = [shifts(atom.frac[0], 0), shifts(atom.frac[1], 1), shifts(atom.frac[2], 2)];
    if (atoms.length + na.length * nb.length * nc.length > limit) {
      throw new Error(`This range holds more than ${limit} atoms. Choose a smaller one.`);
    }
    for (const i of na) for (const j of nb) for (const k of nc) {
      atoms.push({ ...atom, frac: [atom.frac[0] + i, atom.frac[1] + j, atom.frac[2] + k] });
    }
  }
  return { atoms, warnings };
}
