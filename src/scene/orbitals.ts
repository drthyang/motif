// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Atomic orbitals, schematic (the user's choices, 2026-11-23). An orbital is the isosurface |psi| = iso x max|psi| of
 *   psi = R(r) Y(theta, phi),   R(r) = r^l exp(-r / n),   n = l + 1
 * (the lowest shell of each kind: 1s, 2p, 3d, 4f, hydrogen-like, r in units of the Bohr radius), with Y a real
 * spherical harmonic written as a polynomial in the unit vector (x, y, z); its constant factor does not matter.
 * The isovalue `iso` (0 to 1) sets the shape: low gives full, rounded lobes, high slim ones. The surface is then
 * scaled so its farthest point is at the chosen size from the atom's centre, and its lobes coloured by the sign of Y.
 * A surface depends only on the orbital and the isovalue, so it is computed once and kept (orbitalUnitSurface).
 * The f set is the general one (real combinations of Y_3m, m = -3..3).
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
  return orbitalFrameAbout(cell, mulVec(m, z), x ? mulVec(m, x) : null);
}

/** The same with z given as a cartesian direction (and x, if given, too); x and y follow as in `orbitalFrame`. */
export function orbitalFrameAbout(cell: Cell, z: Vec3, x?: Vec3 | null): Mat3 {
  const m = orthogonalizationMatrix(cell);
  const toCart = (uvw: Vec3): Vec3 => mulVec(m, uvw);
  const zc = unit(z);
  const flat = (v: Vec3): Vec3 | null => {
    const d = v[0] * zc[0] + v[1] * zc[1] + v[2] * zc[2];
    const p: Vec3 = [v[0] - d * zc[0], v[1] - d * zc[1], v[2] - d * zc[2]];
    return Math.hypot(...p) > 1e-6 * Math.hypot(...v) ? unit(p) : null;
  };
  const xc = (x ? flat(x) : null) ?? flat(toCart([1, 0, 0])) ?? flat(toCart([0, 1, 0]))!;
  return [xc, cross(zc, xc), zc];
}

/** One face of an orbital's surface: its four corners (cartesian, angstrom, about the atom), the sign of Y there, and a
 * direction out of the lobe there (away from the atom on its outer side, towards it on its inner side). */
export interface OrbitalFace {
  readonly corners: readonly [Vec3, Vec3, Vec3, Vec3];
  readonly sign: 1 | -1;
  readonly out: Vec3;
  /**
   * Which lobe the face belongs to (outer faces only; an inner face, inside its lobe, has none). A ring (the band of
   * dz², the cones of fz³) is cut into segments round its axis, each a lobe of its own, so its near part can be drawn
   * in front of the atom and its far part behind.
   */
  readonly lobe?: number;
  /** For a segment of a ring: which ring (its segments are drawn together, see the renderer). */
  readonly ring?: number;
}

/** Segments a ring-shaped lobe is cut into. */
export const RING_SEGMENTS = 12;

/** Steps in theta (pole to pole) and phi (round the axis) of the surface mesh. */
export const MESH_THETA = 40;
export const MESH_PHI = 80;
/** The isovalue a new orbital starts with: lobes of the familiar shape. */
export const DEFAULT_ISO = 0.3;

/** What is kept of one orbital at one isovalue: its unit surface, and what `orbitalField` needs. */
interface UnitData {
  readonly faces: OrbitalFace[];
  /** Distance of the farthest point before scaling to 1, in the units of R(r). */
  readonly farthest: number;
  /** The isovalue as a value of |Y| R, and the largest |Y| R. */
  readonly level: number;
  readonly top: number;
  /** For each mesh cell (theta row * MESH_PHI + phi column), the lobe of its outer face, or -1. */
  readonly cellLobe: Int32Array;
}

const unitSurfaces = new Map<string, UnitData>();

/**
 * The isosurface of one orbital at one isovalue, in its own axes, its farthest point at distance 1. Computed once
 * and kept: atoms, rules and redraws share it. Along each direction (theta, phi) the radial part R(r) rises from the
 * nucleus to its peak at r = l n and falls after it, so |psi| = c is met at most twice: on the lobe's inner side and on
 * its outer side (an s orbital has no inner side). Where |Y| is too small for any r, there is no lobe; at the rim of a
 * lobe both sides meet at the peak, which closes it.
 */
export function orbitalUnitSurface(kind: OrbitalKind, iso: number): OrbitalFace[] {
  return unitData(kind, iso).faces;
}

function unitData(kind: OrbitalKind, iso: number): UnitData {
  const key = `${kind.id}|${iso}`;
  const kept = unitSurfaces.get(key);
  if (kept) return kept;
  const l = kind.l;
  const n = l + 1;
  const radial = (r: number): number => r ** l * Math.exp(-r / n);
  const peak = l * n; // where R is largest (0 for s)
  const rMax = radial(peak);
  const dir = (t: number, p: number): Vec3 => [Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)];
  let yMax = 0;
  for (let i = 0; i <= 90; i++) for (let j = 0; j < 180; j++) {
    const d = dir((Math.PI * i) / 90, (2 * Math.PI * j) / 180);
    yMax = Math.max(yMax, Math.abs(kind.y(d[0], d[1], d[2])));
  }
  const level = Math.min(0.999, Math.max(0.001, iso)) * rMax * yMax;
  /** R(r) = target on the rising (inner) or falling (outer) side, by bisection. */
  const solve = (target: number, outer: boolean): number => {
    let [lo, hi] = outer ? [peak, peak + 60 * n] : [0, peak];
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      const above = radial(mid) > target;
      if (outer === above) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const corner = (t: number, p: number): { d: Vec3; rIn: number; rOut: number; value: number } => {
    const d = dir(t, p);
    const value = kind.y(d[0], d[1], d[2]);
    const a = Math.abs(value);
    if (a * rMax <= level) return { d, rIn: peak, rOut: peak, value }; // no lobe here: the rim closes at the peak
    const target = level / a;
    return { d, rIn: l === 0 ? 0 : solve(target, false), rOut: solve(target, true), value };
  };
  const grid: ReturnType<typeof corner>[][] = [];
  for (let i = 0; i <= MESH_THETA; i++) {
    const row: ReturnType<typeof corner>[] = [];
    for (let j = 0; j <= MESH_PHI; j++) row.push(corner((Math.PI * i) / MESH_THETA, (2 * Math.PI * j) / MESH_PHI));
    grid.push(row);
  }
  const at = (c: ReturnType<typeof corner>, r: number): Vec3 => [c.d[0] * r, c.d[1] * r, c.d[2] * r];
  const faces: { corners: [Vec3, Vec3, Vec3, Vec3]; sign: 1 | -1; out: Vec3; lobe?: number; ring?: number }[] = [];
  const outerAt = new Map<number, number>(); // cell i * MESH_PHI + j -> index of its outer face
  let farthest = 0;
  for (let i = 0; i < MESH_THETA; i++) {
    for (let j = 0; j < MESH_PHI; j++) {
      const q = [grid[i]![j]!, grid[i]![j + 1]!, grid[i + 1]![j + 1]!, grid[i + 1]![j]!];
      // A face only where the lobe is: at least one corner on it.
      if (q.every((c) => c.rOut === peak && c.rIn === peak)) continue;
      const mid = corner((Math.PI * (i + 0.5)) / MESH_THETA, (2 * Math.PI * (j + 0.5)) / MESH_PHI);
      const sign: 1 | -1 = mid.value >= 0 ? 1 : -1;
      outerAt.set(i * MESH_PHI + j, faces.length);
      faces.push({ corners: [at(q[0]!, q[0]!.rOut), at(q[1]!, q[1]!.rOut), at(q[2]!, q[2]!.rOut), at(q[3]!, q[3]!.rOut)], sign, out: mid.d });
      farthest = Math.max(farthest, ...q.map((c) => c.rOut));
      if (l > 0) {
        const inward: Vec3 = [-mid.d[0], -mid.d[1], -mid.d[2]];
        faces.push({ corners: [at(q[0]!, q[0]!.rIn), at(q[1]!, q[1]!.rIn), at(q[2]!, q[2]!.rIn), at(q[3]!, q[3]!.rIn)], sign, out: inward });
      }
    }
  }
  // Lobes: the outer faces joined edge to edge (phi wraps round) with the same sign.
  let lobes = 0;
  const seen = new Set<number>();
  for (const start of outerAt.keys()) {
    if (seen.has(start)) continue;
    const cells: number[] = [];
    const stack = [start];
    seen.add(start);
    const sign = faces[outerAt.get(start)!]!.sign;
    while (stack.length) {
      const cell = stack.pop()!;
      cells.push(cell);
      const [i, j] = [Math.floor(cell / MESH_PHI), cell % MESH_PHI];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = i + di;
        if (ni < 0 || ni >= MESH_THETA) continue;
        const next = ni * MESH_PHI + ((j + dj + MESH_PHI) % MESH_PHI);
        if (seen.has(next) || !outerAt.has(next) || faces[outerAt.get(next)!]!.sign !== sign) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    // A ring goes all the way round the axis without reaching either pole: cut it into segments.
    const columns = new Set(cells.map((c) => c % MESH_PHI));
    const rows = cells.map((c) => Math.floor(c / MESH_PHI));
    const ring = columns.size === MESH_PHI && Math.min(...rows) > 0 && Math.max(...rows) < MESH_THETA - 1;
    for (const c of cells) {
      const face = faces[outerAt.get(c)!]!;
      face.lobe = lobes + (ring ? Math.floor(((c % MESH_PHI) * RING_SEGMENTS) / MESH_PHI) : 0);
      if (ring) face.ring = lobes;
    }
    lobes += ring ? RING_SEGMENTS : 1;
  }
  const scaled = faces.map((f) => ({ ...f, corners: f.corners.map((c) => [c[0] / farthest, c[1] / farthest, c[2] / farthest]) as unknown as [Vec3, Vec3, Vec3, Vec3] }));
  const cellLobe = new Int32Array(MESH_THETA * MESH_PHI).fill(-1);
  for (const [cell, k] of outerAt) cellLobe[cell] = faces[k]!.lobe ?? -1;
  const data: UnitData = { faces: scaled, farthest, level, top: rMax * yMax, cellLobe };
  unitSurfaces.set(key, data);
  return data;
}

const placedSurfaces = new Map<string, OrbitalFace[]>();

/**
 * The surface at a given size (the farthest point's distance, angstrom) in a given frame (cartesian x, y, z axes).
 * Kept too (the last few hundred), so turning the view does not place it again.
 */
export function orbitalSurface(kind: OrbitalKind, size: number, frame: Mat3, iso: number = DEFAULT_ISO): OrbitalFace[] {
  const key = `${kind.id}|${iso}|${size}|${frame.flat().join(",")}`;
  const kept = placedSurfaces.get(key);
  if (kept) return kept;
  if (placedSurfaces.size > 300) placedSurfaces.clear();
  const placed = placeSurface(kind, size, frame, iso);
  placedSurfaces.set(key, placed);
  return placed;
}

function placeSurface(kind: OrbitalKind, size: number, frame: Mat3, iso: number): OrbitalFace[] {
  const [fx, fy, fz] = frame;
  const turn = (v: Vec3, k: number): Vec3 => [0, 1, 2].map((m) => k * (v[0] * fx[m]! + v[1] * fy[m]! + v[2] * fz[m]!)) as unknown as Vec3;
  return orbitalUnitSurface(kind, iso).map((f) => ({
    corners: f.corners.map((c) => turn(c, size)) as unknown as [Vec3, Vec3, Vec3, Vec3],
    sign: f.sign,
    out: turn(f.out, 1),
    ...(f.lobe !== undefined ? { lobe: f.lobe } : {}),
    ...(f.ring !== undefined ? { ring: f.ring } : {}),
  }));
}

/**
 * The orbital as a solid, for finding exactly where it lies in front of an atom. `value(x, y, z)` (cartesian,
 * angstrom, about the atom) is how far inside a lobe the point is, |psi| / level - 1: positive inside, zero on the
 * isosurface drawn, negative outside. `lobe(x, y, z)` is the lobe the point's direction belongs to, as the faces
 * number them (-1 where there is none). The size and frame are those of `orbitalSurface`.
 */
export function orbitalField(kind: OrbitalKind, size: number, frame: Mat3, iso: number = DEFAULT_ISO): { value: (x: number, y: number, z: number) => number; lobe: (x: number, y: number, z: number) => number } {
  const data = unitData(kind, iso);
  const [fx, fy, fz] = frame;
  const l = kind.l;
  const n = l + 1;
  const k = data.farthest / size;
  const centre = l === 0 ? data.top / data.level - 1 : -1;
  return {
    value: (x, y, z) => {
      const [u, v, w] = [x * fx[0] + y * fx[1] + z * fx[2], x * fy[0] + y * fy[1] + z * fy[2], x * fz[0] + y * fz[1] + z * fz[2]];
      const r = Math.sqrt(u * u + v * v + w * w);
      if (r < 1e-12) return centre;
      const rr = r * k;
      return (Math.abs(kind.y(u / r, v / r, w / r)) * rr ** l * Math.exp(-rr / n)) / data.level - 1;
    },
    lobe: (x, y, z) => {
      const [u, v, w] = [x * fx[0] + y * fx[1] + z * fx[2], x * fy[0] + y * fy[1] + z * fy[2], x * fz[0] + y * fz[1] + z * fz[2]];
      const r = Math.sqrt(u * u + v * v + w * w);
      if (r < 1e-12) return l === 0 ? 0 : -1;
      const i = Math.min(MESH_THETA - 1, Math.floor((Math.acos(Math.max(-1, Math.min(1, w / r))) / Math.PI) * MESH_THETA));
      const j = Math.min(MESH_PHI - 1, Math.floor((((Math.atan2(v, u) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI)) * MESH_PHI));
      return data.cellLobe[i * MESH_PHI + j]!;
    },
  };
}
