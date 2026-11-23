// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Symmetry operations: parsing Jones-Faithful strings ("x-y,x,1/2+z"), composing
 * and applying them. Adapted from MATERIA (src/core/crystal/symmetry.ts), by the same author.
 */

import type { Mat3, SymmetryOperation, Vec3 } from "./types";

function mulMat(a: Mat3, b: Mat3): Mat3 {
  const r = [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!));
  return r as unknown as Mat3;
}

function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Wrap a fractional coordinate triple into [0, 1). */
export function wrapFractional(a: Vec3): Vec3 {
  const w = (x: number): number => {
    const r = x - Math.floor(x);
    // A value a rounding error below 1 (2/3 + 1/3 in floating point) is 0.
    return r > 1 - 1e-9 ? 0 : r;
  };
  return [w(a[0]), w(a[1]), w(a[2])];
}

const AXES = ["x", "y", "z"] as const;

/** Parse a single component like "1/2+x-y" into a row [cx, cy, cz] and translation. */
function parseComponent(raw: string): { row: Vec3; translation: number } {
  // Normalize: remove spaces, ensure leading sign for tokenization.
  const s = raw.replace(/\s+/g, "").toLowerCase();
  const tokens = s.match(/[+-]?[^+-]+/g);
  if (!tokens) {
    throw new Error(`Cannot parse symmetry component: "${raw}"`);
  }
  const row: [number, number, number] = [0, 0, 0];
  let translation = 0;

  for (const token of tokens) {
    const axisIndex = AXES.findIndex((ax) => token.includes(ax));
    if (axisIndex >= 0) {
      // Coefficient on an axis, e.g. "-x", "+2x", "x".
      const coeffStr = token.replace(AXES[axisIndex]!, "").replace("*", "");
      let coeff: number;
      if (coeffStr === "" || coeffStr === "+") coeff = 1;
      else if (coeffStr === "-") coeff = -1;
      else coeff = parseFloat(coeffStr);
      row[axisIndex] = row[axisIndex]! + coeff;
    } else {
      // Pure translation, possibly a fraction like "1/2" or "-1/3".
      if (token.includes("/")) {
        const [num, den] = token.split("/");
        translation += parseFloat(num!) / parseFloat(den!);
      } else {
        translation += parseFloat(token);
      }
    }
  }
  return { row, translation };
}

/** Parse a Jones-Faithful string such as "x-y,x,1/2+z" into a SymmetryOperation. */
export function parseSymmetryOperation(xyz: string): SymmetryOperation {
  const parts = xyz.split(",");
  if (parts.length !== 3) {
    throw new Error(`Symmetry op must have 3 components: "${xyz}"`);
  }
  const parsed = parts.map(parseComponent);
  const rotation: Mat3 = [parsed[0]!.row, parsed[1]!.row, parsed[2]!.row];
  const translation: Vec3 = [
    parsed[0]!.translation,
    parsed[1]!.translation,
    parsed[2]!.translation,
  ];
  return { rotation, translation, xyz: xyz.replace(/\s+/g, "") };
}

/**
 * Parse a magnetic (BNS) operation string such as "-x,1/2+y,-z,-1": the first
 * three components are the spatial operation, the trailing ±1 is the
 * time-reversal flag.
 */
export function parseMagneticSymmetryOperation(xyz: string): SymmetryOperation {
  const parts = xyz.split(",");
  if (parts.length !== 4) {
    throw new Error(`Magnetic symmetry op must have 4 fields (x,y,z,±1): "${xyz}"`);
  }
  const spatial = parseSymmetryOperation(parts.slice(0, 3).join(","));
  const flag = parts[3]!.trim();
  const timeReversal: 1 | -1 = flag.startsWith("-") ? -1 : 1;
  // `xyz` keeps the SPATIAL string only — the flag lives in `timeReversal`,
  // matching generated ops (formatOperationXyz). Storing the 4-field string
  // here made the mCIF exporter (which appends the flag) emit "x,y,z,+1,+1"
  // and leaked ",+1" into nuclear symop loops.
  return { ...spatial, timeReversal };
}

/** Compose two operations: (a∘b)(x) = a(b(x)). Translations wrapped into [0,1). */
export function composeOperations(a: SymmetryOperation, b: SymmetryOperation): SymmetryOperation {
  const rotation = mulMat(a.rotation, b.rotation);
  const rb = mulVec(a.rotation, b.translation);
  const translation = wrapFractional([
    rb[0] + a.translation[0],
    rb[1] + a.translation[1],
    rb[2] + a.translation[2],
  ]);
  const timeReversal: 1 | -1 =
    ((a.timeReversal ?? 1) * (b.timeReversal ?? 1)) as 1 | -1;
  return { rotation, translation, xyz: formatOperationXyz(rotation, translation), timeReversal };
}

/** A canonical key (rotation + wrapped translation) for comparing operations modulo lattice translations. */
export function operationKey(op: SymmetryOperation): string {
  const t = wrapFractional(op.translation);
  const r = op.rotation.map((row) => row.map((v) => Math.round(v)).join(",")).join(";");
  // Translations compared in 24ths: covers 1/2, 1/3, 1/4, 1/6, 1/8, 1/12 and decimals such as 0.3333.
  const tt = t.map((v) => Math.round(v * 24) % 24).join(",");
  return `${r}|${tt}`;
}

const AXIS_NAMES = ["x", "y", "z"] as const;

/** Render a rotation+translation back to a Jones-Faithful string. */
export function formatOperationXyz(rotation: Mat3, translation: Vec3): string {
  const frac = (v: number): string => {
    if (Math.abs(v) < 1e-6) return "";
    const twelfths = Math.round(v * 12);
    const map: Record<number, string> = { 6: "1/2", 4: "1/3", 8: "2/3", 3: "1/4", 9: "3/4", 2: "1/6", 10: "5/6" };
    return map[((twelfths % 12) + 12) % 12] ?? v.toFixed(3);
  };
  return rotation
    .map((row, i) => {
      const parts: string[] = [];
      for (let j = 0; j < 3; j++) {
        const c = row[j]!;
        if (Math.abs(c) < 1e-6) continue;
        const sign = c < 0 ? "-" : parts.length ? "+" : "";
        const mag = Math.abs(c);
        parts.push(`${sign}${mag === 1 ? "" : mag}${AXIS_NAMES[j]}`);
      }
      const t = frac(translation[i]!);
      if (t) parts.push(`${parts.length ? "+" : ""}${t}`);
      return parts.join("") || "0";
    })
    .join(",");
}

/** Apply an operation to a fractional coordinate: x' = R·x + t (not wrapped). */
export function applyOperation(op: SymmetryOperation, pos: Vec3): Vec3 {
  const rotated = mulVec(op.rotation, pos);
  return [
    rotated[0] + op.translation[0],
    rotated[1] + op.translation[1],
    rotated[2] + op.translation[2],
  ];
}
