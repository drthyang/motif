import type { Cell, Mat3, Vec3 } from "./types";

const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * The matrix M with cartesian = M . fractional, in angstrom.
 * Convention (the usual one, also used by the PDB and by gemmi): a along x,
 * b in the xy plane, c* along z. The columns of M are the vectors a, b, c.
 */
export function orthogonalizationMatrix(cell: Cell): Mat3 {
  const { a, b, c } = cell;
  const ca = Math.cos(rad(cell.alpha));
  const cb = Math.cos(rad(cell.beta));
  const cg = Math.cos(rad(cell.gamma));
  const sg = Math.sin(rad(cell.gamma));
  const volume = cellVolume(cell);
  // An exact right angle gives cos = 6e-17 in floating point; keep those terms exactly zero.
  const z = (v: number): number => (Math.abs(v) < 1e-12 ? 0 : v);
  return [
    [a, z(b * cg), z(c * cb)],
    [0, b * sg, z((c * (ca - cb * cg)) / sg)],
    [0, 0, volume / (a * b * sg)],
  ];
}

/** Cell volume in cubic angstrom. */
export function cellVolume(cell: Cell): number {
  const ca = Math.cos(rad(cell.alpha));
  const cb = Math.cos(rad(cell.beta));
  const cg = Math.cos(rad(cell.gamma));
  return cell.a * cell.b * cell.c * Math.sqrt(1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg);
}

export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

export function mulMat(a: Mat3, b: Mat3): Mat3 {
  const r = [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!));
  return r as unknown as Mat3;
}

export function fractionalToCartesian(cell: Cell, frac: Vec3): Vec3 {
  return mulVec(orthogonalizationMatrix(cell), frac);
}

/** Spacing in angstrom of the lattice planes perpendicular to a*, b*, c*: the thickness of one cell along each axis. */
export function planeSpacings(cell: Cell): Vec3 {
  const m = orthogonalizationMatrix(cell);
  const col = (i: number): Vec3 => [m[0][i]!, m[1][i]!, m[2][i]!];
  const cross = (p: Vec3, q: Vec3): number => Math.hypot(p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]);
  const v = cellVolume(cell);
  return [v / cross(col(1), col(2)), v / cross(col(2), col(0)), v / cross(col(0), col(1))];
}
