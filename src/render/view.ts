/**
 * The view: a proper rotation (determinant +1) taking cartesian crystal axes to
 * screen axes. Screen x points right, y up, z towards the viewer; the projection
 * is orthographic (z is dropped). Because the matrix is always a rotation, never
 * a reflection, the drawing can never show a mirror image of the structure.
 */
import { mulMat } from "../structure/cell";
import type { Mat3, Vec3 } from "../structure/types";

export type View = Mat3;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Look at the crystal from azimuth `az` and elevation `el` (degrees), with the
 * cartesian z axis (c*) up on screen. At az = 0, el = 0 the x axis (a) points
 * right and the viewer looks along +y. Same convention as the slide scripts.
 */
export function viewFromAngles(az: number, el: number): View {
  const [sa, ca, se, ce] = [Math.sin(rad(az)), Math.cos(rad(az)), Math.sin(rad(el)), Math.cos(rad(el))];
  const right: Vec3 = [ca, -sa, 0];
  const up: Vec3 = [sa * se, ca * se, ce];
  const towardsViewer: Vec3 = [-sa * ce, -ca * ce, se];
  return [right, up, towardsViewer];
}

export const DEFAULT_VIEW: View = viewFromAngles(18, 12);

const rotX = (t: number): Mat3 => [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
const rotY = (t: number): Mat3 => [[Math.cos(t), 0, Math.sin(t)], [0, 1, 0], [-Math.sin(t), 0, Math.cos(t)]];

/** Make the rows orthonormal again (Gram-Schmidt), so rounding never builds up over many drags. */
function orthonormal(m: Mat3): Mat3 {
  const norm = (v: Vec3): Vec3 => {
    const n = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / n, v[1] / n, v[2] / n];
  };
  const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const r0 = norm(m[0]);
  const d = dot(m[1], r0);
  const r1 = norm([m[1][0] - d * r0[0], m[1][1] - d * r0[1], m[1][2] - d * r0[2]]);
  // The third row is the cross product of the first two: the determinant is exactly +1.
  const r2: Vec3 = [r0[1] * r1[2] - r0[2] * r1[1], r0[2] * r1[0] - r0[0] * r1[2], r0[0] * r1[1] - r0[1] * r1[0]];
  return [r0, r1, r2];
}

/**
 * Turn the crystal as if dragging its front surface: `right` radians about the
 * screen's vertical axis (front moves right), `down` radians about the screen's
 * horizontal axis (front moves down).
 */
export function dragView(view: View, right: number, down: number): View {
  return orthonormal(mulMat(mulMat(rotY(right), rotX(down)), view));
}

export function determinant(m: Mat3): number {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  );
}
