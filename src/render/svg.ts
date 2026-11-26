// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Scene + view -> SVG text. This text is the figure: the screen shows it, the
 * SVG export saves it, and the PNG export rasterises it.
 */
import { mulVec } from "../structure/cell";
import { mixHex } from "../scene/elementStyle";
import { hullEdges } from "../scene/polyhedra";
import type { Material, OrbitalOutline, OrbitalTexture, Scene, StickStyle, Wedge } from "../scene/scene";
import { orbitalById, orbitalField, orbitalSurface, type OrbitalFace } from "../scene/orbitals";
import type { Vec3 } from "../structure/types";
import type { View } from "./view";

export interface Canvas {
  readonly width: number;
  readonly height: number;
  /** Empty space kept around the structure, in px. */
  readonly margin: number;
  /** Background colour, or null for a transparent figure. */
  readonly background: string | null;
  /**
   * The size of the figure on paper, if one is chosen. The SVG then states it (width="8.5cm"), and the
   * drawing's own units (`width` by `height`, which must have the same shape) are scaled to it.
   */
  readonly physical?: PhysicalSize | undefined;
}

export interface PhysicalSize {
  readonly width: number;
  readonly height: number;
  readonly unit: "cm" | "in";
}

export const DEFAULT_CANVAS: Canvas = { width: 1440, height: 1100, margin: 50, background: null };

/** Points per inch and per centimetre. */
export const PT_PER: Record<PhysicalSize["unit"], number> = { in: 72, cm: 72 / 2.54 };

/**
 * Points of the figure per unit of the drawing. With a size on paper this is exact. Without one the SVG's
 * width is in px, and one px is taken as one pt (as Keynote and Illustrator place an SVG).
 */
export function ptPerUnit(canvas: Canvas): number {
  const p = canvas.physical;
  return p ? (p.width * PT_PER[p.unit]) / canvas.width : 1;
}

/** A text size in units of the drawing: the size in pt if one is given, else the automatic size. */
export function textSize(pt: number | null | undefined, automatic: number, canvas: Canvas): number {
  return pt !== null && pt !== undefined && pt > 0 ? pt / ptPerUnit(canvas) : automatic;
}

/** Automatic text sizes, in units of the drawing (multiplied by the legend or axes size). */
export const LEGEND_FONT = 92;
export const AXES_FONT = 76;

/** Look of the parts that are not atoms. Lengths in angstrom scale with the drawing; px do not. */
export const BOND_COLOUR = "#b4bbc1";
/** Bond thickness in angstrom. */
export const BOND_WIDTH = 0.12;
/** A bond starts this fraction of the radius from each atom's centre: just under the surface, so no gap shows. */
export const BOND_START = 0.9;
/** Up to this many bonds are drawn as shaded rods; beyond it they are plain strokes, which draw much faster. */
export const BOND_ROD_LIMIT = 1500;
/** Cell edges are drawn in pieces at most this long, in angstrom. */
export const CELL_PIECE = 0.5;
/** Cell edges: near edges, all-dashed edges, and the paler far edges of the "depth" style. */
export const CELL_FRONT = "#7d8a93";
export const CELL_BACK = "#aab3ba";
export const CELL_FAR = "#c3cace";
export const CELL_STROKE = 'stroke="#aab3ba" stroke-width="4" stroke-dasharray="14 12"';

/** A sphere as drawn: centre and radius in px, depth in angstrom (larger = nearer the viewer). */
export interface DrawnSphere {
  readonly kind: "sphere";
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly depth: number;
  readonly style: string;
  readonly label: string;
}

/** A straight line as drawn (a bond or a cell edge), end points in px. */
export interface DrawnLine {
  readonly kind: "bond" | "cell";
  /** Bonds only. */
  readonly colour?: string;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Width in px (bonds only). */
  readonly width: number;
  readonly depth: number;
  /** Cell edges only: px from the start of the whole edge to this piece. */
  readonly along?: number;
  /** A bond drawn as a shaded rod: this half's shapes, ready to write (absent for a plain stroke). */
  readonly svg?: string;
  /** A plain-stroke bond that is dashed or dotted: its stroke-dasharray in px. */
  readonly dash?: string;
}

/**
 * The pieces of a dashed or dotted bond, as fractions of the bond from atom a: the visible length between the
 * two atoms' surfaces (from `from` to `to`) is filled with whole dashes (2.5 rod widths long, 1.5 apart) or dots
 * (one rod width across, one apart), stretched a little so the pattern starts and ends at the surfaces and looks
 * the same from either end. Solid: none.
 */
export function bondPieces(line: "solid" | "dashed" | "dotted", from: number, to: number, bondLength: number, rodWidth: number): [number, number][] {
  if (line === "solid" || to <= from) return [];
  const [dash, gap] = line === "dashed" ? [2.5 * rodWidth, 1.5 * rodWidth] : [rodWidth, rodWidth];
  const visible = (to - from) * bondLength;
  const n = Math.max(1, Math.round((visible + gap) / (dash + gap)));
  const k = visible / (n * dash + (n - 1) * gap);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const start = from + (i * (dash + gap) * k) / bondLength;
    out.push([start, start + (dash * k) / bondLength]);
  }
  return out;
}

/** One part of a moment arrow (see layoutAll): a length of the rod from (x1, y1) to (x2, y2), with the cone if it is the head's part. */
export interface DrawnArrow {
  readonly kind: "arrow";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly width: number;
  /** The head as three corners "x,y x,y x,y" (tip first); absent for a part of the tail half. */
  readonly head?: string;
  readonly depth: number;
  /** True for the part drawn over the sphere: the half of the rod that comes out of the sphere's face. */
  readonly front?: boolean;
  /** The part's shapes, ready to write. */
  readonly svg: string;
  /** The arrow's colour (for its outline). */
  readonly colour?: string;
}

/** A filled polygon, or a highlight band (several wide strokes drawn as one translucent shape). */
interface Shape<K extends string> {
  readonly kind: K;
  /** Polygon: its outline as SVG path data. Band: one "x1,y1 x2,y2" per segment. */
  readonly parts: readonly string[];
  readonly colour: string;
  readonly opacity: number;
  /** Band only: stroke width in px. */
  readonly width: number;
  readonly depth: number;
}

export type DrawnPolygon = Shape<"polygon">;

/** How far, in px, a filled triangle reaches under the atoms and bonds it is drawn behind. */
export const FILL_TUCK = 0.4;

/**
 * The outline of a filled polygon (a triangle of mutually bonded atoms) cut to the gap its atoms and bonds
 * leave, in screen px: each side runs parallel to its bond at half the bond's drawn width inside it, and at
 * each corner the outline follows the atom's round outline. The fill then meets every atom and bond exactly,
 * at any angle of view, and covers none of them. In an orthographic view a sphere is drawn as a circle of its
 * radius and a round rod as a band of constant width, so this is exact. Returns SVG path data, or null when
 * the polygon is seen edge on or its atoms and bonds leave no gap.
 */
export function fillOutline(corners: readonly { x: number; y: number; r: number }[], halfWidth: number): string | null {
  const n = corners.length;
  if (n < 3) return null;
  const area = corners.reduce((sum, p, i) => {
    const q = corners[(i + 1) % n]!;
    return sum + p.x * q.y - q.x * p.y;
  }, 0) / 2;
  if (Math.abs(area) < 1e-6) return null; // edge on
  const turn = area > 0 ? 1 : -1;
  // For each side i (corner i to corner i+1): direction, inward normal, length.
  const sides = corners.map((p, i) => {
    const q = corners[(i + 1) % n]!;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    const [dx, dy] = [(q.x - p.x) / length, (q.y - p.y) / length];
    // The inside lies to the left of each side for a positive area, to the right for a negative one.
    return { dx, dy, nx: -dy * turn, ny: dx * turn, length };
  });
  // Where the side, moved inward by halfWidth, leaves the outline of corner i (start) and meets that of corner i+1 (end).
  const ends = sides.map((s, i) => {
    const [p, q] = [corners[i]!, corners[(i + 1) % n]!];
    const along = (r: number): number => (r > halfWidth ? Math.sqrt(r * r - halfWidth * halfWidth) : 0);
    const [t0, t1] = [along(p.r), s.length - along(q.r)];
    return {
      ok: t1 > t0,
      start: { x: p.x + s.nx * halfWidth + s.dx * t0, y: p.y + s.ny * halfWidth + s.dy * t0 },
      end: { x: p.x + s.nx * halfWidth + s.dx * t1, y: p.y + s.ny * halfWidth + s.dy * t1 },
    };
  });
  if (ends.some((e) => !e.ok)) return null; // the atoms cover a whole side: no gap is left to fill
  let path = `M${n1(ends[0]!.start.x)},${n1(ends[0]!.start.y)}`;
  for (let i = 0; i < n; i++) {
    const e = ends[i]!;
    const next = ends[(i + 1) % n]!;
    const c = corners[(i + 1) % n]!;
    path += ` L${n1(e.end.x)},${n1(e.end.y)}`;
    if (c.r > halfWidth) {
      // Round the atom's outline, the short way: from where this side meets it to where the next side leaves it.
      const cross = (e.end.x - c.x) * (next.start.y - c.y) - (e.end.y - c.y) * (next.start.x - c.x);
      path += ` A${n1(c.r)},${n1(c.r)} 0 0 ${cross > 0 ? 1 : 0} ${n1(next.start.x)},${n1(next.start.y)}`;
    } else {
      path += ` L${n1(next.start.x)},${n1(next.start.y)}`;
    }
  }
  return `${path} Z`;
}
export type DrawnBand = Shape<"band">;

/** A marked bond angle: the outline of its sector "x,y x,y ...", and where its label goes. */
export interface DrawnSector {
  readonly kind: "sector";
  readonly points: string;
  /** The outer arc only, for the edge line. */
  readonly arc: string;
  readonly colour: string;
  readonly opacity: number;
  readonly depth: number;
  /** The angle to write, and where (px); absent when the label is off. */
  readonly label?: { readonly text: string; readonly x: number; readonly y: number };
}

/**
 * One drawn piece of an orbital (a lobe, a whole ring, or a whole meshed orbital), before it is placed among the
 * atoms: its gradients, its shapes, and the faces of its outer surface (about the atom's centre, angstrom), which
 * decide where it lies in front of an atom.
 */
interface OrbitalUnit {
  readonly depth: number;
  readonly defs: string;
  readonly body: string;
  readonly faces: readonly OrbitalFace[];
}

/** One face of an orbital's surface, shaded and ready to write. */
export interface DrawnOrbitalFace {
  readonly kind: "orbital";
  readonly depth: number;
  readonly svg: string;
}

/** A face or the edges of a coordination polyhedron, ready to write. */
export interface DrawnPolyhedronPart {
  readonly kind: "polyhedron";
  readonly depth: number;
  readonly svg: string;
}

export type Drawn = DrawnSphere | DrawnLine | DrawnArrow | DrawnPolygon | DrawnBand | DrawnSector | DrawnOrbitalFace | DrawnPolyhedronPart;

/** The light on polyhedron faces, in view space (right, up, towards the viewer): from the upper left and in front, as on the spheres. */
const FACE_LIGHT: Vec3 = (() => {
  const v: Vec3 = [-0.4, 0.6, 0.7];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
})();
const INK = "#1b1a18";
/**
 * Depth steps inside a polyhedron's unit, in angstrom: far smaller than any real gap between atoms, so the unit's
 * parts stay together, in order, at the depth of its centre. The centre atom and the bonds inside keep their own
 * order, squeezed by UNIT_SQUEEZE into the middle of the unit.
 */
const UNIT_STEP = 1e-5;
const UNIT_SQUEEZE = 1e-6;

/** Points of a lobe's outline. */
const LOBE_STEPS = 72;

/** The convex hull of points in the plane, anticlockwise (Andrew's monotone chain). */
export function convexHull(points: readonly (readonly [number, number])[]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p.map((q) => [q[0], q[1]]);
  const cross = (o: readonly number[], a: readonly number[], b: readonly number[]): number => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const lower: (readonly [number, number])[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: (readonly [number, number])[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((q) => [q[0], q[1]]);
}

/** `count` points spaced evenly along a closed polygon. */
function resampleClosed(poly: readonly (readonly [number, number])[], count: number): [number, number][] {
  const seg = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  const total = seg.reduce((sum, l) => sum + l, 0);
  const out: [number, number][] = [];
  let i = 0;
  let travelled = 0;
  for (let k = 0; k < count; k++) {
    const target = (k * total) / count;
    while (travelled + seg[i]! < target && i < poly.length - 1) travelled += seg[i++]!;
    const [a, b] = [poly[i]!, poly[(i + 1) % poly.length]!];
    const t = seg[i]! > 0 ? (target - travelled) / seg[i]! : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/**
 * The lobes of one orbital as smooth shapes. A lobe's outline, seen from the viewer, is found from the projected
 * points of its outer surface: round the projection of the lobe's centre, the farthest point in each of
 * LOBE_STEPS directions (a lobe is round enough, seen from any side, for this to be its outline), smoothed a little
 * and drawn as a closed curve. It is filled with a gradient lit from the upper left, as atoms are, and drawn at the
 * depth of its centre; where it meets an atom it is placed by `placeOrbital`.
 */
function orbitalLobes(
  faces: readonly OrbitalFace[],
  centre: Vec3,
  centreDepth: number,
  project: (p: Vec3) => Vec3,
  o: { readonly colours: readonly [string, string]; readonly opacity: number; readonly texture: OrbitalTexture },
  id: string,
  outline?: OrbitalOutline,
  sight?: OrbitalSight & { readonly key: string },
): OrbitalUnit[] {
  const lobes = new Map<number, { sign: 1 | -1; ring?: number; points: Vec3[]; faces: OrbitalFace[] }>();
  for (const f of faces) {
    if (f.lobe === undefined) continue;
    let lobe = lobes.get(f.lobe);
    if (!lobe) lobes.set(f.lobe, (lobe = { sign: f.sign, ...(f.ring !== undefined ? { ring: f.ring } : {}), points: [], faces: [] }));
    lobe.faces.push(f);
    // Neighbouring faces share their corners: the first corner of each face covers a large lobe's points once; a
    // small one (a segment of a ring) takes all four, to have enough.
    const corners = f.ring !== undefined ? f.corners : [f.corners[0]];
    for (const c of corners) lobe.points.push(project([centre[0] + c[0], centre[1] + c[1], centre[2] + c[2]]));
  }
  // Every lobe is drawn from its exact silhouette, the isosurface as seen (the user's choice, 2026-11-26), smooth
  // and true at any isovalue; its outline, when asked for, follows the same curve.
  const [ax0, ay0] = project(centre);
  const allPoints = [...lobes.values()].flatMap((l) => l.points);
  const silhouettes = sight && allPoints.length ? cachedSilhouettes(sight, [ax0, ay0], allPoints) : null;
  const out: OrbitalUnit[] = [];
  // Segments of a ring are drawn solid, in one see-through group, so they join without seams and do not darken
  // where they overlap.
  const ringParts = new Map<number, { depth: number; defs: string; svg: string; faces: OrbitalFace[]; xy: [number, number][]; base: string; fill: string; lobe: number }[]>();
  // The outline: one smooth closed path, over the lobe (not see-through, so it reads as a line).
  const stroke = (base: string): string => outline?.colour ?? mixHex(base, "#000000", 0.45);
  const outlinePath = (d: string, base: string): string =>
    outline ? `<path class="orbital-outline" d="${d}" fill="none" stroke="${stroke(base)}" stroke-width="${outline.width}" stroke-linejoin="round"/>` : "";
  // Each ring's centre and reach on screen, from all its segments' points, for its one gradient.
  const ringShade = new Map<number, [number, number, number]>();
  const ringWritten = new Set<number>();
  for (const lobe of lobes.values()) {
    if (lobe.ring === undefined || ringShade.has(lobe.ring)) continue;
    const all = [...lobes.values()].filter((x) => x.ring === lobe.ring).flatMap((x) => x.points);
    const [gx, gy] = [0, 1].map((i) => all.reduce((sum, p) => sum + p[i]!, 0) / all.length) as [number, number];
    ringShade.set(lobe.ring, [gx, gy, Math.max(...all.map((p) => Math.hypot(p[0] - gx, p[1] - gy)))]);
  }
  for (const [k, lobe] of lobes) {
    const pts = lobe.points;
    const [cx, cy, cz] = [0, 1, 2].map((i) => pts.reduce((sum, p) => sum + p[i]!, 0) / pts.length) as [number, number, number];
    // A lobe is drawn as its exact silhouette: the isosurface as seen, smooth, with the dent or gap at the nucleus
    // that the isosurface has (its radial part is zero there). It is no longer joined to the nucleus: at a high
    // isovalue that join drew a long cone the isosurface does not have (the user's choice, 2026-11-26). Without a
    // traced silhouette (a lobe too small to trace), the convex hull of its projected surface points.
    // A segment of a ring keeps the hull of its points; the ring as a whole is drawn from its silhouette below.
    const loops = silhouettes && lobe.ring === undefined ? silhouettes.loops(new Set([k])).filter((l) => l.length >= 3) : [];
    const hull = loops.length ? [] : convexHull(pts.map((p) => [p[0], p[1]] as const));
    if (!loops.length && hull.length < 3) continue;
    const xy = loops.length ? loops.flat() : resampleClosed(hull, LOBE_STEPS);
    const radius = Math.max(...xy.map((p) => Math.hypot(p[0] - cx, p[1] - cy)));
    if (!(radius > 0.3)) continue;
    const d = loops.length ? loops.map((l) => smoothClosed(l)).join(" ") : smoothClosed(xy);
    const evenOdd = loops.length > 1 ? ` fill-rule="evenodd"` : "";
    const base = lobe.sign > 0 ? o.colours[0] : o.colours[1];
    // A segment of a ring is shaded with one gradient for the whole ring (its centre and reach), so the ring reads
    // as one smooth band, not as a patchwork of segments each lit on its own.
    const shared = lobe.ring !== undefined ? ringShade.get(lobe.ring)! : null;
    const gid = shared ? `${id}-ring${lobe.ring}` : `${id}-${k}`;
    const [gx, gy, gr] = shared ?? [cx, cy, radius];
    const [hx, hy] = [gx - 0.35 * gr, gy - 0.4 * gr];
    let fill: string;
    let defs = "";
    if (o.texture === "flat") fill = base;
    else {
      const stops =
        o.texture === "glossy"
          ? `<stop offset="0" stop-color="${mixHex(base, "#ffffff", 0.85)}"/><stop offset="0.18" stop-color="${mixHex(base, "#ffffff", 0.3)}"/><stop offset="0.6" stop-color="${base}"/><stop offset="1" stop-color="${mixHex(base, "#000000", 0.45)}"/>`
          : `<stop offset="0" stop-color="${mixHex(base, "#ffffff", 0.45)}"/><stop offset="0.5" stop-color="${base}"/><stop offset="1" stop-color="${mixHex(base, "#000000", 0.3)}"/>`;
      // A ring's gradient is written once, with its first segment.
      const write = !shared || !ringWritten.has(lobe.ring!);
      if (shared) ringWritten.add(lobe.ring!);
      defs = write ? `<defs><radialGradient id="${gid}" gradientUnits="userSpaceOnUse" cx="${n1(hx)}" cy="${n1(hy)}" r="${n1(1.6 * gr)}">${stops}</radialGradient></defs>` : "";
      fill = `url(#${gid})`;
    }
    const opacity = o.opacity < 1 ? ` opacity="${o.opacity}"` : "";
    const edge = mixHex(base, "#000000", 0.3);
    if (lobe.ring !== undefined) {
      const all = ringParts.get(lobe.ring) ?? [];
      all.push({ depth: cz, defs, svg: `<path class="orbital-lobe" d="${d}" fill="${fill}" stroke="${fill}" stroke-width="0.6"/>`, faces: lobe.faces, xy, base, fill, lobe: k });
      ringParts.set(lobe.ring, all);
      continue;
    }
    out.push({ depth: cz, defs, body: `<path class="orbital-lobe" d="${d}" fill="${fill}"${evenOdd} stroke="${edge}" stroke-width="0.8" stroke-opacity="0.5"${opacity}/>${outlinePath(d, base)}`, faces: lobe.faces });
  }
  // A ring is drawn as one see-through layer at its atom's depth, so its near and far halves, which overlap at the
  // ring's ends seen from the side, never lie over one another.
  const opacity = o.opacity < 1 ? ` opacity="${o.opacity}"` : "";
  for (const parts of ringParts.values()) {
    const svg = parts.sort((p, q) => p.depth - q.depth).map((p) => p.svg).join("");
    const defs = parts.map((p) => p.defs).join("");
    const faces = parts.flatMap((p) => p.faces);
    if (silhouettes) {
      // With the outline, the ring is drawn as its silhouette: one smooth path (the hole cut out, even-odd), filled
      // as its segments are, and outlined along the same curves, so fill and outline agree.
      const loops = silhouettes.loops(new Set(parts.map((p) => p.lobe)));
      if (loops.length > 0) {
        const d = loops.map((loop) => smoothClosed(loop)).join(" ");
        out.push({ depth: centreDepth, defs, body: `<g class="orbital-ring"${opacity}><path class="orbital-lobe" d="${d}" fill="${parts[0]!.fill}" fill-rule="evenodd"/></g>${outlinePath(d, parts[0]!.base)}`, faces });
        continue;
      }
    }
    out.push({ depth: centreDepth, defs, body: `<g class="orbital-ring"${opacity}>${svg}</g>`, faces });
  }
  return out;
}

/** Grid step for tracing silhouettes, in units of the drawing; samples along each line of sight; outline spacing. */
const SILHOUETTE_GRID = 1.5;
const SILHOUETTE_SAMPLES = 64;
const SILHOUETTE_POINT = 3;

/** What an orbital's silhouettes are traced from: the orbital as a solid, and how it is seen. */
export interface OrbitalSight {
  readonly field: { value: (x: number, y: number, z: number) => number; lobe: (x: number, y: number, z: number) => number };
  /** The orbital's reach from its atom, angstrom. */
  readonly size: number;
  readonly view: View;
  /** Px per angstrom. */
  readonly scale: number;
}

/**
 * The silhouettes of an orbital's lobes as seen (for the outline, the user's choice "A", 2026-11-26), traced from
 * the orbital as a solid rather than from its mesh: on a grid over its place on screen (`atom` is its atom on
 * screen, `box` its extent), the largest value of |psi| / level - 1 along each line of sight, kept for each lobe
 * apart. `loops(lobes)` gives where the largest over those lobes crosses zero, by marching squares (so between grid
 * points by interpolation, not in steps), as closed loops spaced evenly: a lobe's outline, or a ring's outer edge
 * and, where its hole shows, its inner edge.
 */
export function orbitalSilhouettes(sight: OrbitalSight, atom: readonly [number, number], box: readonly [number, number, number, number]): { loops: (lobes: ReadonlySet<number>) => [number, number][][] } {
  const { field, size, view, scale } = sight;
  const [x0, y0] = [box[0] - 3 * SILHOUETTE_GRID, box[1] - 3 * SILHOUETTE_GRID];
  const span = Math.max(box[2] - box[0], box[3] - box[1]) + 6 * SILHOUETTE_GRID;
  const n = Math.min(320, Math.ceil(span / SILHOUETTE_GRID) + 1);
  const step = span / (n - 1);
  const [vx, vy, vz] = view;
  const grids = new Map<number, Float64Array>();
  const gridOf = (lobe: number): Float64Array => {
    let g = grids.get(lobe);
    if (!g) grids.set(lobe, (g = new Float64Array(n * n).fill(FRONT_FLOOR)));
    return g;
  };
  const best = new Map<number, number>();
  for (let i = 1; i < n - 1; i++) {
    for (let j = 1; j < n - 1; j++) {
      // The point in view axes about the atom (screen y runs down), and its line of sight through the orbital.
      const [x, y] = [(x0 + i * step - atom[0]) / scale, -(y0 + j * step - atom[1]) / scale];
      const side = Math.hypot(x, y);
      if (side >= size) continue;
      const half = Math.sqrt(size * size - side * side);
      const px = x * vx[0] + y * vy[0], py = x * vx[1] + y * vy[1], pz = x * vx[2] + y * vy[2];
      best.clear();
      for (let k = 0; k <= SILHOUETTE_SAMPLES; k++) {
        const z = -half + (2 * half * k) / SILHOUETTE_SAMPLES;
        const [qx, qy, qz] = [px + z * vz[0], py + z * vz[1], pz + z * vz[2]];
        const f = field.value(qx, qy, qz);
        if (f <= FRONT_FLOOR) continue;
        const lobe = field.lobe(qx, qy, qz);
        if (lobe < 0) continue;
        if (f > (best.get(lobe) ?? -Infinity)) best.set(lobe, f);
      }
      for (const [lobe, f] of best) gridOf(lobe)[i * n + j] = f;
    }
  }
  return {
    loops: (lobes) => {
      const v = new Float64Array(n * n).fill(FRONT_FLOOR);
      for (const lobe of lobes) {
        const g = grids.get(lobe);
        if (g) for (let k = 0; k < n * n; k++) if (g[k]! > v[k]!) v[k] = g[k]!;
      }
      return contourLoops(v, n).map((loop) => {
        const xy = loop.map(([i, j]) => [x0 + i * step, y0 + j * step] as [number, number]);
        const length = xy.reduce((sum, p, k) => sum + Math.hypot(p[0] - xy[(k + 1) % xy.length]![0], p[1] - xy[(k + 1) % xy.length]![1]), 0);
        return resampleClosed(xy, Math.max(12, Math.round(length / SILHOUETTE_POINT)));
      });
    },
  };
}

/**
 * Silhouettes kept between drawings: tracing them is the slow part of a figure with orbitals, and they depend only on
 * the orbital (kind, size, isovalue, frame), the view and the scale, not on colours, opacity or where the atom sits on
 * the canvas. Traced about the atom and moved to it; the most recent SILHOUETTE_CACHE kept.
 */
const SILHOUETTE_CACHE = 64;
const silhouetteCache = new Map<string, { loops: (lobes: ReadonlySet<number>) => [number, number][][] }>();
function cachedSilhouettes(sight: OrbitalSight & { readonly key: string }, atom: readonly [number, number], points: readonly Vec3[]): { loops: (lobes: ReadonlySet<number>) => [number, number][][] } {
  const rel = points.map((p) => [p[0] - atom[0], p[1] - atom[1]] as const);
  const box = [Math.min(...rel.map((p) => p[0])), Math.min(...rel.map((p) => p[1])), Math.max(...rel.map((p) => p[0])), Math.max(...rel.map((p) => p[1]))] as const;
  const key = `${sight.key}|${sight.view.flat().map((v) => v.toFixed(9)).join(",")}|${sight.scale.toFixed(9)}|${box.map((v) => v.toFixed(3)).join(",")}`;
  let traced = silhouetteCache.get(key);
  if (traced) silhouetteCache.delete(key);
  else {
    const raw = orbitalSilhouettes(sight, [0, 0], box);
    const done = new Map<string, [number, number][][]>();
    traced = {
      loops: (lobes) => {
        const k = [...lobes].sort((a, b) => a - b).join(",");
        let l = done.get(k);
        if (!l) done.set(k, (l = raw.loops(lobes)));
        return l;
      },
    };
  }
  silhouetteCache.set(key, traced);
  if (silhouetteCache.size > SILHOUETTE_CACHE) silhouetteCache.delete(silhouetteCache.keys().next().value!);
  const found = traced;
  return { loops: (lobes) => found.loops(lobes).map((loop) => loop.map(([x, y]) => [x + atom[0], y + atom[1]] as [number, number])) };
}

/**
 * Grid points across an atom's disc, each way, for finding where an orbital lies in front of it: one every
 * FRONT_PX units of the drawing (about 1 px on screen), within these bounds.
 */
const FRONT_PX = 2;
const FRONT_GRID: readonly [number, number] = [8, 48];
/** Samples along each line of sight through the orbital, before the best one is refined, and refining steps. */
const FRONT_SAMPLES = 12;
const FRONT_REFINE = 8;
/** The same for a draft, drawn while the view is moving: a coarser edge, several times faster. */
const DRAFT = { px: 12, grid: [5, 9] as const, samples: 6, refine: 3 };
/** Below this the field is not told apart: far enough from the surface for the contour. */
const FRONT_FLOOR = -0.5;

/**
 * Places the pieces of one orbital (its lobes, its ring, or the whole meshed orbital) among the atoms, so that
 * they and the atoms cut through one another as solids do. Each piece is drawn once just behind every atom it can
 * touch and overlaps on screen. After each such atom it is drawn again, clipped to the atom's disc and to the region
 * where the piece lies in front of the atom's surface; so it shows on an atom just where it is in front of the
 * sphere, and nowhere twice. Atoms out of its reach are ordered by depth as usual.
 *
 * The region comes from the orbital as a solid (`orbitalField`), not from its mesh, so its edge, where the lobe
 * meets the sphere, is smooth. Along the line of sight through each point of a grid over the disc, the largest
 * value of |psi| / level - 1 in front of the sphere is found; the region is where it is positive, traced by
 * marching squares and drawn as a smooth curve.
 */
function placeOrbital(
  units: readonly OrbitalUnit[],
  centre: Vec3,
  size: number,
  field: { value: (x: number, y: number, z: number) => number; lobe: (x: number, y: number, z: number) => number },
  atoms: readonly { readonly centre: Vec3; readonly x: number; readonly y: number; readonly depth: number; readonly radius: number }[],
  view: View,
  project: (p: Vec3) => Vec3,
  scale: number,
  id: string,
  draft = false,
): DrawnOrbitalFace[] {
  const [px4, grid, samples, refine] = draft ? [DRAFT.px, DRAFT.grid, DRAFT.samples, DRAFT.refine] : [FRONT_PX, FRONT_GRID, FRONT_SAMPLES, FRONT_REFINE];
  const out: DrawnOrbitalFace[] = [];
  // Each piece's place on screen as a bounding circle: where it cannot overlap an atom, their order does not matter.
  const pieces = units.map((unit) => {
    const pts = unit.faces.map((f) => project([centre[0] + f.corners[0][0], centre[1] + f.corners[0][1], centre[2] + f.corners[0][2]]));
    const [bx, by] = [pts.reduce((sum, p) => sum + p[0], 0) / pts.length, pts.reduce((sum, p) => sum + p[1], 0) / pts.length];
    const reach = Math.max(...pts.map((p) => Math.hypot(p[0] - bx, p[1] - by))) + 2;
    return { unit, depth: unit.depth, lobes: new Set(unit.faces.map((f) => f.lobe ?? -1)), bx, by, reach };
  });
  const lobeOf = new Map<number, number>();
  pieces.forEach((p, k) => p.lobes.forEach((l) => lobeOf.set(l, k)));
  atoms.forEach((atom, a) => {
    const rel: Vec3 = [atom.centre[0] - centre[0], atom.centre[1] - centre[1], atom.centre[2] - centre[2]];
    if (Math.hypot(...rel) > size + atom.radius) return;
    const r = atom.radius * scale;
    // The pieces that overlap the atom's disc on screen: each drawn behind the atom.
    const overlapping = pieces.filter((p) => Math.hypot(p.bx - atom.x, p.by - atom.y) < r + p.reach);
    if (overlapping.length === 0) return;
    for (const p of overlapping) p.depth = Math.min(p.depth, atom.depth - 0.001);
    // In view axes about the atom: the orbital's centre, and the way back to cartesian (the view is a rotation).
    const c = mulVec(view, [-rel[0], -rel[1], -rel[2]]);
    const [vx, vy, vz] = view;
    // The field over the grid, one array per piece; a border at the floor closes every contour.
    const cells = Math.max(grid[0], Math.min(grid[1], Math.round((2 * r) / px4)));
    const n = cells + 3;
    const extent = atom.radius * 1.04;
    const step = (2 * extent) / cells;
    const grids = pieces.map(() => new Float64Array(n * n).fill(FRONT_FLOOR));
    const reached = new Set<number>();
    for (let i = 1; i < n - 1; i++) {
      for (let j = 1; j < n - 1; j++) {
        const [x, y] = [-extent + (i - 1) * step, -extent + (j - 1) * step];
        // Beyond the disc (and a cell for the contour to close) everything is clipped away.
        if (x * x + y * y > (atom.radius + 1.5 * step) ** 2) continue;
        const side = Math.hypot(x - c[0], y - c[1]);
        if (side >= size) continue;
        const zs = Math.sqrt(Math.max(0, atom.radius ** 2 - x * x - y * y));
        const half = Math.sqrt(size * size - side * side);
        const [z0, z1] = [Math.max(zs, c[2] - half), c[2] + half];
        if (z1 <= z0) continue;
        // Cartesian point about the orbital's atom on this line of sight at depth z (the view is a rotation).
        const px = x * vx[0] + y * vy[0] - rel[0], py = x * vx[1] + y * vy[1] - rel[1], pz = x * vx[2] + y * vy[2] - rel[2];
        // Each piece's own largest value on the line (its own lobes only), sampled and then refined (golden section)
        // round its best sample. Each piece is found on its own, not the line's single largest value: two pieces can
        // both lie in front of the atom on one line, and a single winner per line made the border between their
        // regions a staircase of grid cells (seen 2026-11-26); now each region is a smooth contour of its own field.
        const pieceAt = (z: number): [number, number | undefined] => {
          const [qx, qy, qz] = [px + z * vz[0], py + z * vz[1], pz + z * vz[2]];
          const f = field.value(qx, qy, qz);
          return [f, f > FRONT_FLOOR ? lobeOf.get(field.lobe(qx, qy, qz)) : undefined];
        };
        const bests = new Map<number, { value: number; k: number }>();
        for (let k = 0; k <= samples; k++) {
          const [f, piece] = pieceAt(z0 + ((z1 - z0) * k) / samples);
          if (piece === undefined) continue;
          const b = bests.get(piece);
          if (!b || f > b.value) bests.set(piece, { value: f, k });
        }
        for (const [piece, b] of bests) {
          const own = (z: number): number => {
            const [f, p] = pieceAt(z);
            return p === piece ? f : FRONT_FLOOR;
          };
          let [lo, hi] = [z0 + ((z1 - z0) * Math.max(0, b.k - 1)) / samples, z0 + ((z1 - z0) * Math.min(samples, b.k + 1)) / samples];
          for (let k = 0; k < refine; k++) {
            const [m1, m2] = [hi - 0.618 * (hi - lo), lo + 0.618 * (hi - lo)];
            if (own(m1) > own(m2)) hi = m2;
            else lo = m1;
          }
          const best = Math.max(b.value, own((lo + hi) / 2));
          const g = grids[piece]!;
          if (best > g[i * n + j]!) g[i * n + j] = best;
          if (best > 0) reached.add(piece);
        }
      }
    }
    for (const piece of reached) {
      const loops = contourLoops(grids[piece]!, n);
      if (loops.length === 0) continue;
      const toScreen = ([gi, gj]: readonly [number, number]): readonly [number, number] => [atom.x + (-extent + (gi - 1) * step) * scale, atom.y - (-extent + (gj - 1) * step) * scale];
      const d = loops.map((loop) => smoothClosed(loop.map(toScreen))).join(" ");
      const [disc, region] = [`${id}-a${a}`, `${id}-p${piece}-f${a}`];
      out.push({
        kind: "orbital",
        depth: atom.depth + 0.001,
        svg: `<defs><clipPath id="${disc}"><circle cx="${n1(atom.x)}" cy="${n1(atom.y)}" r="${n1(r)}"/></clipPath><clipPath id="${region}"><path d="${d}" clip-rule="evenodd"/></clipPath></defs><g clip-path="url(#${disc})"><g clip-path="url(#${region})">${pieces[piece]!.unit.body}</g></g>`,
      });
    }
  });
  for (const p of pieces) out.push({ kind: "orbital", depth: p.depth, svg: `${p.unit.defs}${p.unit.body}` });
  return out;
}

/**
 * The closed contours where a field on an n x n grid (value at i * n + j) crosses zero, by marching squares, in grid
 * coordinates. The border of the grid must be negative, so every contour closes. A saddle is split by the value at
 * the cell's centre.
 */
export function contourLoops(v: Float64Array, n: number): [number, number][][] {
  const point = new Map<string, [number, number]>();
  const links = new Map<string, string[]>();
  const edge = (i0: number, j0: number, i1: number, j1: number): string => {
    const key = `${i0},${j0},${i1},${j1}`;
    if (!point.has(key)) {
      const [a, b] = [v[i0 * n + j0]!, v[i1 * n + j1]!];
      const t = a / (a - b);
      point.set(key, [i0 + t * (i1 - i0), j0 + t * (j1 - j0)]);
    }
    return key;
  };
  const link = (p: string, q: string): void => {
    links.set(p, [...(links.get(p) ?? []), q]);
    links.set(q, [...(links.get(q) ?? []), p]);
  };
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const [a, b, c, d] = [v[i * n + j]! > 0, v[(i + 1) * n + j]! > 0, v[(i + 1) * n + j + 1]! > 0, v[i * n + j + 1]! > 0];
      // Corners a (i, j), b (i+1, j), c (i+1, j+1), d (i, j+1); edges bottom a-b, right b-c, top d-c, left a-d.
      const cut: string[] = [];
      if (a !== b) cut.push(edge(i, j, i + 1, j));
      if (b !== c) cut.push(edge(i + 1, j, i + 1, j + 1));
      if (d !== c) cut.push(edge(i, j + 1, i + 1, j + 1));
      if (a !== d) cut.push(edge(i, j, i, j + 1));
      if (cut.length === 2) link(cut[0]!, cut[1]!);
      else if (cut.length === 4) {
        const [bottom, right, top, left] = cut as [string, string, string, string];
        const middle = (v[i * n + j]! + v[(i + 1) * n + j]! + v[(i + 1) * n + j + 1]! + v[i * n + j + 1]!) / 4 > 0;
        // Cut off the corners on the other side from the centre: a and c, or b and d.
        if (middle === a) {
          link(bottom, right);
          link(top, left);
        } else {
          link(bottom, left);
          link(right, top);
        }
      }
    }
  }
  const loops: [number, number][][] = [];
  const done = new Set<string>();
  for (const start of links.keys()) {
    if (done.has(start)) continue;
    const loop: [number, number][] = [];
    let [prev, at] = ["", start];
    while (!done.has(at)) {
      done.add(at);
      loop.push(point.get(at)!);
      const next = links.get(at)!.find((q) => q !== prev && !done.has(q)) ?? links.get(at)!.find((q) => q !== prev);
      if (next === undefined) break;
      [prev, at] = [at, next];
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** A smooth closed curve through the points (Catmull-Rom as cubic Beziers), as SVG path data. */
function smoothClosed(xy: readonly (readonly [number, number])[]): string {
  const steps = xy.length;
  let d = `M${n1(xy[0]![0])},${n1(xy[0]![1])}`;
  for (let s = 0; s < steps; s++) {
    const [p0, p1, p2, p3] = [xy[(s + steps - 1) % steps]!, xy[s]!, xy[(s + 1) % steps]!, xy[(s + 2) % steps]!];
    d += ` C${n1(p1[0] + (p2[0] - p0[0]) / 6)},${n1(p1[1] + (p2[1] - p0[1]) / 6)} ${n1(p2[0] - (p3[0] - p1[0]) / 6)},${n1(p2[1] - (p3[1] - p1[1]) / 6)} ${n1(p2[0])},${n1(p2[1])}`;
  }
  return `${d} Z`;
}

/** The colour of an orbital face lit by `lit` (0 to 1, how squarely it faces the light), for each surface. */
export function orbitalShade(base: string, lit: number, texture: OrbitalTexture): string {
  switch (texture) {
    case "flat":
      return base;
    case "glossy":
      // Deeper shade, and a small bright highlight where the face looks straight at the light.
      return lit > 0.9 ? mixHex(base, "#ffffff", Math.min(0.85, (lit - 0.9) * 8)) : mixHex(base, "#000000", (0.9 - lit) * 0.5);
    case "mesh":
      // A pale, gently shaded surface, so the grid lines carry the shape.
      return mixHex(mixHex(base, "#ffffff", 0.55), "#000000", (1 - lit) * 0.18);
    default:
      return lit > 0.62 ? mixHex(base, "#ffffff", (lit - 0.62) * 0.8) : mixHex(base, "#000000", (0.62 - lit) * 0.45);
  }
}

/** Light for orbital faces, in view axes (right, up, towards the viewer): from the upper left, in front. */
const ORBITAL_LIGHT: Vec3 = (() => {
  const v = [-0.45, 0.55, 0.7];
  const n = Math.hypot(...v);
  return [v[0]! / n, v[1]! / n, v[2]! / n];
})();

/**
 * The silhouette of a cone that points towards the viewer. Its base is a circle seen at an angle: an ellipse,
 * `half` wide across the arrow and `squash` times that along it. The silhouette is the tip, the two lines from
 * the tip that just touch the ellipse, and the ellipse's arc round the back between the touching points. When
 * the cone points so nearly at the viewer that the tip lies inside the ellipse, the silhouette is the ellipse.
 * (ux, uy) is the arrow's direction on screen, (px, py) the direction across it.
 */
function coneOutline(tx: number, ty: number, bx: number, by: number, ux: number, uy: number, px: number, py: number, half: number, squash: number): string {
  const [a, b] = [half * squash, half]; // semi-axes along and across the arrow
  const length = (tx - bx) * ux + (ty - by) * uy; // from the base's centre to the tip, on screen
  const at = (theta: number): string => `${n1(bx + ux * a * Math.cos(theta) + px * b * Math.sin(theta))},${n1(by + uy * a * Math.cos(theta) + py * b * Math.sin(theta))}`;
  if (length <= a * 1.0001) return Array.from({ length: 24 }, (_, k) => at((2 * Math.PI * k) / 24)).join(" ");
  // The touching points are at the angles +-t on the ellipse, with cos t = a / length.
  const t = Math.acos(Math.min(1, a / length));
  const steps = 12;
  let points = `${n1(tx)},${n1(ty)}`;
  for (let k = 0; k <= steps; k++) points += ` ${at(t + ((2 * Math.PI - 2 * t) * k) / steps)}`;
  return points;
}

/** Number of straight pieces the arc of a sector is drawn with, per 180 degrees. */
const ARC_PIECES = 48;
/** Size of the angle labels, px. */
export const ANGLE_LABEL_SIZE = 40;

/** Moment arrows, in angstrom: shaft thickness, head length and head width. */
export const ARROW_SHAFT = 0.16;
export const ARROW_HEAD_LENGTH = 0.55;
export const ARROW_HEAD_WIDTH = 0.46;
/** Width of the optional outline of arrows, px (the spheres' outline is 2 px). */
export const OUTLINE_WIDTH = 1.5;
/** The arrows' rod thickness, head length and head width for a scene, in angstrom: the head keeps its proportion to the rod. */
export function arrowSizes(scene: Scene, arrow?: { readonly thickness?: number | undefined; readonly headScale?: number | undefined }): { shaft: number; headLength: number; headWidth: number } {
  const shaft = arrow?.thickness ?? scene.arrowThickness ?? ARROW_SHAFT;
  const k = (shaft / ARROW_SHAFT) * (scene.arrowHeadSize ?? 1) * (arrow?.headScale ?? 1);
  return { shaft, headLength: ARROW_HEAD_LENGTH * k, headWidth: ARROW_HEAD_WIDTH * k };
}

/** Lettering of the legend and the axes. Avenir exists on macOS; elsewhere the next font in the list is used. */
export const FONT = "Avenir, 'Avenir Next', 'Helvetica Neue', Arial, sans-serif";

/**
 * The font list written into the figure: the chosen font first, then the default list, so that a
 * computer without the chosen font still shows sensible lettering. The name is reduced to letters,
 * digits, spaces and hyphens, so nothing typed as a font name can break the SVG.
 */
export function fontList(family: string | undefined): string {
  const name = (family ?? "").replace(/[^A-Za-z0-9 \-]/g, "").trim();
  if (name === "" || name === "Avenir") return FONT;
  return `'${name}', ${FONT}`;
}
export const LEGEND_COLOUR = "#4c5a62";
export const AXIS_COLOUR = "#5c6b74";
/** Height in px of the band under the structure that holds the legend and the axes. */
export const BAND = 200;

/**
 * The scale of the legend (spheres, gaps, letters) and of the axes (arrows and letters), 1 being their usual size
 * on a 1440-unit canvas. When a text size is given in pt, everything else follows the text, so the proportions
 * the legend and axes were designed with hold at any text size; the size setting then scales them relative to it.
 */
export function legendScale(scene: Scene, canvas: Canvas): number {
  const k = scene.legendSize ?? 1;
  // A legend that follows the structure takes its spheres' size from the atoms drawn (see legendLayout), not
  // from its text: only the size setting scales it here.
  if (scene.legendFollowsZoom) return k;
  return scene.legendFontPt ? (textSize(scene.legendFontPt, LEGEND_FONT, canvas) / LEGEND_FONT) * k : k;
}
export function axesScale(scene: Scene, canvas: Canvas): number {
  const k = scene.axesSize ?? 1;
  return scene.axesFontPt ? (textSize(scene.axesFontPt, AXES_FONT, canvas) / AXES_FONT) * k : k;
}

/** Height of the band under the structure: its usual height, scaled with the larger of the legend and the axes. */
export function bandHeight(scene: Scene, canvas: Canvas): number {
  // A legend that follows the structure may be as large as its atoms are drawn: it keeps the usual band.
  const legendPart = scene.legendFollowsZoom ? Math.max(1, legendScale(scene, canvas)) : legendScale(scene, canvas);
  const scales = [...(scene.legend.length > 0 ? [legendPart] : []), ...(scene.axes.length > 0 ? [axesScale(scene, canvas)] : [])];
  return scales.length ? BAND * Math.min(1.5, Math.max(...scales)) : 0;
}

/** Height of the part of the canvas the structure is fitted into: all of it, less the band when there is a legend or axes. */
export function structureHeight(scene: Scene, canvas: Canvas): number {
  return canvas.height - bandHeight(scene, canvas);
}

/** How the structure is placed on the canvas: px per angstrom, and where the scene's centre lands, in px. */
export interface Fit {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  /** Cut the structure off at the edge of its space (above the legend band): set when zoomed or moved. */
  readonly clip?: boolean;
}

/** The middle of the space the structure is fitted into, px. */
export function structureCentre(scene: Scene, canvas: Canvas): [number, number] {
  return [canvas.width / 2, structureHeight(scene, canvas) / 2];
}

/**
 * The placement that makes the structure, as seen in this view, fill the space above the band:
 * the outline of everything drawn is centred and scaled to touch the margins, but no larger than `maxScale`
 * (px per angstrom). After the user turns the structure by dragging, the page keeps the scale it had and only
 * centres the new outline (smaller only if it would not fit), so the size does not jump on release.
 */
export function fitView(scene: Scene, view: View, canvas: Canvas, maxScale: number = MAX_SCALE): Fit {
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  const include = (p: Vec3, r: number): void => {
    const q = mulVec(view, [p[0] - scene.centre[0], p[1] - scene.centre[1], p[2] - scene.centre[2]]);
    box.x0 = Math.min(box.x0, q[0] - r);
    box.x1 = Math.max(box.x1, q[0] + r);
    box.y0 = Math.min(box.y0, q[1] - r);
    box.y1 = Math.max(box.y1, q[1] + r);
  };
  for (const s of scene.spheres) include(s.centre, scene.styles[s.style]!.radius);
  for (const edge of scene.cellEdges) for (const p of edge) include(p, 0);
  for (const o of scene.orbitals ?? []) include(scene.spheres[o.sphere]!.centre, o.size);
  for (const a of scene.arrows) {
    const c = scene.spheres[a.sphere]!.centre;
    for (const sign of a.start === "centre" ? [0, 1] : [-0.5 * (a.tail ?? 1), 0.5]) include([c[0] + sign * a.vector[0], c[1] + sign * a.vector[1], c[2] + sign * a.vector[2]], arrowSizes(scene, a).headWidth / 2);
  }
  const height = structureHeight(scene, canvas);
  if (box.x0 > box.x1) return { scale: 1, x: canvas.width / 2, y: height / 2 };
  // At least 1 A wide and high, so a single atom is not blown up to fill the canvas.
  const [w, h] = [Math.max(box.x1 - box.x0, 1), Math.max(box.y1 - box.y0, 1)];
  const scale = Math.min((canvas.width - 2 * canvas.margin) / w, (height - 2 * canvas.margin) / h, maxScale, MAX_SCALE);
  // The middle of the outline goes to the middle of the space (screen y is up, SVG y is down).
  return { scale, x: canvas.width / 2 - ((box.x0 + box.x1) / 2) * scale, y: height / 2 + ((box.y0 + box.y1) / 2) * scale };
}

/**
 * A placement that does not depend on the view: the scene's centre at the middle of the space, at a scale
 * that holds the structure at every angle (or at a stated scale, px per angstrom). Turning then never
 * changes the size of anything.
 */
export function steadyFit(scene: Scene, canvas: Canvas, pxPerAngstrom?: number): Fit {
  const height = structureHeight(scene, canvas);
  const scale = pxPerAngstrom ?? Math.min((Math.min(canvas.width, height) - 2 * canvas.margin) / (2 * scene.extent), MAX_SCALE);
  return { scale, x: canvas.width / 2, y: height / 2 };
}

/** Largest drawing scale, px per angstrom: a single small atom is not blown up further than this. */
export const MAX_SCALE = 220;

/** Px per angstrom in this view. */
export function pxPerAngstrom(scene: Scene, view: View, canvas: Canvas, fit?: Fit): number {
  return (fit ?? fitView(scene, view, canvas)).scale;
}

/** Project everything and order it back to front. */
export function layoutAll(scene: Scene, view: View, canvas: Canvas, fit: Fit = fitView(scene, view, canvas), options: RenderOptions = {}): Drawn[] {
  const scale = fit.scale;
  // Screen position (px) and depth (angstrom) of a point given in angstrom.
  const project = (p: Vec3): Vec3 => {
    const q = mulVec(view, [p[0] - scene.centre[0], p[1] - scene.centre[1], p[2] - scene.centre[2]]);
    return [fit.x + q[0] * scale, fit.y - q[1] * scale, q[2]]; // SVG y runs down
  };
  const drawn: Drawn[] = [];
  // The centre atom of a solid or line-art polyhedron is hidden inside it and is not drawn.
  const insidePolyhedron = new Set((scene.polyhedra ?? []).filter((p) => p.look !== "glass").map((p) => p.centre));
  const sphereDrawn: number[] = [];
  scene.spheres.forEach((s, index) => {
    if (insidePolyhedron.has(index)) return;
    const [x, y, depth] = project(s.centre);
    sphereDrawn[index] = drawn.length;
    drawn.push({ kind: "sphere", x, y, depth, r: scene.styles[s.style]!.radius * scale, style: s.style, label: s.label });
  });
  // Orbitals, placed among the atoms so that they cut through one another as solids do (see placeOrbital).
  const atoms = scene.spheres.map((s) => {
    const [x, y, depth] = project(s.centre);
    return { centre: s.centre, x, y, depth, radius: scene.styles[s.style]!.radius };
  });
  // With the mesh surface each face is a small shaded polygon and an orbital is one group: inside it the faces are
  // drawn back to front, opaque, and the group as a whole takes the orbital's opacity, so a see-through lobe has no
  // seams and its overlapping faces do not darken one another. Faces turned away from the viewer are hidden by the
  // lobe's near side and are left out. Atoms of one rule share one surface.
  // Atoms of one rule share a surface, a field and an outline while their frames agree; frames taken from each atom's
  // bonds differ from atom to atom, so the frame is part of the key.
  const orbitalKey = (o: { rule: number; kind: string; frame: View }): string => `${o.rule}|${o.kind}|${o.frame.flat().map((v) => v.toFixed(6)).join(",")}`;
  const surfaces = new Map<string, OrbitalFace[]>();
  const fields = new Map<string, ReturnType<typeof orbitalField>>();
  const outlines = new Map<string, { units: OrbitalUnit[]; x: number; y: number; depth: number }>();
  const field = (o: { rule: number; kind: string; size: number; frame: View; iso?: number }) => {
    const key = orbitalKey(o);
    let f = fields.get(key);
    if (!f) fields.set(key, (f = orbitalField(orbitalById(o.kind)!, o.size, o.frame, o.iso)));
    return f;
  };
  let orbitalIndex = 0;
  for (const o of scene.orbitals ?? []) {
    const key = orbitalKey(o);
    let faces = surfaces.get(key);
    if (!faces) surfaces.set(key, (faces = orbitalSurface(orbitalById(o.kind)!, o.size, o.frame, o.iso)));
    const sphere = scene.spheres[o.sphere]!;
    const centreDepth = project(sphere.centre)[2];
    if (o.texture !== "mesh") {
      // Each lobe one smooth shape: its outline seen from the viewer, filled with a gradient as an atom is shaded.
      // Atoms with the same surface and frame, seen in an orthographic view, show one shape moved: it is outlined
      // (with its gradients) once, and moved to each other such atom.
      const [x, y] = project(sphere.centre);
      const key = orbitalKey(o);
      let first = outlines.get(key);
      if (!first) outlines.set(key, (first = { units: orbitalLobes(faces, sphere.centre, centreDepth, project, o, `orb-${orbitalIndex}`, scene.orbitalOutline, { field: field(o), size: o.size, view, scale, key: `${o.kind}|${o.size}|${o.iso}|${o.frame.flat().map((v) => v.toFixed(9)).join(",")}` }), x, y, depth: centreDepth }));
      const [dx, dy, dz] = [x - first.x, y - first.y, centreDepth - first.depth];
      const units =
        dx === 0 && dy === 0 && dz === 0
          ? first.units
          : first.units.map((u) => ({ depth: u.depth + dz, defs: "", body: `<g transform="translate(${n1(dx)} ${n1(dy)})">${u.body}</g>`, faces: u.faces }));
      drawn.push(...placeOrbital(units, sphere.centre, o.size, field(o), atoms, view, project, scale, `orb-${orbitalIndex}`, options.draft));
      orbitalIndex += 1;
      continue;
    }
    const parts: { depth: number; svg: string }[] = [];
    for (const f of faces) {
      // Normal in view axes, turned to point out of the lobe; a face turned away is left out.
      const [a, b] = [mulVec(view, [f.corners[2][0] - f.corners[0][0], f.corners[2][1] - f.corners[0][1], f.corners[2][2] - f.corners[0][2]]), mulVec(view, [f.corners[3][0] - f.corners[1][0], f.corners[3][1] - f.corners[1][1], f.corners[3][2] - f.corners[1][2]])];
      let nx = a[1] * b[2] - a[2] * b[1];
      let ny = a[2] * b[0] - a[0] * b[2];
      let nz = a[0] * b[1] - a[1] * b[0];
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-12) continue;
      const out = mulVec(view, f.out);
      if (nx * out[0] + ny * out[1] + nz * out[2] < 0) [nx, ny, nz] = [-nx, -ny, -nz];
      if (nz < 0) continue;
      const lit = Math.max(0, (nx * ORBITAL_LIGHT[0] + ny * ORBITAL_LIGHT[1] + nz * ORBITAL_LIGHT[2]) / len);
      const base = f.sign > 0 ? o.colours[0] : o.colours[1];
      const fill = orbitalShade(base, lit, o.texture);
      const pts = f.corners.map((c) => project([sphere.centre[0] + c[0], sphere.centre[1] + c[1], sphere.centre[2] + c[2]]));
      const depth = pts.reduce((sum, p) => sum + p[2], 0) / 4;
      const points = pts.map((p) => `${n1(p[0])},${n1(p[1])}`).join(" ");
      // A hairline of the face's own colour closes the seams; the mesh surface draws its grid lines in a darker tone.
      const [line, lineWidth] = o.texture === "mesh" ? [mixHex(base, "#000000", 0.25), "0.7"] : [fill, "0.6"];
      parts.push({ depth, svg: `<polygon class="orbital" points="${points}" fill="${fill}" stroke="${line}" stroke-width="${lineWidth}" stroke-linejoin="round"/>` });
    }
    const opacity = o.opacity < 1 ? ` opacity="${o.opacity}"` : "";
    if (parts.length > 0) {
      const svg = parts.sort((p, q) => p.depth - q.depth).map((p) => p.svg).join("");
      const unit = { depth: centreDepth, defs: "", body: `<g class="orbital-part"${opacity}>${svg}</g>`, faces: faces.filter((f) => f.lobe !== undefined) };
      drawn.push(...placeOrbital([unit], sphere.centre, o.size, field(o), atoms, view, project, scale, `orb-${orbitalIndex}`, options.draft));
      orbitalIndex += 1;
    }
  }
  // Bonds. With a surface chosen (and not too many of them) each bond is a round rod, drawn as the rods of the
  // arrows are: in two halves that meet in the middle, each belonging to the atom it starts from. A half that
  // points away from the viewer, or lies in the screen, starts at its atom's centre and is drawn before the
  // atom, whose outline cuts it. A half that points at the viewer comes out of the atom's face: it is drawn
  // after the atom, from the small circle where it pierces the surface (an ellipse when seen at an angle).
  const rods = scene.bondMaterial !== undefined && scene.sticks.length <= BOND_ROD_LIMIT;
  // Where each stick's drawn pieces start in `drawn` (they end where the next stick's start).
  const stickStart: number[] = [];
  scene.sticks.forEach((stick, stickIndex) => {
    stickStart[stickIndex] = drawn.length;
    const [a, b] = [scene.spheres[stick.i]!, scene.spheres[stick.j]!];
    const [radiusA, radiusB] = [scene.styles[a.style]!.radius, scene.styles[b.style]!.radius];
    if (stick.length <= (radiusA + radiusB) * BOND_START) return; // the spheres overlap: nothing of the bond shows
    const look: StickStyle = scene.stickStyles[stick.rule] ?? { colour: BOND_COLOUR, width: BOND_WIDTH };
    const paled = (c: string): string => (stick.pale ? mixHex(c, "#ffffff", 0.55) : c);
    // One colour, or each half in the colour of the atom it starts from.
    const [colourA, colourB] = look.colouring === "atoms" ? [paled(scene.styles[a.style]!.colour), paled(scene.styles[b.style]!.colour)] : [paled(look.colour), paled(look.colour)];
    const colour = colourA;
    const line = look.line ?? "solid";
    const width = (stick.pale ? 0.65 : 1) * look.width * scale;
    const at = (t: number): Vec3 => [0, 1, 2].map((i) => a.centre[i]! + (b.centre[i]! - a.centre[i]!) * t) as unknown as Vec3;
    if (!rods) {
      // A plain stroke from just under one surface to just under the other, drawn just behind an atom at the
      // same depth, so the nearer atom covers its end; in two halves when they differ in colour, dashed or
      // dotted by a stroke pattern.
      const [p, q] = [project(at((radiusA * BOND_START) / stick.length)), project(at(1 - (radiusB * BOND_START) / stick.length))];
      const dash = line === "dashed" ? `${n1(2.5 * width)} ${n1(1.5 * width)}` : line === "dotted" ? `0 ${n1(2 * width)}` : undefined;
      const extra = dash ? { dash } : {};
      if (colourA === colourB) {
        drawn.push({ kind: "bond", colour, x1: p[0], y1: p[1], x2: q[0], y2: q[1], width, depth: (p[2] + q[2]) / 2 - 0.1, ...extra });
      } else {
        const m = project(at(0.5));
        drawn.push({ kind: "bond", colour: colourA, x1: p[0], y1: p[1], x2: m[0], y2: m[1], width, depth: (p[2] + m[2]) / 2 - 0.1, ...extra });
        drawn.push({ kind: "bond", colour: colourB, x1: m[0], y1: m[1], x2: q[0], y2: q[1], width, depth: (m[2] + q[2]) / 2 - 0.1, ...extra });
      }
      return;
    }
    const [pa, pb, middle] = [project(a.centre), project(b.centre), project(at(0.5))];
    const onScreen = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const [ux, uy] = onScreen > 1e-6 ? [(pb[0] - pa[0]) / onScreen, (pb[1] - pa[1]) / onScreen] : [1, 0];
    let [px, py] = [-uy, ux];
    if (px * -0.5 + py * -0.7 < 0) [px, py] = [-px, -py]; // the lit side: upper left
    const towards = (pb[2] - pa[2]) / stick.length; // how much the bond, from a to b, points at the viewer
    const w = width / 2;
    const id = `bond-${stickIndex}`;
    // The shading across the rod, one gradient per colour (a two-coloured bond has two).
    const gradient = (gid: string, c: string): string =>
      `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${n1(middle[0] + px * w)}" y1="${n1(middle[1] + py * w)}" x2="${n1(middle[0] - px * w)}" y2="${n1(middle[1] - py * w)}">` +
      `${rodStops(c, scene.bondMaterial ?? "soft")}</linearGradient>`;
    const [idA, idB] = colourA === colourB ? [id, id] : [`${id}a`, `${id}b`];
    const defs = `<defs>${gradient(idA, colourA)}${idB !== idA ? gradient(idB, colourB) : ""}</defs>`;
    const edgeOf = (c: string): string => (scene.bondOutline ? ` stroke="${mixHex(c, "#000000", 0.4)}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"` : "");
    const edge = edgeOf(colour);
    const glass = scene.bondMaterial === "glass" ? ` fill-opacity="${glassAlpha(0.45, scene.glassOpacity)}"` : "";
    const rho = look.width / 2; // the rod's radius, angstrom
    // Dashed or dotted: the pattern over the visible length, between the two surfaces; each half draws its share.
    const surface = (radius: number): number => Math.sqrt(Math.max(0, radius * radius - rho * rho)) / stick.length;
    const pieces = bondPieces(line, surface(radiusA), 1 - surface(radiusB), stick.length, look.width);
    let defsWritten = false;
    /** One half: from its atom (the end `fromA` says) to just past the middle. */
    const half = (fromA: boolean): void => {
      const [radius, sign] = fromA ? [radiusA, 1] : [radiusB, -1];
      const gid = fromA ? idA : idB;
      const hue = fromA ? colourA : colourB;
      if (line !== "solid") {
        const corner = (p: Vec3, side: number): string => `${n1(p[0] + side * px * w)},${n1(p[1] + side * py * w)}`;
        for (const [t0, t1] of pieces) {
          const middleT = (t0 + t1) / 2;
          if (line === "dotted" ? middleT < 0.5 !== fromA : false) continue;
          // A dash that crosses the middle is cut there, so each half keeps its own colour.
          const [s0, s1] = line === "dotted" ? [t0, t1] : fromA ? [t0, Math.min(t1, 0.5)] : [Math.max(t0, 0.5), t1];
          if (s1 <= s0) continue;
          const [p, q] = [project(at(s0)), project(at(s1))];
          const shape =
            line === "dotted"
              ? `<circle class="bond" cx="${n1((p[0] + q[0]) / 2)}" cy="${n1((p[1] + q[1]) / 2)}" r="${n1(w)}" fill="url(#${gid})"${glass}${edgeOf(hue)}/>`
              : `<polygon class="bond" points="${corner(p, 1)} ${corner(q, 1)} ${corner(q, -1)} ${corner(p, -1)}" fill="url(#${gid})"${glass}${edgeOf(hue)}/>`;
          drawn.push({ kind: "bond", colour: hue, x1: p[0], y1: p[1], x2: q[0], y2: q[1], width, depth: (p[2] + q[2]) / 2, svg: `${defsWritten ? "" : defs}${shape}` });
          defsWritten = true;
        }
        return;
      }
      const out = sign * towards; // how much this half, going outwards from its atom, points at the viewer
      const front = out > 0.02;
      const centre = fromA ? pa : pb;
      // Where it starts, as a fraction of the bond from a: at the atom's centre, or where it pierces the surface.
      // A glass atom is seen through, so a rod must not run on to its centre: every half then starts at the
      // surface, also the one behind the atom, which is seen through the glass.
      const atSurface = front || scene.atomMaterial === "glass";
      const pierce = Math.sqrt(Math.max(0, radius * radius - rho * rho)) / stick.length;
      const start = project(at(fromA ? (atSurface ? pierce : 0) : 1 - (atSurface ? pierce : 0)));
      const end = project(at(0.5 + sign * 0.01)); // a hair past the middle, so the two halves leave no gap
      const corner = (p: Vec3, side: number): string => `${n1(p[0] + side * px * w)},${n1(p[1] + side * py * w)}`;
      let outline = `${corner(start, 1)} ${corner(end, 1)} ${corner(end, -1)} ${corner(start, -1)}`;
      let foot = "";
      if (atSurface) {
        // Round the foot: half an ellipse, as wide as the rod and |out| times that along it, bulging back into the atom.
        for (let k = 1; k < 8; k++) {
          const phi = Math.PI * (1 - k / 8);
          const along = -sign * Math.sin(phi) * w * Math.abs(out);
          foot += ` ${n1(start[0] + ux * along + px * w * Math.cos(phi))},${n1(start[1] + uy * along + py * w * Math.cos(phi))}`;
        }
        outline += foot;
      }
      // The outline runs along the two sides and round the foot, not across the middle where the halves meet.
      const sides = edge
        ? `<path class="bond-edge" d="M${corner(end, -1)} L${corner(start, -1)}${foot ? foot.trim().split(" ").map((q) => ` L${q}`).join("") : ""} L${corner(start, 1)} L${corner(end, 1)}" fill="none"${edgeOf(hue)}/>`
        : "";
      const depth = front ? Math.max((start[2] + end[2]) / 2, centre[2] + 0.01) : Math.min((start[2] + end[2]) / 2, centre[2] - 0.01);
      drawn.push({
        kind: "bond",
        colour: hue,
        x1: start[0],
        y1: start[1],
        x2: end[0],
        y2: end[1],
        width,
        depth,
        svg: `${fromA ? defs : ""}<polygon class="bond" points="${outline}" fill="url(#${gid})"${glass}/>${sides}`,
      });
    };
    half(true);
    half(false);
  });
  stickStart.push(drawn.length);
  for (const polygon of scene.polygons) {
    // Just behind its own atoms and bonds, and cut to the gap between them, so it touches them without
    // covering any part of them (see fillOutline).
    const corners = polygon.corners.map((c) => project(scene.spheres[c]!.centre));
    const depth = corners.reduce((sum, c) => sum + c[2], 0) / corners.length - 0.4;
    const look = polygon.rule !== undefined ? scene.stickStyles[polygon.rule] : undefined;
    // The fill reaches FILL_TUCK px under its atoms and bonds (it is drawn behind them), so no hairline of
    // background shows along an edge where the two would only touch.
    const halfWidth = Math.max(0, ((look?.width ?? BOND_WIDTH) * scale) / 2 - FILL_TUCK);
    const outline = fillOutline(
      polygon.corners.map((c, k) => ({ x: corners[k]![0], y: corners[k]![1], r: Math.max(0, scene.styles[scene.spheres[c]!.style]!.radius * scale - FILL_TUCK) })),
      halfWidth,
    );
    if (outline) drawn.push({ kind: "polygon", parts: [outline], colour: polygon.colour, opacity: polygon.opacity, width: 0, depth });
  }
  for (const sector of scene.sectors) {
    // The sector lies in the plane of the two bonds, between the surface of the apex atom and `radius`.
    // A straight angle (180 degrees) has no plane of its own and is not drawn.
    if (sector.degrees > 179.5 || sector.degrees < 0.5) continue;
    const apex = scene.spheres[sector.apex]!;
    const unit = (to: Vec3): Vec3 => {
      const v: Vec3 = [to[0] - apex.centre[0], to[1] - apex.centre[1], to[2] - apex.centre[2]];
      const n = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / n, v[1] / n, v[2] / n];
    };
    const [u, v] = [unit(scene.spheres[sector.a]!.centre), unit(scene.spheres[sector.b]!.centre)];
    const theta = (sector.degrees * Math.PI) / 180;
    // The direction a fraction t of the way round from one bond to the other (turning in their plane).
    const towards = (t: number): Vec3 => {
      const [p, q] = [Math.sin((1 - t) * theta) / Math.sin(theta), Math.sin(t * theta) / Math.sin(theta)];
      return [p * u[0] + q * v[0], p * u[1] + q * v[1], p * u[2] + q * v[2]];
    };
    const inner = Math.min(scene.styles[apex.style]!.radius, sector.radius * 0.8);
    const at = (t: number, r: number): Vec3 => {
      const d = towards(t);
      return project([apex.centre[0] + d[0] * r, apex.centre[1] + d[1] * r, apex.centre[2] + d[2] * r]);
    };
    const pieces = Math.max(4, Math.ceil((ARC_PIECES * sector.degrees) / 180));
    const outer = Array.from({ length: pieces + 1 }, (_, k) => at(k / pieces, sector.radius));
    const back = Array.from({ length: pieces + 1 }, (_, k) => at(1 - k / pieces, inner));
    const text = (pts: Vec3[]): string => pts.map((p) => `${n1(p[0])},${n1(p[1])}`).join(" ");
    const middle = at(0.5, (inner + sector.radius) / 2);
    const labelAt = at(0.5, sector.radius + (0.62 * textSize(scene.angleFontPt, ANGLE_LABEL_SIZE, canvas)) / scale);
    drawn.push({
      kind: "sector",
      points: text([...outer, ...back]),
      arc: text(outer),
      colour: sector.colour,
      opacity: sector.opacity,
      depth: middle[2] - 0.05,
      ...(sector.label ? { label: { text: `${sector.degrees.toFixed(1)}°`, x: labelAt[0], y: labelAt[1] } } : {}),
    });
  }
  for (const band of scene.bands) {
    // One translucent shape behind the whole chain: behind its farthest atom, in front of everything further back.
    let depth = Infinity;
    const parts = band.segments.map(([i, j]) => {
      const [a, b] = [scene.spheres[i]!, scene.spheres[j]!];
      const [p, q] = [project(a.centre), project(b.centre)];
      depth = Math.min(depth, p[2] - scene.styles[a.style]!.radius, q[2] - scene.styles[b.style]!.radius);
      return `${n1(p[0])},${n1(p[1])} ${n1(q[0])},${n1(q[1])}`;
    });
    drawn.push({ kind: "band", parts, colour: band.colour, opacity: band.opacity, width: band.width * scale, depth: depth - 0.05 });
  }
  scene.arrows.forEach((arrow, arrowIndex) => {
    // A moment is drawn as a thin round rod through the atom, centred on it, with a cone at its tip.
    //
    // How the rod meets the sphere decides whether it looks real. A half of the rod that points away from the
    // viewer, or lies in the screen plane, comes out from behind the sphere: it is drawn before the sphere, from
    // the centre outwards, and the sphere's own round outline cuts it. A half that points towards the viewer
    // comes out of the sphere's face: it is drawn after the sphere, starting at the small circle where a rod of
    // this thickness pierces the surface. Seen at an angle that circle is an ellipse, so the rod's foot is
    // rounded.
    const sphere = scene.spheres[arrow.sphere]!;
    const radius = scene.styles[sphere.style]!.radius;
    // A displacement arrow (start "centre") has no tail half: it runs from the centre (lo = 0) to its tip.
    const length = Math.hypot(arrow.vector[0], arrow.vector[1], arrow.vector[2]);
    const fromCentre = arrow.start === "centre";
    const [lo, hi] = fromCentre ? [0, length] : [-(length / 2) * (arrow.tail ?? 1), length / 2];
    if (hi <= radius) return;
    const unit: Vec3 = [arrow.vector[0] / length, arrow.vector[1] / length, arrow.vector[2] / length];
    const at = (t: number): Vec3 => project([sphere.centre[0] + unit[0] * t, sphere.centre[1] + unit[1] * t, sphere.centre[2] + unit[2] * t]);
    const [centre, tip, tail] = [at(0), at(hi), at(lo)];
    const towards = (tip[2] - centre[2]) / hi; // how much the arrow points at the viewer: -1 to 1
    const onScreen = Math.hypot(tip[0] - centre[0], tip[1] - centre[1]);
    // Direction of the arrow on screen; seen end on there is none and any will do (the shapes are round).
    const [ux, uy] = onScreen > 1e-6 ? [(tip[0] - centre[0]) / onScreen, (tip[1] - centre[1]) / onScreen] : [1, 0];
    // Across the rod, on the side the light comes from (upper left).
    let [px, py] = [-uy, ux];
    if (px * -0.5 + py * -0.7 < 0) [px, py] = [-px, -py];
    const sizes = arrowSizes(scene, arrow);
    const w = (sizes.shaft * scale) / 2; // half the rod's thickness, px
    const hw = (sizes.headWidth * scale) / 2;
    const headLength = Math.min(sizes.headLength, hi - radius);
    const base = at(hi - headLength); // centre of the cone's base
    const colour = arrow.colour ?? scene.arrowColour;
    const [light, darker] = [mixHex(colour, "#ffffff", 0.5), mixHex(colour, "#000000", 0.45)];
    const id = `arrow-${arrowIndex}`;
    // Shading across the rod and across the cone: a round surface lit from the upper left.
    const across = (name: string, halfWidth: number, cx: number, cy: number, turned = ""): string =>
      `<linearGradient id="${name}" gradientUnits="userSpaceOnUse"${turned} x1="${n1(cx + px * halfWidth)}" y1="${n1(cy + py * halfWidth)}" x2="${n1(cx - px * halfWidth)}" y2="${n1(cy - py * halfWidth)}">` +
      `${rodStops(colour, scene.arrowMaterial ?? "soft")}</linearGradient>`;
    const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
    // The cone's base is an ellipse turned to the arrow's direction. A shape that is turned turns its shading
    // with it, so the base gets the cone's shading turned back by the same angle: cone and base then shade as one.
    const turnedBack = ` gradientTransform="rotate(${n1(-angle)} ${n1(base[0])} ${n1(base[1])})"`;
    const defs = `<defs>${across(`${id}-rod`, w, centre[0], centre[1])}${across(`${id}-head`, hw, base[0], base[1])}${across(`${id}-base`, hw, base[0], base[1], turnedBack)}</defs>`;
    const corner = (p: Vec3, side: number, halfWidth: number): string => `${n1(p[0] + side * px * halfWidth)},${n1(p[1] + side * py * halfWidth)}`;
    const ellipse = (cls: string, p: Vec3, halfWidth: number, squash: number, fill: string, extra = ""): string =>
      `<ellipse class="${cls}" cx="${n1(p[0])}" cy="${n1(p[1])}" rx="${n1(halfWidth * squash)}" ry="${n1(halfWidth)}" transform="rotate(${n1(angle)} ${n1(p[0])} ${n1(p[1])})" fill="${fill}"${extra}/>`;
    /**
     * One half of the rod, from `start` to `end` (angstrom from the centre along the arrow; negative = tail side).
     * `foot` rounds the start into the half-ellipse of a pierced surface; `sign` is +1 for the head half.
     */
    const rod = (start: number, end: number, sign: 1 | -1, foot: boolean): string => {
      const [p, q] = [at(start), at(end)];
      let outline = `${corner(p, 1, w)} ${corner(q, 1, w)} ${corner(q, -1, w)} ${corner(p, -1, w)}`;
      if (foot) {
        // From the far corner round the back of the foot to the near corner: half an ellipse, as wide as the
        // rod across it and |towards| times that along it.
        for (let k = 1; k < 8; k++) {
          const phi = Math.PI * (1 - k / 8);
          const alongPx = -sign * Math.sin(phi) * w * Math.abs(towards);
          outline += ` ${n1(p[0] + ux * alongPx + px * w * Math.cos(phi))},${n1(p[1] + uy * alongPx + py * w * Math.cos(phi))}`;
        }
      }
      return `<polygon class="arrow-rod" points="${outline}" fill="url(#${id}-rod)"/>`;
    };
    const cone = (): string => {
      if (towards >= 0) {
        // Towards the viewer the cone's side is seen right down to the far half of its round rim. It is drawn as
        // one shape (tip, one corner, round the rim, the other corner), so an outline follows the silhouette and
        // does not cut straight across the cone. The plain ellipse under it carries no outline.
        return ellipse("arrow-base", base, hw, Math.abs(towards), `url(#${id}-base)`, ' stroke="none"') +
          `<polygon class="arrow-head" points="${coneOutline(tip[0], tip[1], base[0], base[1], ux, uy, px, py, hw, Math.abs(towards))}" fill="url(#${id}-head)"/>`;
      }
      // Away from the viewer: the same silhouette, with the flat base facing the viewer, darker and with no line of its own.
      return `<polygon class="arrow-head" points="${coneOutline(tip[0], tip[1], base[0], base[1], ux, uy, px, py, hw, Math.abs(towards))}" fill="url(#${id}-head)"/>` +
        ellipse("arrow-base", base, hw, Math.abs(towards), darker, ' stroke="none"');
    };
    const head = `${n1(tip[0])},${n1(tip[1])} ${corner(base, 1, hw)} ${corner(base, -1, hw)}`;
    const headHalf = (start: number, foot: boolean): string => {
      const shaft = rod(start, hi - headLength, 1, foot);
      return towards >= 0 ? shaft + cone() : cone() + shaft;
    };
    // The flat end of the tail, seen when the tail points at the viewer.
    const tailHalf = (start: number, foot: boolean): string => rod(start, lo, -1, foot) + (towards < 0 ? ellipse("arrow-end", tail, w, Math.abs(towards), light) : "");
    const behind = centre[2] - 0.01;
    // 1. Both halves from the centre outwards, each no nearer than just behind the sphere: the sphere's outline cuts them.
    if (!fromCentre) drawn.push({ kind: "arrow", colour, x1: tail[0], y1: tail[1], x2: centre[0], y2: centre[1], width: 2 * w, depth: Math.min((tail[2] + centre[2]) / 2, behind), svg: defs + tailHalf(0, false) });
    drawn.push({ kind: "arrow", colour, x1: centre[0], y1: centre[1], x2: base[0], y2: base[1], width: 2 * w, depth: Math.min((tip[2] + centre[2]) / 2, behind), head, svg: (fromCentre ? defs : "") + headHalf(0, false) });
    // 2. The half that comes out of the sphere's face, over the sphere, from where it pierces the surface.
    const rho = Math.min(sizes.shaft / 2, radius);
    const pierce = Math.sqrt(Math.max(0, radius * radius - rho * rho));
    // (A tail that ends inside the atom has no part over it: the atom hides it.)
    if (Math.abs(towards) > 0.02 && !(fromCentre && towards < 0) && !(towards < 0 && -lo <= pierce)) {
      const sign = towards > 0 ? 1 : -1; // which half points at the viewer
      const foot = at(sign * pierce);
      const end = sign > 0 ? tip : tail;
      const piece = sign > 0 ? headHalf(pierce, true) : tailHalf(-pierce, true);
      drawn.push({
        kind: "arrow",
        colour,
        x1: foot[0],
        y1: foot[1],
        x2: sign > 0 ? base[0] : tail[0],
        y2: sign > 0 ? base[1] : tail[1],
        width: 2 * w,
        depth: Math.max((foot[2] + end[2]) / 2, centre[2] + 0.01),
        ...(sign > 0 ? { head } : {}),
        front: true,
        svg: piece,
      });
    }
  });
  // Each piece of a cell edge with its middle (angstrom): a piece inside a polyhedron is drawn inside its unit.
  const cellPieces: { index: number; middle: Vec3 }[] = [];
  for (const [from, to] of scene.cellEdges) {
    // A cell edge is long, so it is drawn in short pieces, each at its own depth: an atom then hides
    // only the part of the edge that is really behind it. `along` keeps the dashes continuous.
    const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    const pieces = Math.max(1, Math.ceil(length / CELL_PIECE));
    const at = (t: number): Vec3 => [0, 1, 2].map((i) => from[i]! + (to[i]! - from[i]!) * t) as unknown as Vec3;
    const [start, end] = [project(from), project(to)];
    const drawnLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
    for (let n = 0; n < pieces; n++) {
      const [p, q] = [project(at(n / pieces)), project(at((n + 1) / pieces))];
      cellPieces.push({ index: drawn.length, middle: at((n + 0.5) / pieces) });
      drawn.push({ kind: "cell", x1: p[0], y1: p[1], x2: q[0], y2: q[1], width: 0, depth: (p[2] + q[2]) / 2 - 0.3, along: (drawnLength * n) / pieces });
    }
  }
  layoutPolyhedra(scene, view, project, scale, drawn, sphereDrawn, stickStart, cellPieces);
  return drawn.sort((p, q) => p.depth - q.depth);
}

/**
 * Coordination polyhedra (the user's choices, 2026-11-24), each drawn as one unit at the depth of its centre atom:
 * its back faces and edges, then the centre atom and the bonds inside it (in their own order), then its front faces
 * and edges. A face is at the back when its outward normal points away from the viewer. Corner atoms keep their own
 * depth, so a corner nearer the viewer than the centre is drawn over the polyhedron and a farther one under it.
 * Glass: see-through shaded faces and every edge. Solid: opaque shaded front faces, edged. Line art: white front
 * faces, hidden edges dashed and thin, visible edges in ink. A flat polygon is drawn whole, behind its centre atom.
 */
function layoutPolyhedra(
  scene: Scene,
  view: View,
  project: (p: Vec3) => Vec3,
  scale: number,
  drawn: Drawn[],
  sphereDrawn: readonly number[],
  stickStart: readonly number[],
  cellPieces: readonly { index: number; middle: Vec3 }[],
): void {
  const polyhedra = scene.polyhedra ?? [];
  if (polyhedra.length === 0) return;
  const byCentre = new Map(polyhedra.map((p) => [p.centre, p]));
  const width = Math.max(1, 0.025 * scale);
  // What each polyhedron looks like from here, for cutting its corner atoms afterwards.
  const seen: { poly: (typeof polyhedra)[number]; c: number; facing: Vec3[]; front: boolean[]; points: Vec3[] }[] = [];
  for (const poly of polyhedra) {
    const c = project(scene.spheres[poly.centre]!.centre)[2];
    const at = (step: number): number => c + step * UNIT_STEP;
    // The centre atom and the bonds inside: kept in their order, squeezed into the middle of the unit.
    const squeeze = (index: number | undefined): void => {
      if (index === undefined) return;
      const d = drawn[index]!;
      drawn[index] = { ...d, depth: c + (d.depth - c) * UNIT_SQUEEZE } as Drawn;
    };
    squeeze(sphereDrawn[poly.centre]);
    const corners = new Set(poly.corners);
    scene.sticks.forEach((stick, k) => {
      if (stick.rule !== poly.rule) return;
      const other = stick.i === poly.centre ? stick.j : stick.j === poly.centre ? stick.i : -1;
      if (other < 0 || !corners.has(other) || byCentre.get(poly.centre) !== poly) return;
      for (let index = stickStart[k]!; index < stickStart[k + 1]!; index++) squeeze(index);
    });
    // Pieces of cell edges that run through the polyhedron (a cell edge from Ti to Ti through an O corner) are inside
    // it too: behind its front faces, in front of its back faces.
    const centre = scene.spheres[poly.centre]!.centre;
    const reach = Math.max(...poly.corners.map((k) => Math.hypot(...([0, 1, 2].map((i) => scene.spheres[k]!.centre[i]! - centre[i]!) as [number, number, number]))));
    const anchor = poly.faces.map((face) => scene.spheres[poly.corners[face[0]!]!]!.centre);
    for (const piece of poly.flat ? [] : cellPieces) {
      const m = piece.middle;
      if (Math.hypot(m[0] - centre[0], m[1] - centre[1], m[2] - centre[2]) > reach) continue;
      const inside = poly.normals.every((n, f) => n[0] * (m[0] - anchor[f]![0]) + n[1] * (m[1] - anchor[f]![1]) + n[2] * (m[2] - anchor[f]![2]) < -1e-6);
      if (inside) squeeze(piece.index);
    }
    const points = poly.corners.map((k) => project(scene.spheres[k]!.centre));
    const facing = poly.normals.map((n) => mulVec(view, n));
    const front = facing.map((n) => !poly.flat && n[2] > 1e-9);
    seen.push({ poly, c, facing, front, points });
    const shape = (face: readonly number[]): string => face.map((k) => `${n1(points[k]![0])},${n1(points[k]![1])}`).join(" ");
    const lit = (f: number): number => {
      const n = facing[f]!;
      const l = n[0] * FACE_LIGHT[0] + n[1] * FACE_LIGHT[1] + n[2] * FACE_LIGHT[2];
      return Math.max(0, poly.flat ? Math.abs(l) : l);
    };
    const edge = (a: number, b: number, look: string): string =>
      `<line class="polyhedron-edge" x1="${n1(points[a]![0])}" y1="${n1(points[a]![1])}" x2="${n1(points[b]![0])}" y2="${n1(points[b]![1])}" ${look}/>`;
    const edges = hullEdges(poly.faces);
    // A flat polygon has no hidden side: all its edges are shown.
    const hidden = poly.flat ? [] : edges.filter((e) => e.faces.every((f) => !front[f]));
    const shown = poly.flat ? edges : edges.filter((e) => e.faces.some((f) => front[f]));
    const push = (step: number, svg: string): void => {
      if (svg) drawn.push({ kind: "polyhedron", depth: at(step), svg });
    };
    const colour = poly.colour;
    if (poly.look === "glass") {
      const fill = (f: number): string => mixHex(mixHex(colour, INK, 0.12), mixHex(colour, "#ffffff", 0.5), 0.3 + 0.7 * lit(f));
      const faces = (want: boolean): string =>
        poly.faces.map((face, f) => (front[f] === want ? `<polygon class="polyhedron-face" points="${shape(face)}" fill="${fill(f)}"/>` : "")).join("");
      const line = `stroke="${mixHex(colour, INK, 0.5)}" stroke-width="${n1(width)}" stroke-linecap="round"`;
      const opacity = Math.min(1, Math.max(0, poly.opacity));
      // Faces of one side as one see-through group, so where they overlap the colour does not double.
      const group = (svg: string): string => (svg ? `<g class="polyhedron" fill-opacity="${+opacity.toFixed(3)}">${svg}</g>` : "");
      push(-2, group(faces(false)));
      push(-1.5, hidden.map((e) => edge(e.a, e.b, line)).join(""));
      push(1.5, group(faces(true)));
      push(2, shown.map((e) => edge(e.a, e.b, line)).join(""));
    } else if (poly.look === "solid") {
      const fill = (f: number): string => mixHex(mixHex(colour, INK, 0.35), mixHex(colour, "#ffffff", 0.35), 0.35 + 0.65 * lit(f));
      const stroke = mixHex(colour, INK, 0.5);
      push(1.5, poly.faces.map((face, f) => (front[f] || poly.flat ? `<polygon class="polyhedron-face" points="${shape(face)}" fill="${fill(f)}" stroke="${stroke}" stroke-width="${n1(width)}" stroke-linejoin="round"/>` : "")).join(""));
    } else {
      const ink = `stroke="${INK}" stroke-width="${n1(width)}" stroke-linecap="round"`;
      const thin = `stroke="${INK}" stroke-width="${n1(0.6 * width)}" stroke-linecap="round" stroke-dasharray="${n1(3 * width)} ${n1(2.5 * width)}"`;
      push(1.5, poly.faces.map((face, f) => (front[f] || poly.flat ? `<polygon class="polyhedron-face" points="${shape(face)}" fill="#ffffff"/>` : "")).join(""));
      push(1.75, hidden.map((e) => edge(e.a, e.b, thin)).join(""));
      push(2, shown.map((e) => edge(e.a, e.b, ink)).join(""));
    }
  }
  cutCornerAtoms(scene, drawn, sphereDrawn, seen);
}

/** Whether a point lies inside a convex polygon (either way round). */
function insideConvex(polygon: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [p, q] = [polygon[i]!, polygon[(i + 1) % polygon.length]!];
    const turn = (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    if (Math.abs(turn) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(turn);
    else if (Math.sign(turn) !== sign) return false;
  }
  return true;
}

/**
 * Where a corner atom meets its polyhedra (the user's request, 2026-11-24). An atom sits on a corner of one or more
 * polyhedra, and part of it lies inside each. It is drawn twice: whole, before every one of these polyhedra, so their
 * faces cover the part of it that lies behind them; and again after all of them, cut to the part of it in front of
 * them, so that part covers their faces and edges.
 *
 * The cut is exact. Seen from the viewer, a point of the atom's near surface is in front of a polyhedron when it lies
 * outside the plane of one of the polyhedron's faces that turn to the viewer and meet at the corner (the polyhedron's
 * near surface is the nearest of its front faces' planes, and the planes of faces away from the corner are farther
 * from it than the atom's radius, so they never pass through the atom), or when the line of sight misses the
 * polyhedron (outside its outline on screen). A face's plane
 * passes through the atom's centre, so it cuts the atom in a great circle, whose near half is seen as a half-ellipse:
 * the part of the atom outside that face is the half-disc on the face's outward side joined to the half-ellipse
 * (semi-axes r and r cos(tilt) of the face) on the other side.
 */
function cutCornerAtoms(
  scene: Scene,
  drawn: Drawn[],
  sphereDrawn: readonly number[],
  seen: readonly { poly: NonNullable<Scene["polyhedra"]>[number]; c: number; facing: Vec3[]; front: boolean[]; points: Vec3[] }[],
): void {
  const centres = new Set(seen.map((s) => s.poly.centre));
  const at = new Map<number, number[]>();
  seen.forEach((s, k) => {
    if (s.poly.flat) return;
    for (const corner of s.poly.corners) {
      if (centres.has(corner) || sphereDrawn[corner] === undefined) continue;
      const list = at.get(corner);
      if (list) list.push(k);
      else at.set(corner, [k]);
    }
  });
  const SAMPLES = 24;
  for (const [corner, list] of at) {
    const index = sphereDrawn[corner]!;
    const atom = drawn[index] as DrawnSphere;
    const { x, y, r } = atom;
    if (!(r > 0)) continue;
    const point = (px: number, py: number): string => `${n1(x + px * r)},${n1(y - py * r)}`; // view y is up, SVG y down
    // For each polyhedron at this corner, the parts of the atom in front of it (their union).
    const regions: string[][] = [];
    for (const k of list) {
      const { poly, facing, front, points } = seen[k]!;
      const v = poly.corners.indexOf(corner);
      const parts: string[] = [];
      poly.faces.forEach((face, f) => {
        if (!front[f] || !face.includes(v)) return;
        const n = facing[f]!;
        const size = Math.hypot(n[0], n[1], n[2]);
        const [nx, ny, nz] = [n[0] / size, n[1] / size, n[2] / size];
        const L = Math.hypot(nx, ny);
        if (L < 1e-9) {
          parts.push(`M${point(1, 0)}A${n1(r)},${n1(r)} 0 1 0 ${point(-1, 0)}A${n1(r)},${n1(r)} 0 1 0 ${point(1, 0)}Z`); // faces the viewer: all of it
          return;
        }
        const [ux, uy] = [nx / L, ny / L];
        const [wx, wy] = [uy, -ux];
        const pts: string[] = [];
        for (let i = 0; i <= SAMPLES; i++) {
          const t = -Math.PI / 2 + (Math.PI * i) / SAMPLES; // the rim, on the face's outward side
          pts.push(point(Math.cos(t) * ux + Math.sin(t) * wx, Math.cos(t) * uy + Math.sin(t) * wy));
        }
        for (let i = 1; i < SAMPLES; i++) {
          const t = (Math.PI * i) / SAMPLES; // the near half of the great circle, back across the other side
          pts.push(point(Math.cos(t) * wx - nz * Math.sin(t) * ux, Math.cos(t) * wy - nz * Math.sin(t) * uy));
        }
        parts.push(`M${pts.join("L")}Z`);
      });
      // Where the line of sight misses the polyhedron (outside its outline on screen) nothing of it is in front.
      // The outline is convex; unless it covers the whole disc, the disc less the outline is added (even-odd).
      const outline = convexHull(points.map((q) => [q[0], q[1]] as [number, number]));
      const covers = outline.every((q, i) => {
        const o = outline[(i + 1) % outline.length]!;
        const [ex, ey] = [o[0] - q[0], o[1] - q[1]];
        const length = Math.hypot(ex, ey);
        // Distance of the atom's centre inside this edge (the hull runs one way round; either sign works if all agree).
        return length > 0 ? Math.abs((ex * (y - q[1]) - ey * (x - q[0])) / length) >= r : true;
      }) && outline.length >= 3 && insideConvex(outline, x, y);
      if (!covers) {
        const disc: string[] = [];
        for (let i = 0; i < 4 * SAMPLES; i++) disc.push(`${n1(x + r * Math.cos((Math.PI * i) / (2 * SAMPLES)))},${n1(y + r * Math.sin((Math.PI * i) / (2 * SAMPLES)))}`);
        parts.push(`M${disc.join("L")}Z M${outline.map((q) => `${n1(q[0])},${n1(q[1])}`).join("L")}Z`);
      }
      if (parts.length === 0) {
        regions.length = 0; // wholly behind this polyhedron: nothing of it is drawn over them
        regions.push([]);
        break;
      }
      regions.push(parts);
    }
    const cs = list.map((k) => seen[k]!.c);
    drawn[index] = { ...atom, depth: Math.min(atom.depth, Math.min(...cs) - 3 * UNIT_STEP) };
    if (regions.some((parts) => parts.length === 0)) continue;
    const id = `poly-cut-${corner}`;
    // Even-odd: a region of two loops (the disc less the outline) is the part between them; the others are one loop.
    const clips = regions.map((parts, k) => `<clipPath id="${id}-${k}">${parts.map((d) => `<path d="${d}" clip-rule="evenodd"/>`).join("")}</clipPath>`).join("");
    const body = regions.reduceRight((inner, _, k) => `<g clip-path="url(#${id}-${k})">${inner}</g>`, sphereSvg(scene, atom.style, x, y, r));
    drawn.push({ kind: "polyhedron", depth: Math.max(atom.depth, Math.max(...cs) + 3 * UNIT_STEP), svg: `<defs>${clips}</defs>${body}` });
  }
}

/** The spheres only, back to front. */
export function layout(scene: Scene, view: View, canvas: Canvas, fit?: Fit): DrawnSphere[] {
  return layoutAll(scene, view, canvas, fit).filter((d): d is DrawnSphere => d.kind === "sphere");
}

const n1 = (v: number): string => (Math.round(v * 10) / 10).toString();
const gradientId = (colour: string): string => `g-${colour.replace(/[^A-Za-z0-9]/g, "")}`;
/** Outline of a pie sphere, and the id of the shading laid over its flat wedges. */
export const PIE_OUTLINE = "#4a4f55";
const PIE_SHADE = "pie-shade";

/**
 * The wedges of a pie sphere as SVG paths: sectors clockwise from the top, each spanning
 * 360 degrees x its fraction. Exported for the tests.
 */
export function wedgePaths(x: number, y: number, r: number, wedges: readonly Wedge[]): string {
  let out = "";
  let turn = 0; // fraction of the circle already drawn
  for (const w of wedges) {
    if (w.fraction <= 0) continue;
    if (w.fraction >= 0.9995) {
      out += `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r)}" fill="${w.colour}"/>`;
      continue;
    }
    const angle = (t: number): number => -Math.PI / 2 + 2 * Math.PI * t; // 0 = top; SVG y runs down, so increasing angle is clockwise
    const [a0, a1] = [angle(turn), angle(turn + w.fraction)];
    const large = w.fraction > 0.5 ? 1 : 0;
    out +=
      `<path class="wedge" d="M${n1(x)} ${n1(y)} L${n1(x + r * Math.cos(a0))} ${n1(y + r * Math.sin(a0))} ` +
      `A${n1(r)} ${n1(r)} 0 ${large} 1 ${n1(x + r * Math.cos(a1))} ${n1(y + r * Math.sin(a1))} Z" fill="${w.colour}"/>`;
    turn += w.fraction;
  }
  return out;
}

const escapeXml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One sphere of a given style, as SVG. */
function sphereSvg(scene: Scene, styleKey: string, x: number, y: number, r: number): string {
  const style = scene.styles[styleKey]!;
  const material = scene.atomMaterial ?? "soft";
  // The highlight spot of a glossy, metal or glass sphere: a small tilted ellipse up and to the left.
  const gloss =
    material === "glossy" || material === "metal" || material === "glass"
      ? `<ellipse class="gloss" cx="${n1(x - 0.36 * r)}" cy="${n1(y - 0.42 * r)}" rx="${n1(0.3 * r)}" ry="${n1(0.19 * r)}" transform="rotate(-38 ${n1(x - 0.36 * r)} ${n1(y - 0.42 * r)})" fill="url(#gloss)"/>`
      : "";
  // Glass also shows the light that has passed through the ball: a soft glow low on the far side from the highlight.
  const glow =
    material === "glass"
      ? `<ellipse class="glow" cx="${n1(x + 0.3 * r)}" cy="${n1(y + 0.36 * r)}" rx="${n1(0.46 * r)}" ry="${n1(0.3 * r)}" transform="rotate(-38 ${n1(x + 0.3 * r)} ${n1(y + 0.36 * r)})" fill="url(#gloss)" fill-opacity="0.5"/>`
      : "";
  if (style.wedges) {
    // A pie: flat wedges under one shading circle. Glass makes the wedges see-through; flat leaves the shading out.
    const wedges = material === "glass" ? `<g fill-opacity="${glassAlpha(0.45, scene.glassOpacity)}">${wedgePaths(x, y, r, style.wedges)}</g>` : wedgePaths(x, y, r, style.wedges);
    const shade = material === "flat" ? "none" : `url(#${PIE_SHADE})`;
    return `${wedges}<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r)}" fill="${shade}" stroke="${PIE_OUTLINE}" stroke-width="2"/>${gloss}\n`;
  }
  const outline = mixHex(style.colour, "#000000", material === "metal" ? 0.5 : 0.35);
  const fill = material === "flat" ? style.colour : `url(#${gradientId(style.colour)})`;
  return `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r)}" fill="${fill}" stroke="${outline}" stroke-width="${material === "glass" ? "1.5" : "2"}"${material === "glass" ? ' stroke-opacity="0.85"' : ""}/>${glow}${gloss}\n`;
}

/**
 * The look of one piece of a cell edge. In the "depth" style a piece in front of the middle of the structure
 * is a solid line and one behind it is paler, thinner and dashed: the box then reads as a solid, and it is
 * clear which face is the near one. (`depth` is measured from the middle of the structure; the pieces are
 * drawn 0.3 A further back than they are, which is taken off again here.)
 */
function cellStroke(scene: Scene, depth: number, along: number): string {
  if (scene.cellStyle === undefined) return `${CELL_STROKE} stroke-dashoffset="${n1(along)}"`;
  const width = scene.cellWidth ?? 3;
  const dashes = `stroke-dasharray="${n1(width * 3.2)} ${n1(width * 2.8)}" stroke-dashoffset="${n1(along)}"`;
  if (scene.cellStyle === "solid") return `stroke="${CELL_FRONT}" stroke-width="${n1(width)}" stroke-linecap="round"`;
  if (scene.cellStyle === "dashed") return `stroke="${CELL_BACK}" stroke-width="${n1(width)}" ${dashes}`;
  return depth + 0.3 >= 0
    ? `stroke="${CELL_FRONT}" stroke-width="${n1(width)}" stroke-linecap="round"`
    : `stroke="${CELL_FAR}" stroke-width="${n1(width * 0.8)}" ${dashes}`;
}

/**
 * An opacity of the usual glass, for a chosen solidity (0 to 1). At 0.3 it is unchanged; below that it
 * falls towards 0 (clearer); above it rises towards 1, so that at 1 nothing is seen through.
 */
export function glassAlpha(usual: number, solidity = 0.3): number {
  const g = Math.max(0, Math.min(1, solidity));
  const value = g <= 0.3 ? usual * (g / 0.3) : usual + (1 - usual) * ((g - 0.3) / 0.7);
  return Math.round(value * 1000) / 1000;
}

/** The colour stops of a sphere's radial shading, from the highlight (up and to the left) to the rim. */
function sphereStops(colour: string, material: Material, glass?: number): string {
  const stop = (offset: number, c: string, opacity?: number): string => `<stop offset="${offset}" stop-color="${c}"${opacity === undefined ? "" : ` stop-opacity="${opacity}"`}/>`;
  const [w, k] = [(t: number): string => mixHex(colour, "#ffffff", t), (t: number): string => mixHex(colour, "#000000", t)];
  switch (material) {
    case "glossy": // a brighter centre and a deeper rim than soft; the spot is added on top
      return stop(0, w(0.55)) + stop(0.4, colour) + stop(1, k(0.5));
    case "metal": // a bright highlight, a quick fall to dark, and light coming back at the rim
      return stop(0, w(0.9)) + stop(0.22, w(0.4)) + stop(0.5, k(0.2)) + stop(0.78, k(0.6)) + stop(0.93, k(0.35)) + stop(1, w(0.2));
    case "glass": // clear in the middle; the colour gathers in a rim, where one looks through the most glass
      return stop(0, w(0.7), glassAlpha(0.05, glass)) + stop(0.55, w(0.3), glassAlpha(0.1, glass)) + stop(0.8, colour, glassAlpha(0.24, glass)) + stop(0.93, colour, glassAlpha(0.52, glass)) + stop(1, k(0.25), glassAlpha(0.8, glass));
    default: // soft (flat uses no gradient)
      return stop(0, w(0.65)) + stop(0.55, colour) + stop(1, k(0.35));
  }
}

/** The colour stops of the shading across a rod or a cone, from the lit side to the far side. */
function rodStops(colour: string, material: Material): string {
  const stop = (offset: number, c: string): string => `<stop offset="${offset}" stop-color="${c}"/>`;
  const [w, k] = [(t: number): string => mixHex(colour, "#ffffff", t), (t: number): string => mixHex(colour, "#000000", t)];
  switch (material) {
    case "flat":
      return stop(0, colour) + stop(1, colour);
    case "glossy":
      return stop(0, colour) + stop(0.22, w(0.8)) + stop(0.42, colour) + stop(1, k(0.45));
    case "metal": // bands of light and dark, as a polished rod shows
      return stop(0, k(0.25)) + stop(0.2, w(0.85)) + stop(0.4, colour) + stop(0.68, k(0.55)) + stop(0.88, w(0.25)) + stop(1, k(0.35));
    default: // soft, and glass (which is soft shading made see-through)
      return stop(0, colour) + stop(0.3, w(colour === AXIS_COLOUR ? 0.55 : 0.5)) + stop(0.65, colour) + stop(1, k(0.3));
  }
}

/**
 * Rough width of a word in the heavy legend lettering, in px. The true width depends on the font the
 * reader has, so this only spaces the legend; it is deliberately a little generous.
 */
export function textWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) {
    if ("iIljtfr1.,:;'!|/ ".includes(ch)) em += 0.36;
    else if ("MWmw@%".includes(ch)) em += 0.92;
    else if (ch >= "A" && ch <= "Z") em += 0.72;
    else em += 0.6;
  }
  return em * fontSize;
}

/** A legend item as placed: sphere centre and radius, and where its name starts, in px. */
export interface LegendItem {
  readonly style: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly textX: number;
  readonly fontSize: number;
}

/**
 * The legend row: for each entry a sphere and its name, left to right. Sphere sizes keep the ratio of the
 * atoms' radii (largest 44 px). Text width is estimated (the exact width depends on the reader's font), and
 * the whole row is shrunk if it would not fit in `available` px.
 */
export function legendLayout(scene: Scene, canvas: Canvas, available: number, pxPerAngstrom?: number): LegendItem[] {
  if (scene.legend.length === 0) return [];
  const largest = Math.max(...scene.legend.map((e) => scene.styles[e.style]!.radius));
  // Following the structure: the largest legend sphere is as large as that atom is drawn (within what the
  // band can hold), and everything else in the legend is in proportion to it.
  const follow = legendScale(scene, canvas) * (pxPerAngstrom === undefined ? 1 : Math.max(LEGEND_FOLLOW_MIN, Math.min(LEGEND_FOLLOW_MAX, (largest * pxPerAngstrom) / 44)));
  const place = (shrink: number): { items: LegendItem[]; end: number } => {
    const k = shrink * follow;
    const items: LegendItem[] = [];
    let x = 60 * k;
    for (const e of scene.legend) {
      const r = Math.max(14, (44 * scene.styles[e.style]!.radius) / largest) * k;
      // A text size given in pt is kept exactly; only the spheres and gaps shrink if the row does not fit.
      const fontSize = textSize(scene.legendFontPt, LEGEND_FONT * k, canvas);
      const textX = x + 2 * r + 22 * k;
      items.push({ style: e.style, name: e.name, x: x + r, y: canvas.height - 92 * Math.min(1.5, legendScale(scene, canvas)), r, textX, fontSize });
      x = textX + textWidth(e.name, fontSize) + 70 * k;
    }
    return { items, end: x - 70 * k };
  };
  const full = place(1);
  return full.end <= available ? full.items : place(available / full.end).items;
}

/** Limits of a legend that follows the structure, as multiples of its usual size: it stays readable and inside its band. */
export const LEGEND_FOLLOW_MIN = 0.35;
export const LEGEND_FOLLOW_MAX = 1.9;

/** An axis arrow as placed, in px: the shaft from the origin to the base of the head, the head triangle, the letter. */
export interface AxisArrow {
  readonly name: string;
  /** Tip of the arrow relative to the origin: (length on screen) x (direction on screen); SVG y runs down. */
  readonly dx: number;
  readonly dy: number;
  /** Larger = pointing more towards the viewer. */
  readonly depth: number;
}

/** Length in px of an axis arrow lying in the plane of the screen. An axis tilted out of the screen is drawn shorter. */
export const AXIS_LENGTH = 140;

/** The three axis arrows as seen in this view, relative to their common origin. */
export function axisArrows(scene: Scene, view: View, canvas: Canvas = DEFAULT_CANVAS): AxisArrow[] {
  return scene.axes.map((axis) => {
    const p = mulVec(view, axis.direction);
    const length = AXIS_LENGTH * axesScale(scene, canvas);
    return { name: axis.name, dx: p[0] * length, dy: -p[1] * length, depth: p[2] };
  });
}

/** Sizes of the axis arrows, px: shaft thickness, head length and head width. */
const AXIS_SHAFT = 13;
/** Shortest drawn length of a readable axis arrow, as a fraction of the full length. */
export const AXIS_MIN_LENGTH = 0.45;
/** Largest tilt (0 = in the screen plane, 1 = end on) with which the head of a readable axis arrow is drawn. */
export const AXIS_MAX_TILT = 0.6;
const AXIS_HEAD = 48;
const AXIS_HEAD_WIDTH = 29;

/**
 * The axis triad as SVG, placed so that it sits in the bottom right corner whatever the orientation.
 * Each arrow is drawn as a solid: a round shaft and a cone head, shaded like the spheres (light from
 * the upper left). The cone's round base is drawn as the ellipse it appears as, so an arrow pointing
 * at the viewer shows the cone face on, and one pointing away shows its flat base. Still plain vector
 * shapes with gradients.
 */
function axesSvg(scene: Scene, view: View, canvas: Canvas): { svg: string; defs: string; left: number } {
  const exact = axisArrows(scene, view, canvas);
  if (exact.length === 0) return { svg: "", defs: "", left: canvas.width };
  // An arrow that points mostly into or out of the page projects to a stub that is hard to read. Unless that
  // is switched off, such an arrow is drawn at least AXIS_MIN_LENGTH of the full length, in its true
  // direction on screen. (An arrow seen exactly end on has no direction on screen and stays a point.)
  const full = AXIS_LENGTH * axesScale(scene, canvas);
  const arrows = exact.map((a) => {
    const n = Math.hypot(a.dx, a.dy);
    if (scene.axesKeepReadable === false || n < 0.12 * full || n >= AXIS_MIN_LENGTH * full) return a;
    return { ...a, dx: (a.dx / n) * AXIS_MIN_LENGTH * full, dy: (a.dy / n) * AXIS_MIN_LENGTH * full };
  });
  // Every size of the triad follows the chosen size: arrow length and thickness, head, letters.
  const k = axesScale(scene, canvas);
  const headSize = k * (scene.axesHeadSize ?? 1);
  const [lengthPx, shaftPx, headPx, headWidthPx] = [AXIS_LENGTH * k, AXIS_SHAFT * k, AXIS_HEAD * headSize, AXIS_HEAD_WIDTH * headSize];
  const fontSize = textSize(scene.axesFontPt, AXES_FONT * k, canvas);
  const labelGap = 42 * k * Math.max(1, fontSize / (AXES_FONT * k));
  // Where each letter goes, relative to the origin; an axis seen end on has no direction on screen and gets no letter.
  const letters = arrows.map((a) => {
    const n = Math.hypot(a.dx, a.dy);
    return n < 0.12 * lengthPx ? null : { x: a.dx + (a.dx / n) * labelGap, y: a.dy + (a.dy / n) * labelGap };
  });
  const half = headWidthPx / 2;
  const xs = [-half, half, ...arrows.flatMap((a) => [a.dx - half, a.dx + half]), ...letters.flatMap((l) => (l ? [l.x - fontSize * 0.4, l.x + fontSize * 0.4] : []))];
  const ys = [-half, half, ...arrows.flatMap((a) => [a.dy - half, a.dy + half]), ...letters.flatMap((l) => (l ? [l.y - fontSize * 0.45, l.y + fontSize * 0.45] : []))];
  const ox = canvas.width - 45 - Math.max(...xs);
  const oy = canvas.height - 25 - Math.max(...ys);
  const [light, dark] = [mixHex(AXIS_COLOUR, "#ffffff", 0.55), mixHex(AXIS_COLOUR, "#000000", 0.3)];
  let defs =
    `<radialGradient id="axis-ball" cx="36%" cy="30%" r="72%"><stop offset="0" stop-color="${light}"/>` +
    `<stop offset="0.55" stop-color="${AXIS_COLOUR}"/><stop offset="1" stop-color="${dark}"/></radialGradient>\n`;
  let svg = "";
  const colourOf = (name: string): string => scene.axesColours?.[["a", "b", "c"].indexOf(name)] ?? AXIS_COLOUR;
  // Back to front: the arrow pointing most away from the viewer first, then the ball at the origin.
  const order = arrows.map((a, i) => ({ a, letter: letters[i]! })).sort((p, q) => p.a.depth - q.a.depth);
  const ballRadius = shaftPx * 0.95;
  const ball = (): string => `<circle class="axis-origin" cx="${n1(ox)}" cy="${n1(oy)}" r="${n1(ballRadius)}" fill="url(#axis-ball)"/>\n`;
  let ballDrawn = false;
  for (const { a, letter } of order) {
    // The ball at the origin is drawn after the arrows that point away (it covers their starts) and before
    // those that point at the viewer (they come out of its face).
    if (!ballDrawn && a.depth > 0.02) {
      svg += ball();
      ballDrawn = true;
    }
    const n = Math.hypot(a.dx, a.dy); // drawn length; lengthPx when the axis lies in the screen
    // Direction on screen. Seen end on there is none; any direction then serves, the shapes are round.
    const [ux, uy] = n > 1e-6 ? [a.dx / n, a.dy / n] : [1, 0];
    // Across the arrow, on the side the light comes from (upper left).
    let [px, py] = [-uy, ux];
    if (px * -0.5 + py * -0.7 < 0) [px, py] = [-px, -py];
    // 0 in the screen plane, 1 end on. A readable arrow also keeps the shape of an arrow: its head is drawn as if
    // it were tilted no more than AXIS_MAX_TILT, since a cone seen nearly end on is a disc with a stub.
    // At most 1: an axis pointing straight at the viewer can come out a hair above 1 in floating point, and the
    // square roots below would then give NaN.
    const tilt = Math.min(1, scene.axesKeepReadable === false || n < 0.12 * full ? Math.abs(a.depth) : Math.min(Math.abs(a.depth), AXIS_MAX_TILT));
    const [tx, ty] = [ox + a.dx, oy + a.dy]; // tip
    const headOnScreen = headPx * Math.sqrt(Math.max(0, 1 - tilt * tilt));
    const [bx, by] = [tx - ux * headOnScreen, ty - uy * headOnScreen]; // centre of the cone's base
    const id = `axis-${a.name}`;
    const colour = colourOf(a.name);
    const baseShade = mixHex(colour, "#000000", 0.18);
    // Each arrow's outline is a darker shade of its own colour (the outline group sets only the width).
    if (scene.axesOutline) svg += `<g stroke="${mixHex(colour, "#000000", 0.45)}">`;
    // Shading across the arrow: lightest a third of the way in from the lit side, darkest on the far side.
    const across = (name: string, width: number, cx: number, cy: number, turned = ""): string =>
      `<linearGradient id="${name}" gradientUnits="userSpaceOnUse"${turned} x1="${n1(cx + (px * width) / 2)}" y1="${n1(cy + (py * width) / 2)}" x2="${n1(cx - (px * width) / 2)}" y2="${n1(cy - (py * width) / 2)}">` +
      `${rodStops(colour, scene.arrowMaterial ?? "soft")}</linearGradient>\n`;
    const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
    // The base ellipse is turned to the arrow's direction, which would turn its shading too; turn that back.
    const turnedBack = ` gradientTransform="rotate(${n1(-angle)} ${n1(bx)} ${n1(by)})"`;
    defs += across(`${id}-shaft`, shaftPx, ox, oy) + across(`${id}-head`, headWidthPx, bx, by) + across(`${id}-base`, headWidthPx, bx, by, turnedBack);
    const corner = (x: number, y: number, side: number, width: number): string => `${n1(x + (side * px * width) / 2)},${n1(y + (side * py * width) / 2)}`;
    // The shaft. An arrow that points at the viewer comes out of the face of the ball at the origin: its
    // shaft starts where it pierces the ball, with a rounded foot, and is drawn over the ball. One that points
    // away, or lies in the screen, starts at the centre and is drawn before the ball, which covers its start.
    const front = a.depth > 0.02;
    const [sx, sy] = front ? [ox + ux * ballRadius * Math.sqrt(1 - tilt * tilt), oy + uy * ballRadius * Math.sqrt(1 - tilt * tilt)] : [ox, oy];
    let shaftOutline = `${corner(sx, sy, 1, shaftPx)} ${corner(bx, by, 1, shaftPx)} ${corner(bx, by, -1, shaftPx)} ${corner(sx, sy, -1, shaftPx)}`;
    if (front) {
      for (let step = 1; step < 8; step++) {
        const phi = Math.PI * (1 - step / 8);
        const back = Math.sin(phi) * (shaftPx / 2) * tilt;
        shaftOutline += ` ${n1(sx - ux * back + (px * shaftPx * Math.cos(phi)) / 2)},${n1(sy - uy * back + (py * shaftPx * Math.cos(phi)) / 2)}`;
      }
    }
    const shaft = `<polygon class="axis-shaft" points="${shaftOutline}" fill="url(#${id}-shaft)"/>`;
    // The base of the cone is a circle seen at an angle: an ellipse, as wide as the head across the arrow
    // and `tilt` times that along it.
    const base = (fill: string, extra = ""): string =>
      `<ellipse class="axis-base" cx="${n1(bx)}" cy="${n1(by)}" rx="${n1((headWidthPx / 2) * tilt)}" ry="${n1(headWidthPx / 2)}" transform="rotate(${n1(angle)} ${n1(bx)} ${n1(by)})" fill="${fill}"${extra}/>`;
    if (a.depth >= 0) {
      // Pointing towards the viewer: the cone's side is seen down to the far half of its rim, as one shape,
      // covering its base and the end of the shaft (see coneOutline).
      svg +=
        shaft +
        base(`url(#${id}-base)`, ' stroke="none"') +
        `<polygon class="axis-head" points="${coneOutline(tx, ty, bx, by, ux, uy, px, py, headWidthPx / 2, tilt)}" fill="url(#${id}-head)"/>`;
    } else {
      // Pointing away: the same silhouette, with the flat base of the cone facing the viewer in a quiet shade
      // and no line of its own, and the shaft over it.
      svg += `<polygon class="axis-head" points="${coneOutline(tx, ty, bx, by, ux, uy, px, py, headWidthPx / 2, tilt)}" fill="url(#${id}-head)"/>` + base(baseShade, ' stroke="none"') + shaft;
    }
    if (letter) {
      // The baseline is set 0.3 em below the wanted centre, so no reader needs to support "dominant-baseline".
      svg +=
        `<text x="${n1(ox + letter.x)}" y="${n1(oy + letter.y + 0.3 * fontSize)}" text-anchor="middle" font-family="${fontList(scene.fontFamily)}" ` +
        `font-weight="${scene.letterWeight}" font-style="italic" font-size="${fontSize}" fill="${colour}" fill-opacity="1" stroke="none">${a.name}</text>`;
    }
    if (scene.axesOutline) svg += "</g>";
    svg += "\n";
  }
  if (!ballDrawn) svg += ball();
  return { svg, defs, left: ox + Math.min(...xs) };
}

/**
 * The figure as SVG text. `part` is for the page only, which shows the figure as two layers so that the
 * legend and axes can follow a movement without the structure being redrawn: "structure" is everything but
 * the legend and axes, "band" is only those. Together they hold exactly what "all" (the saved figure) holds.
 */
/** How a figure is drawn. `draft`: orbitals with a coarser edge where they meet atoms, for drawing while the view moves. */
export interface RenderOptions {
  readonly draft?: boolean;
}

export function renderSvg(scene: Scene, view: View, canvas: Canvas = DEFAULT_CANVAS, fit?: Fit, part: "all" | "structure" | "band" = "all", options: RenderOptions = {}): string {
  const drawn = part === "band" ? [] : layoutAll(scene, view, canvas, fit, options);
  const { width, height } = canvas;
  // With a size on paper the SVG states it, so a drawing program places the figure at exactly that size.
  const p = canvas.physical;
  const size = p ? `width="${+p.width.toFixed(3)}${p.unit}" height="${+p.height.toFixed(3)}${p.unit}"` : `width="${width}" height="${height}"`;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${width} ${height}">\n<defs>\n`;
  const used = new Set([...drawn.flatMap((d) => (d.kind === "sphere" ? [d.style] : [])), ...scene.legend.map((e) => e.style)]);
  const plain = new Set<string>();
  let pies = false;
  for (const key of used) {
    const style = scene.styles[key]!;
    if (style.wedges) pies = true;
    else plain.add(style.colour);
  }
  const material = scene.atomMaterial ?? "soft";
  for (const colour of material === "flat" ? [] : plain) {
    // One radial gradient per colour, highlight up and to the left.
    // Glass is shaded from its own centre (clear in the middle, coloured at the rim); the others from the highlight.
    const from = material === "glass" ? 'cx="50%" cy="50%" r="50%"' : 'cx="36%" cy="30%" r="72%"';
    out += `<radialGradient id="${gradientId(colour)}" ${from}>${sphereStops(colour, material, scene.glassOpacity)}</radialGradient>\n`;
  }
  if (material === "glossy" || material === "metal" || material === "glass") {
    // The highlight spot: white, fading out.
    out += `<radialGradient id="gloss"><stop offset="0" stop-color="#fff" stop-opacity="${material === "metal" ? 0.75 : 0.85}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>\n`;
  }
  if (pies) {
    // Laid over the flat wedges of a pie sphere: a highlight up and to the left, a shadow at the rim.
    out +=
      `<radialGradient id="${PIE_SHADE}" cx="36%" cy="30%" r="72%"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/>` +
      `<stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.28"/></radialGradient>\n`;
  }
  const axes = axesSvg(scene, view, canvas);
  out += `${axes.defs}</defs>\n`;
  if (canvas.background !== null && part !== "band") out += `<rect width="${width}" height="${height}" fill="${canvas.background}"/>\n`;
  // Zoomed or moved: the structure may reach past its space; it is cut off there, so it never runs under the legend.
  if (fit?.clip) {
    out += `<clipPath id="structure-space"><rect width="${width}" height="${structureHeight(scene, canvas)}"/></clipPath>\n<g clip-path="url(#structure-space)">\n`;
  }
  for (const d of drawn) {
    if (d.kind === "sphere") {
      out += sphereSvg(scene, d.style, d.x, d.y, d.r);
    } else if (d.kind === "sector") {
      out +=
        `<polygon class="angle" points="${d.points}" fill="${d.colour}" fill-opacity="${d.opacity}"/>` +
        `<polyline class="angle-arc" points="${d.arc}" fill="none" stroke="${d.colour}" stroke-width="3" stroke-linecap="round"/>\n`;
    } else if (d.kind === "polygon") {
      out += `<path class="fill" d="${d.parts[0]}" fill="${d.colour}" fill-opacity="${d.opacity}"/>\n`;
    } else if (d.kind === "band") {
      // A group, so that where two strokes of the band overlap the colour does not double.
      out += `<g class="band" opacity="${d.opacity}" stroke="${d.colour}" stroke-width="${n1(d.width)}" stroke-linecap="round">`;
      for (const part of d.parts) {
        const [p, q] = part.split(" ");
        out += `<line x1="${p!.split(",")[0]}" y1="${p!.split(",")[1]}" x2="${q!.split(",")[0]}" y2="${q!.split(",")[1]}"/>`;
      }
      out += "</g>\n";
    } else if (d.kind === "orbital" || d.kind === "polyhedron") {
      out += `${d.svg}\n`;
    } else if (d.kind === "arrow") {
      // The outline, when asked for: every shape of the arrow in the darker tone of its colour, as the spheres have.
      const outline = scene.arrowOutline ? ` stroke="${mixHex(d.colour ?? scene.arrowColour, "#000000", 0.45)}" stroke-width="${OUTLINE_WIDTH}" stroke-linejoin="round"` : "";
      out += `<g class="arrow"${outline}${scene.arrowMaterial === "glass" ? ` fill-opacity="${glassAlpha(0.45, scene.glassOpacity)}"` : ""}>${d.svg}</g>\n`;
    } else if (d.kind === "bond" && d.svg !== undefined) {
      out += `${d.svg}\n`;
    } else {
      const look =
        d.kind === "bond"
          ? `stroke="${d.colour ?? BOND_COLOUR}" stroke-width="${n1(d.width)}" stroke-linecap="round"${d.dash ? ` stroke-dasharray="${d.dash}"` : ""}`
          : cellStroke(scene, d.depth, d.along ?? 0);
      out += `<line class="${d.kind}" x1="${n1(d.x1)}" y1="${n1(d.y1)}" x2="${n1(d.x2)}" y2="${n1(d.y2)}" ${look}/>\n`;
    }
  }
  // Angle labels go on top of the structure, so that no atom hides a number.
  for (const d of drawn) {
    if (d.kind !== "sector" || !d.label) continue;
    const angleFont = textSize(scene.angleFontPt, ANGLE_LABEL_SIZE, canvas);
    out +=
      `<text class="angle-label" x="${n1(d.label.x)}" y="${n1(d.label.y + 0.35 * angleFont)}" text-anchor="middle" font-family="${fontList(scene.fontFamily)}" font-weight="${Math.min(scene.letterWeight, 600)}" ` +
      `font-size="${n1(angleFont)}" fill="${mixHex(d.colour, "#000000", 0.35)}" stroke="#ffffff" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${d.label.text}</text>\n`;
  }
  if (fit?.clip) out += "</g>\n";
  if (part === "structure") return `${out}</svg>\n`;
  // The band under the structure: axes on the right, legend on the left in the space that remains.
  const legendScale = scene.legendFollowsZoom ? (fit ?? fitView(scene, view, canvas)).scale : undefined;
  for (const item of legendLayout(scene, canvas, axes.left - 40, legendScale)) {
    out += sphereSvg(scene, item.style, item.x, item.y, item.r);
    // Baseline 0.35 em below the sphere's centre: capitals are then centred on it.
    out +=
      `<text class="legend" x="${n1(item.textX)}" y="${n1(item.y + 0.35 * item.fontSize)}" font-family="${fontList(scene.fontFamily)}" font-weight="${scene.letterWeight}" ` +
      `font-size="${n1(item.fontSize)}" fill="${LEGEND_COLOUR}">${escapeXml(item.name)}</text>\n`;
  }
  const axesGlass = scene.arrowMaterial === "glass" ? ` fill-opacity="${glassAlpha(0.45, scene.glassOpacity)}"` : "";
  out += scene.axesOutline
    ? `<g class="axes-outline" stroke="${mixHex(AXIS_COLOUR, "#000000", 0.45)}" stroke-width="${OUTLINE_WIDTH}" stroke-linejoin="round"${axesGlass}>${axes.svg}</g>\n`
    : axesGlass
      ? `<g${axesGlass}>${axes.svg}</g>\n`
      : axes.svg;
  return `${out}</svg>\n`;
}
