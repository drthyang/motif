// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Whether the cell MOTIF draws represents a magnetic file's propagation vector k (MATERIA's task, approved by the
 * user 2026-11-25). MOTIF draws the moments of one cell, repeated by its lattice translations. That is the structure
 * only when every translation t of the drawn cell leaves the modulation unchanged: k · t a whole number. For a
 * commensurate k written in its magnetic supercell this holds; for an incommensurate k (no finite supercell) written
 * in the parent cell it does not, and the figure shows only the amplitudes in the file, at one phase.
 *
 * k is read from the standard magCIF loop `_parent_propagation_vector.kxkykz` (as MATERIA and the Bilbao server write
 * it, e.g. "[0 0 0.2317]" or "[0 0 1/4]"), in the parent cell's reciprocal basis. The drawn cell's axes, in the parent
 * basis, come from `_parent_space_group.child_transform_Pp_abc` ("a,b,4c;0,0,0"); without it the drawn cell is the parent.
 * Superspace files (`_cell_wave_vector_*`) are refused earlier, by readCif. No modulation is drawn here.
 */

import type { Vec3 } from "./types";

/** Within this of a whole number, k · t counts as whole (k written to 4 decimals, as 0.3333 for 1/3, still reads as commensurate). */
const WHOLE = 2e-3;

/** A number written as a decimal or a fraction ("0.2317", "1/4", "-1/2"). */
function number(text: string): number | null {
  const t = text.trim();
  const f = /^([+-]?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (f) return Number(f[1]) / Number(f[2]);
  return t !== "" && Number.isFinite(Number(t)) ? Number(t) : null;
}

/** k from "[0 0 0.2317]", "(0, 0, 1/4)", "0 0 0.25". Null when it is not three numbers. */
export function parseK(text: string): Vec3 | null {
  const parts = text.replace(/[[\]()]/g, " ").split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const v = parts.map(number);
  return v.every((x) => x !== null) ? (v as unknown as Vec3) : null;
}

/** The drawn cell's axes in the parent basis, from "a,b,4c;0,0,0" or "a-b,a+b,2c" or "1/2a+1/2b,...". Null when unreadable. */
export function parseChildAxes(text: string): [Vec3, Vec3, Vec3] | null {
  const basis = text.split(";")[0]!.trim();
  const parts = basis.split(",");
  if (parts.length !== 3) return null;
  const axes = parts.map((p) => {
    const v = [0, 0, 0];
    const re = /([+-]?)\s*(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?)?\s*\*?\s*([abc])(?:\s*\/\s*(\d+))?/g;
    let seen = 0;
    for (let m = re.exec(p); m; m = re.exec(p)) {
      if (m[0].trim() === "") continue;
      const coefficient = (m[2] ? number(m[2]) ?? NaN : 1) / (m[4] ? Number(m[4]) : 1);
      v["abc".indexOf(m[3]!)]! += (m[1] === "-" ? -1 : 1) * coefficient;
      seen += m[0].length;
    }
    return seen > 0 && v.every(Number.isFinite) ? (v as unknown as Vec3) : null;
  });
  return axes.every((a) => a !== null) ? (axes as [Vec3, Vec3, Vec3]) : null;
}

/** True when the drawn cell (axes in the parent basis) repeats with k: k · t whole for each axis t. */
export function represents(k: Vec3, axes: readonly Vec3[]): boolean {
  return axes.every((t) => {
    const phase = k[0] * t[0] + k[1] * t[1] + k[2] * t[2];
    return Math.abs(phase - Math.round(phase)) < WHOLE;
  });
}

/** k as the warning names it: "(0, 0, 0.2317)". */
export const writeK = (k: Vec3): string => `(${k.map((x) => Number(x.toFixed(6))).join(", ")})`;
