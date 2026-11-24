// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Coordination polyhedra (the user's choices, 2026-11-24): a bond rule can draw, round each of its centre atoms
 * inside the range, the convex hull of the neighbours it bonds that atom to (TiO6 octahedra, SiO4 tetrahedra).
 * Faces that lie in one plane are one face. Neighbours all in one plane give a flat polygon; fewer than three, nothing.
 */
import type { Vec3 } from "../structure/types";

/** Two corners closer to a face's plane than this (angstrom) lie in it. */
export const PLANE_TOLERANCE = 0.01;

/** A convex hull: its faces, each a list of indices into the points, anticlockwise seen from outside. */
export interface Hull {
  readonly faces: readonly (readonly number[])[];
  /** Outward unit normal of each face. */
  readonly normals: readonly Vec3[];
  /** True when every point lies in one plane: one face, seen from either side. */
  readonly flat: boolean;
}

const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p: Vec3, q: Vec3): number => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const unit = (p: Vec3): Vec3 => {
  const n = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / n, p[1] / n, p[2] / n];
};

/** The points of one plane, ordered anticlockwise about `normal` round their middle. */
function ordered(points: readonly Vec3[], members: readonly number[], normal: Vec3): number[] {
  const mid: Vec3 = [0, 1, 2].map((i) => members.reduce((s, m) => s + points[m]![i]!, 0) / members.length) as unknown as Vec3;
  const u = unit(sub(points[members[0]!]!, mid));
  const v = cross(normal, u);
  return [...members].sort((a, b) => {
    const [pa, pb] = [sub(points[a]!, mid), sub(points[b]!, mid)];
    return Math.atan2(dot(pa, v), dot(pa, u)) - Math.atan2(dot(pb, v), dot(pb, u));
  });
}

/**
 * The convex hull of a few points (a centre rarely has more than 12 neighbours, so every triple is tried as a
 * face). Null for fewer than three points or points on one line.
 */
export function convexHull(points: readonly Vec3[]): Hull | null {
  const n = points.length;
  if (n < 3) return null;
  const planes: { normal: Vec3; members: number[] }[] = [];
  const known = (members: readonly number[], normal: Vec3): boolean =>
    planes.some((p) => dot(p.normal, normal) > 1 - 1e-9 && members.every((m) => p.members.includes(m)));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    const raw = cross(sub(points[j]!, points[i]!), sub(points[k]!, points[i]!));
    const size = Math.hypot(raw[0], raw[1], raw[2]);
    if (size < 1e-6) continue; // three points on a line
    let normal = unit(raw);
    let above = 0;
    let below = 0;
    const members: number[] = [];
    for (let m = 0; m < n; m++) {
      const s = dot(normal, sub(points[m]!, points[i]!));
      if (Math.abs(s) <= PLANE_TOLERANCE) members.push(m);
      else if (s > 0) above++;
      else below++;
    }
    if (above > 0 && below > 0) continue; // points on both sides: not a face
    if (above === 0 && below === 0) {
      // Every point in one plane: a flat polygon.
      return { faces: [ordered(points, members, normal)], normals: [normal], flat: true };
    }
    if (above > 0) normal = [-normal[0], -normal[1], -normal[2]]; // outward is where no point lies
    if (!known(members, normal)) planes.push({ normal, members });
  }
  if (planes.length === 0) return null;
  return { faces: planes.map((p) => ordered(points, p.members, p.normal)), normals: planes.map((p) => p.normal), flat: false };
}

/** The edges of a hull as pairs of point indices (smaller first), each with the faces on its two sides. */
export function hullEdges(faces: readonly (readonly number[])[]): { a: number; b: number; faces: number[] }[] {
  const edges = new Map<string, { a: number; b: number; faces: number[] }>();
  faces.forEach((face, f) => {
    face.forEach((p, k) => {
      const q = face[(k + 1) % face.length]!;
      const [a, b] = p < q ? [p, q] : [q, p];
      const key = `${a}-${b}`;
      const edge = edges.get(key);
      if (edge) edge.faces.push(f);
      else edges.set(key, { a, b, faces: [f] });
    });
  });
  return [...edges.values()];
}
