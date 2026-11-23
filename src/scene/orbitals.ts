// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Atomic orbitals as the textbook angular picture (the user's choices, 2026-11-23): the surface
 *   r(theta, phi) = size x Y(theta, phi)^2 / max Y^2
 * of a real spherical harmonic Y, its lobes coloured by the sign of Y. The harmonics are written as polynomials in
 * the unit vector (x, y, z); their constant factors do not matter, since each surface is scaled to its own largest
 * lobe. The f set is the general one (real combinations of Y_3m, m = -3..3).
 *
 * x, y, z are MOTIF's cartesian axes (x along a, y in the a-b plane, z along c*) unless an orbital rule gives a local
 * frame: z along a crystal direction [u v w], and x along a second one (its part perpendicular to z).
 */

import { mulVec, orthogonalizationMatrix } from "../structure/cell";
import type { Cell, Mat3, Vec3 } from "../structure/types";

export interface OrbitalKind {
  readonly id: string;
  /** As written for people, e.g. "dx²−y²". */
  readonly label: string;
  /** 0 for s, 1 for p, 2 for d, 3 for f. */
  readonly l: number;
  /** The real harmonic, up to a constant factor, at a unit vector (x, y, z). */
  readonly y: (x: number, y: number, z: number) => number;
}

export const ORBITALS: readonly OrbitalKind[] = [
  { id: "s", label: "s", l: 0, y: () => 1 },
  { id: "px", label: "px", l: 1, y: (x) => x },
  { id: "py", label: "py", l: 1, y: (_x, y) => y },
  { id: "pz", label: "pz", l: 1, y: (_x, _y, z) => z },
  { id: "dxy", label: "dxy", l: 2, y: (x, y) => x * y },
  { id: "dyz", label: "dyz", l: 2, y: (_x, y, z) => y * z },
  { id: "dxz", label: "dxz", l: 2, y: (x, _y, z) => x * z },
  { id: "dx2-y2", label: "dx²−y²", l: 2, y: (x, y) => x * x - y * y },
  { id: "dz2", label: "dz²", l: 2, y: (_x, _y, z) => 3 * z * z - 1 },
  { id: "fz3", label: "fz³", l: 3, y: (_x, _y, z) => z * (5 * z * z - 3) },
  { id: "fxz2", label: "fxz²", l: 3, y: (x, _y, z) => x * (5 * z * z - 1) },
  { id: "fyz2", label: "fyz²", l: 3, y: (_x, y, z) => y * (5 * z * z - 1) },
  { id: "fxyz", label: "fxyz", l: 3, y: (x, y, z) => x * y * z },
  { id: "fz(x2-y2)", label: "fz(x²−y²)", l: 3, y: (x, y, z) => z * (x * x - y * y) },
  { id: "fx(x2-3y2)", label: "fx(x²−3y²)", l: 3, y: (x, y) => x * (x * x - 3 * y * y) },
  { id: "fy(3x2-y2)", label: "fy(3x²−y²)", l: 3, y: (x, y) => y * (3 * x * x - y * y) },
];

export const orbitalById = (id: string): OrbitalKind | undefined => ORBITALS.find((o) => o.id === id);

const unit = (v: readonly number[]): Vec3 => {
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  return [v[0]! / n, v[1]! / n, v[2]! / n];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * The orbital frame as three cartesian unit vectors [x, y, z]. Without a local z it is the identity (MOTIF's
 * axes). With a local z [u v w] (a crystal direction), x is the given x direction's part perpendicular to z, or,
 * without one, the part of a (or of b, when z lies along a) perpendicular to z; y completes a right-handed set.
 */
export function orbitalFrame(cell: Cell, z?: Vec3 | null, x?: Vec3 | null): Mat3 {
  if (!z) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const m = orthogonalizationMatrix(cell);
  const toCart = (uvw: Vec3): Vec3 => mulVec(m, uvw);
  const zc = unit(toCart(z));
  const flat = (v: Vec3): Vec3 | null => {
    const d = v[0] * zc[0] + v[1] * zc[1] + v[2] * zc[2];
    const p: Vec3 = [v[0] - d * zc[0], v[1] - d * zc[1], v[2] - d * zc[2]];
    return Math.hypot(...p) > 1e-6 * Math.hypot(...v) ? unit(p) : null;
  };
  const xc = (x ? flat(toCart(x)) : null) ?? flat(toCart([1, 0, 0])) ?? flat(toCart([0, 1, 0]))!;
  return [xc, cross(zc, xc), zc];
}

/** One face of an orbital's surface: its four corners (cartesian, angstrom, about the atom) and the sign of Y there. */
export interface OrbitalFace {
  readonly corners: readonly [Vec3, Vec3, Vec3, Vec3];
  readonly sign: 1 | -1;
}

/** Steps in theta (pole to pole) and phi (round the axis) of the surface mesh. */
export const MESH_THETA = 24;
export const MESH_PHI = 48;

/**
 * The surface r = size x Y^2 / max Y^2 as quadrilateral faces, in cartesian axes about the atom. `frame` holds the
 * orbital's x, y, z axes. Faces where the surface has shrunk to a point (on a node) are left out.
 */
export function orbitalSurface(kind: OrbitalKind, size: number, frame: Mat3): OrbitalFace[] {
  const dir = (t: number, p: number): Vec3 => [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)];
  // The largest Y^2 over the sphere, from a fine sampling (exact for s, p, d; within 0.1 % for f).
  let max = 0;
  for (let i = 0; i <= 90; i++) for (let j = 0; j < 180; j++) {
    const d = dir((Math.PI * i) / 90, (2 * Math.PI * j) / 180);
    max = Math.max(max, kind.y(d[0], d[1], d[2]) ** 2);
  }
  const [fx, fy, fz] = frame;
  const point = (t: number, p: number): { at: Vec3; value: number } => {
    const d = dir(t, p);
    const value = kind.y(d[0], d[1], d[2]);
    const r = (size * value * value) / max;
    // Local (x, y, z) -> cartesian: x fx + y fy + z fz.
    const at: Vec3 = [0, 1, 2].map((k) => r * (d[0] * fx[k]! + d[1] * fy[k]! + d[2] * fz[k]!)) as unknown as Vec3;
    return { at, value };
  };
  const faces: OrbitalFace[] = [];
  for (let i = 0; i < MESH_THETA; i++) {
    for (let j = 0; j < MESH_PHI; j++) {
      const [t0, t1] = [(Math.PI * i) / MESH_THETA, (Math.PI * (i + 1)) / MESH_THETA];
      const [p0, p1] = [(2 * Math.PI * j) / MESH_PHI, (2 * Math.PI * (j + 1)) / MESH_PHI];
      const q = [point(t0, p0), point(t0, p1), point(t1, p1), point(t1, p0)];
      const middle = point((t0 + t1) / 2, (p0 + p1) / 2);
      const extent = Math.max(...q.map((c) => Math.hypot(...c.at)));
      if (extent < 1e-3 * size) continue;
      faces.push({ corners: [q[0]!.at, q[1]!.at, q[2]!.at, q[3]!.at], sign: middle.value >= 0 ? 1 : -1 });
    }
  }
  return faces;
}
