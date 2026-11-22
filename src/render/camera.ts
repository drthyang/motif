// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The view in terms a person can write down. The renderer still takes a rotation matrix (view.ts);
 * everything here converts between that matrix and
 *   - four numbers: which cell axis is up, turn, tilt, roll (degrees), and
 *   - crystal directions: "along [u v w]" or "normal to (h k l)", pointing at the viewer.
 * Conventions:
 *   turn  about the up axis; positive brings the front of the structure to the right;
 *   tilt  positive looks from above (the up axis leans towards the viewer); -90 to 90;
 *   roll  about the line of sight, applied last; positive turns the picture anticlockwise.
 * With roll 0 the chosen axis is exactly vertical on screen.
 */
import { mulMat, mulVec, orthogonalizationMatrix } from "../structure/cell";
import type { Cell, Mat3, Vec3 } from "../structure/types";
import { type View, viewFromAngles } from "./view";

const deg = (rad: number): number => (rad * 180) / Math.PI;
const rad = (degrees: number): number => (degrees * Math.PI) / 180;
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const transpose = (m: Mat3): Mat3 => [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
const rotZ = (t: number): Mat3 => [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];

export type Axis = 0 | 1 | 2;
export type Axes = readonly [Vec3, Vec3, Vec3];

/** The view as four numbers. */
export interface ViewNumbers {
  /** The cell axis that is vertical on screen when roll is 0: 0 = a, 1 = b, 2 = c. */
  readonly up: Axis;
  readonly turn: number;
  readonly tilt: number;
  readonly roll: number;
}

/** Unit vectors along the cell edges a, b, c, in cartesian axes. */
export function directAxes(cell: Cell): Axes {
  const m = orthogonalizationMatrix(cell);
  return [0, 1, 2].map((i) => unit([m[0][i]!, m[1][i]!, m[2][i]!])) as unknown as Axes;
}

/** The frame "right, depth, up" for a chosen up axis: the next axis in the cycle a, b, c, a points right (its part perpendicular to up). */
function frame(axes: Axes, up: Axis): Mat3 {
  const u = axes[up];
  const next = axes[(up + 1) % 3]!;
  const d = dot(u, next);
  const right = unit([next[0] - d * u[0], next[1] - d * u[1], next[2] - d * u[2]]);
  return [right, cross(u, right), u];
}

export function viewFromNumbers(axes: Axes, n: ViewNumbers): View {
  return mulMat(rotZ(rad(n.roll)), mulMat(viewFromAngles(n.turn, n.tilt), frame(axes, n.up)));
}

/**
 * The four numbers of a view, for a chosen up axis. Any view has such numbers. Looking exactly along the up
 * axis (tilt +-90), turn and roll are the same motion; the whole of it is then reported as turn, with roll 0.
 */
export function numbersFromView(axes: Axes, view: View, up: Axis): ViewNumbers {
  const m = mulMat(view, transpose(frame(axes, up))); // = rotZ(roll) . viewFromAngles(turn, tilt)
  const tilt = deg(Math.asin(Math.max(-1, Math.min(1, m[2][2]))));
  if (Math.abs(m[2][2]) > 1 - 1e-12) {
    return { up, turn: norm(deg(Math.atan2(-m[0][1], m[0][0]))), tilt: m[2][2] > 0 ? 90 : -90, roll: 0 };
  }
  const turn = deg(Math.atan2(-m[2][0], -m[2][1]));
  const r = mulMat(m, transpose(viewFromAngles(turn, tilt)));
  return { up, turn: norm(turn), tilt, roll: norm(deg(Math.atan2(r[1][0], r[0][0]))) };
}

/** An angle in degrees brought into (-180, 180], with -0 and rounding dust removed. */
function norm(a: number): number {
  let x = ((a % 360) + 360) % 360;
  if (x > 180) x -= 360;
  return Math.abs(x) < 1e-9 ? 0 : x;
}

const AXIS_NAMES = ["a", "b", "c"] as const;

/** The view written as one line, e.g. "c up · turn 23.4° · tilt 11.0° · roll 0.0°". */
export function writeView(n: ViewNumbers): string {
  const f = (x: number): string => (Math.abs(x) < 0.05 ? 0 : x).toFixed(1);
  return `${AXIS_NAMES[n.up]} up · turn ${f(n.turn)}° · tilt ${f(n.tilt)}° · roll ${f(n.roll)}°`;
}

/** Read a line written by writeView (or typed in the same form). Null when it cannot be read. */
export function readView(text: string): ViewNumbers | null {
  const up = /\b([abc])\s*up\b/i.exec(text);
  const get = (word: string): number | null => {
    const m = new RegExp(`${word}\\s*(-?\\d+(?:\\.\\d+)?)`, "i").exec(text);
    return m ? Number(m[1]) : null;
  };
  const [turn, tilt, roll] = [get("turn"), get("tilt"), get("roll")];
  if (!up || turn === null || tilt === null || Math.abs(tilt) > 90) return null;
  return { up: AXIS_NAMES.indexOf(up[1]!.toLowerCase() as "a") as Axis, turn, tilt, roll: roll ?? 0 };
}

// ---- crystal directions

/** A direction given by indices: a lattice vector [u v w], or the normal to the planes (h k l). */
export interface Direction {
  readonly kind: "uvw" | "hkl";
  readonly indices: Vec3;
}

/** The direction as a cartesian unit vector. [u v w] is u a + v b + w c; the normal to (h k l) is h a* + k b* + l c*. */
export function directionVector(cell: Cell, d: Direction): Vec3 {
  const m = orthogonalizationMatrix(cell);
  if (d.kind === "uvw") return unit(mulVec(m, d.indices));
  // Reciprocal vectors are the rows of the inverse of M (whose columns are a, b, c): a* = (b x c) / V, and so on.
  const col = (i: number): Vec3 => [m[0][i]!, m[1][i]!, m[2][i]!];
  const [a, b, c] = [col(0), col(1), col(2)];
  const star = [cross(b, c), cross(c, a), cross(a, b)]; // each divided by V, which only scales
  return unit([0, 1, 2].map((k) => d.indices[0] * star[0]![k]! + d.indices[1] * star[1]![k]! + d.indices[2] * star[2]![k]!) as unknown as Vec3);
}

export function writeDirection(d: Direction): string {
  const body = d.indices.map((x) => (Number.isInteger(x) ? String(x) : x.toFixed(2))).join(d.indices.every((x) => Number.isInteger(x) && Math.abs(x) < 10 && x >= 0) ? "" : " ");
  return d.kind === "uvw" ? `[${body}]` : `(${body})`;
}

/**
 * The view along a direction, the direction pointing at the viewer, with `upHint` as nearly upwards as it
 * can be (its part perpendicular to the line of sight). If the hint lies along the line of sight it cannot
 * say which way is up, and null is returned.
 */
export function viewAlong(towards: Vec3, upHint: Vec3): View | null {
  const t = unit(towards);
  const d = dot(upHint, t);
  const flat: Vec3 = [upHint[0] - d * t[0], upHint[1] - d * t[1], upHint[2] - d * t[2]];
  if (Math.hypot(flat[0], flat[1], flat[2]) < 1e-6 * Math.hypot(upHint[0], upHint[1], upHint[2])) return null;
  const up = unit(flat);
  return [cross(up, t), up, t];
}

/** The direction the viewer looks from: the cartesian unit vector that points out of the screen. */
export const towardsViewer = (view: View): Vec3 => view[2];

/** Low-index directions offered for naming and snapping: [u v w] and (h k l) normals with indices up to `max`, one per line through the origin's two senses each. */
export function lowIndexDirections(max = 2): Direction[] {
  const gcd = (p: number, q: number): number => (q === 0 ? Math.abs(p) : gcd(q, p % q));
  const out: Direction[] = [];
  for (const kind of ["uvw", "hkl"] as const) {
    for (let u = -max; u <= max; u++) for (let v = -max; v <= max; v++) for (let w = -max; w <= max; w++) {
      if (u === 0 && v === 0 && w === 0) continue;
      if (gcd(gcd(u, v), w) !== 1) continue;
      out.push({ kind, indices: [u, v, w] });
    }
  }
  // Simplest first: fewest non-zero indices, then smallest sum, lattice vectors before plane normals.
  const weight = (d: Direction): number => d.indices.reduce((s, x) => s + Math.abs(x) * 10 + (x !== 0 ? 100 : 0) + (x < 0 ? 1 : 0), 0) + (d.kind === "hkl" ? 0.5 : 0);
  return out.sort((p, q) => weight(p) - weight(q));
}

/** The low-index direction nearest the line of sight (pointing at the viewer), and how far off it is, in degrees. */
export function nearestDirection(cell: Cell, view: View, candidates: readonly Direction[] = lowIndexDirections()): { direction: Direction; angle: number } {
  const t = towardsViewer(view);
  let best = { direction: candidates[0]!, angle: Infinity };
  for (const d of candidates) {
    const angle = deg(Math.acos(Math.max(-1, Math.min(1, dot(directionVector(cell, d), t)))));
    // Candidates come simplest first: a later one must be clearly nearer to replace an earlier one.
    if (angle < best.angle - 1e-6) best = { direction: d, angle };
  }
  return best;
}

/** The rotation by `angle` (radians) about a unit axis. */
function about(axis: Vec3, angle: number): Mat3 {
  const [x, y, z] = axis;
  const [c, s, k] = [Math.cos(angle), Math.sin(angle), 1 - Math.cos(angle)];
  return [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ];
}

/**
 * The view turned by the smallest rotation that brings `direction` (cartesian, unit) exactly onto the line
 * of sight, pointing at the viewer. Used for snapping: the picture moves as little as possible.
 */
export function snapTo(view: View, direction: Vec3): View {
  const t = towardsViewer(view);
  const axis = cross(direction, t);
  const s = Math.hypot(axis[0], axis[1], axis[2]);
  if (s < 1e-12) return view;
  // Q takes `direction` to the present line of sight; the view after Q then has `direction` on the line of sight.
  return mulMat(view, about(unit(axis), Math.atan2(s, dot(direction, t))));
}

/** The view a fraction `f` (0 to 1) of the way from one view to another, turning about one fixed axis at an even rate. */
export function between(from: View, to: View, f: number): View {
  const r = mulMat(to, transpose(from)); // the rotation that takes `from` to `to`, in screen axes
  const angle = Math.acos(Math.max(-1, Math.min(1, (r[0][0] + r[1][1] + r[2][2] - 1) / 2)));
  if (angle < 1e-9) return to;
  let axis: Vec3 = [r[2][1] - r[1][2], r[0][2] - r[2][0], r[1][0] - r[0][1]];
  if (Math.hypot(axis[0], axis[1], axis[2]) < 1e-6) {
    // A half turn: the axis is the column of r + 1 with the largest diagonal entry.
    const k = [r[0][0], r[1][1], r[2][2]].indexOf(Math.max(r[0][0], r[1][1], r[2][2]));
    axis = [r[0][k]! + (k === 0 ? 1 : 0), r[1][k]! + (k === 1 ? 1 : 0), r[2][k]! + (k === 2 ? 1 : 0)];
  }
  return mulMat(about(unit(axis), angle * f), from);
}

/** The view seen from the opposite side: turned half way round about the screen's vertical. */
export const fromBehind = (view: View): View => mulMat([[-1, 0, 0], [0, 1, 0], [0, 0, -1]], view);
/** The picture turned by `degrees` anticlockwise about the line of sight. */
export const rolled = (view: View, degrees: number): View => mulMat(rotZ(rad(degrees)), view);
