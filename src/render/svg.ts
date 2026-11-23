// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Scene + view -> SVG text. This text is the figure: the screen shows it, the
 * SVG export saves it, and the PNG export rasterises it.
 */
import { mulVec } from "../structure/cell";
import { mixHex } from "../scene/elementStyle";
import type { Material, Scene, StickStyle, Wedge } from "../scene/scene";
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

export type Drawn = DrawnSphere | DrawnLine | DrawnArrow | DrawnPolygon | DrawnBand | DrawnSector;

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
 * the outline of everything drawn is centred and scaled to touch the margins.
 * (While the user drags, the page keeps the placement of the moment the drag began, so nothing jumps;
 * the figure is refitted on release.)
 */
export function fitView(scene: Scene, view: View, canvas: Canvas): Fit {
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
  for (const a of scene.arrows) {
    const c = scene.spheres[a.sphere]!.centre;
    for (const sign of a.start === "centre" ? [0, 1] : [-0.5 * (a.tail ?? 1), 0.5]) include([c[0] + sign * a.vector[0], c[1] + sign * a.vector[1], c[2] + sign * a.vector[2]], arrowSizes(scene, a).headWidth / 2);
  }
  const height = structureHeight(scene, canvas);
  if (box.x0 > box.x1) return { scale: 1, x: canvas.width / 2, y: height / 2 };
  // At least 1 A wide and high, so a single atom is not blown up to fill the canvas.
  const [w, h] = [Math.max(box.x1 - box.x0, 1), Math.max(box.y1 - box.y0, 1)];
  const scale = Math.min((canvas.width - 2 * canvas.margin) / w, (height - 2 * canvas.margin) / h, MAX_SCALE);
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
export function layoutAll(scene: Scene, view: View, canvas: Canvas, fit: Fit = fitView(scene, view, canvas)): Drawn[] {
  const scale = fit.scale;
  // Screen position (px) and depth (angstrom) of a point given in angstrom.
  const project = (p: Vec3): Vec3 => {
    const q = mulVec(view, [p[0] - scene.centre[0], p[1] - scene.centre[1], p[2] - scene.centre[2]]);
    return [fit.x + q[0] * scale, fit.y - q[1] * scale, q[2]]; // SVG y runs down
  };
  const drawn: Drawn[] = [];
  for (const s of scene.spheres) {
    const [x, y, depth] = project(s.centre);
    drawn.push({ kind: "sphere", x, y, depth, r: scene.styles[s.style]!.radius * scale, style: s.style, label: s.label });
  }
  // Bonds. With a surface chosen (and not too many of them) each bond is a round rod, drawn as the rods of the
  // arrows are: in two halves that meet in the middle, each belonging to the atom it starts from. A half that
  // points away from the viewer, or lies in the screen, starts at its atom's centre and is drawn before the
  // atom, whose outline cuts it. A half that points at the viewer comes out of the atom's face: it is drawn
  // after the atom, from the small circle where it pierces the surface (an ellipse when seen at an angle).
  const rods = scene.bondMaterial !== undefined && scene.sticks.length <= BOND_ROD_LIMIT;
  scene.sticks.forEach((stick, stickIndex) => {
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
      drawn.push({ kind: "cell", x1: p[0], y1: p[1], x2: q[0], y2: q[1], width: 0, depth: (p[2] + q[2]) / 2 - 0.3, along: (drawnLength * n) / pieces });
    }
  }
  return drawn.sort((p, q) => p.depth - q.depth);
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
  return `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r)}" fill="${fill}" stroke="${outline}" stroke-width="2"${material === "glass" ? ' stroke-opacity="0.85" stroke-width="1.5"' : ""}/>${glow}${gloss}\n`;
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
    const tilt = scene.axesKeepReadable === false || n < 0.12 * full ? Math.abs(a.depth) : Math.min(Math.abs(a.depth), AXIS_MAX_TILT);
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
export function renderSvg(scene: Scene, view: View, canvas: Canvas = DEFAULT_CANVAS, fit?: Fit, part: "all" | "structure" | "band" = "all"): string {
  const drawn = part === "band" ? [] : layoutAll(scene, view, canvas, fit);
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
