// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Scene + view -> SVG text. This text is the figure: the screen shows it, the
 * SVG export saves it, and the PNG export rasterises it.
 */
import { mulVec } from "../structure/cell";
import { mixHex } from "../scene/elementStyle";
import type { Scene, Wedge } from "../scene/scene";
import type { Vec3 } from "../structure/types";
import type { View } from "./view";

export interface Canvas {
  readonly width: number;
  readonly height: number;
  /** Empty space kept around the structure, in px. */
  readonly margin: number;
  /** Background colour, or null for a transparent figure. */
  readonly background: string | null;
}

export const DEFAULT_CANVAS: Canvas = { width: 1440, height: 1100, margin: 50, background: null };

/** Look of the parts that are not atoms. Lengths in angstrom scale with the drawing; px do not. */
export const BOND_COLOUR = "#b4bbc1";
/** Bond thickness in angstrom. */
export const BOND_WIDTH = 0.12;
/** A bond starts this fraction of the radius from each atom's centre: just under the surface, so no gap shows. */
export const BOND_START = 0.9;
/** Cell edges are drawn in pieces at most this long, in angstrom. */
export const CELL_PIECE = 0.5;
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
}

/** One visible part of a moment arrow: a shaft, and for the front part the head triangle. End points in px. */
export interface DrawnArrow {
  readonly kind: "arrow";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly width: number;
  /** The head as three corners "x,y x,y x,y"; absent for the tail part. */
  readonly head?: string;
  readonly depth: number;
}

/** A filled polygon, or a highlight band (several wide strokes drawn as one translucent shape). */
interface Shape<K extends string> {
  readonly kind: K;
  /** Polygon: its corners "x,y x,y ...". Band: one "x1,y1 x2,y2" per segment. */
  readonly parts: readonly string[];
  readonly colour: string;
  readonly opacity: number;
  /** Band only: stroke width in px. */
  readonly width: number;
  readonly depth: number;
}

export type DrawnPolygon = Shape<"polygon">;
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

/** Number of straight pieces the arc of a sector is drawn with, per 180 degrees. */
const ARC_PIECES = 48;
/** Size of the angle labels, px. */
export const ANGLE_LABEL_SIZE = 40;

/** Moment arrows, in angstrom: shaft thickness, head length and head width. */
export const ARROW_SHAFT = 0.16;
export const ARROW_HEAD_LENGTH = 0.55;
export const ARROW_HEAD_WIDTH = 0.46;

/** Lettering of the legend and the axes. Avenir exists on macOS; elsewhere the next font in the list is used. */
export const FONT = "Avenir, 'Avenir Next', 'Helvetica Neue', Arial, sans-serif";
export const LEGEND_COLOUR = "#4c5a62";
export const AXIS_COLOUR = "#5c6b74";
/** Height in px of the band under the structure that holds the legend and the axes. */
export const BAND = 200;

/** Height of the part of the canvas the structure is fitted into: all of it, less the band when there is a legend or axes. */
export function structureHeight(scene: Scene, canvas: Canvas): number {
  return canvas.height - (scene.legend.length > 0 || scene.axes.length > 0 ? BAND : 0);
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
    for (const sign of [-0.5, 0.5]) include([c[0] + sign * a.vector[0], c[1] + sign * a.vector[1], c[2] + sign * a.vector[2]], ARROW_HEAD_WIDTH / 2);
  }
  const height = structureHeight(scene, canvas);
  if (box.x0 > box.x1) return { scale: 1, x: canvas.width / 2, y: height / 2 };
  // At least 1 A wide and high, so a single atom is not blown up to fill the canvas.
  const [w, h] = [Math.max(box.x1 - box.x0, 1), Math.max(box.y1 - box.y0, 1)];
  const scale = Math.min((canvas.width - 2 * canvas.margin) / w, (height - 2 * canvas.margin) / h, MAX_SCALE);
  // The middle of the outline goes to the middle of the space (screen y is up, SVG y is down).
  return { scale, x: canvas.width / 2 - ((box.x0 + box.x1) / 2) * scale, y: height / 2 + ((box.y0 + box.y1) / 2) * scale };
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
  for (const stick of scene.sticks) {
    const [a, b] = [scene.spheres[stick.i]!, scene.spheres[stick.j]!];
    const [ra, rb] = [scene.styles[a.style]!.radius * BOND_START, scene.styles[b.style]!.radius * BOND_START];
    if (stick.length <= ra + rb) continue; // the spheres overlap: nothing of the bond shows
    // From just under one surface to just under the other, along the line of centres.
    const at = (t: number): Vec3 => [0, 1, 2].map((i) => a.centre[i]! + (b.centre[i]! - a.centre[i]!) * t) as unknown as Vec3;
    const [p, q] = [project(at(ra / stick.length)), project(at(1 - rb / stick.length))];
    // Drawn just behind an atom at the same depth, so the nearer atom covers its end of the bond.
    const look = scene.stickStyles[stick.rule] ?? { colour: BOND_COLOUR, width: BOND_WIDTH };
    const colour = stick.pale ? mixHex(look.colour, "#ffffff", 0.55) : look.colour;
    const width = (stick.pale ? 0.65 : 1) * look.width * scale;
    drawn.push({ kind: "bond", colour, x1: p[0], y1: p[1], x2: q[0], y2: q[1], width, depth: (p[2] + q[2]) / 2 - 0.1 });
  }
  for (const polygon of scene.polygons) {
    // Just behind its own atoms and bonds.
    const corners = polygon.corners.map((c) => project(scene.spheres[c]!.centre));
    const depth = corners.reduce((sum, c) => sum + c[2], 0) / corners.length - 0.4;
    drawn.push({ kind: "polygon", parts: [corners.map((c) => `${n1(c[0])},${n1(c[1])}`).join(" ")], colour: polygon.colour, opacity: polygon.opacity, width: 0, depth });
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
    const labelAt = at(0.5, sector.radius + (0.62 * ANGLE_LABEL_SIZE) / scale);
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
  for (const arrow of scene.arrows) {
    // The arrow passes through the atom, centred on it. The part inside the sphere is never visible, so two
    // parts are drawn: tail end to the surface, and surface to tip. Each has its own depth, so the part
    // pointing away from the viewer is hidden by the atom and the part pointing towards the viewer lies over it.
    const sphere = scene.spheres[arrow.sphere]!;
    const radius = scene.styles[sphere.style]!.radius;
    const half = Math.hypot(arrow.vector[0], arrow.vector[1], arrow.vector[2]) / 2;
    if (half <= radius) continue;
    const unit: Vec3 = [arrow.vector[0] / (2 * half), arrow.vector[1] / (2 * half), arrow.vector[2] / (2 * half)];
    const at = (t: number): Vec3 => [sphere.centre[0] + unit[0] * t, sphere.centre[1] + unit[1] * t, sphere.centre[2] + unit[2] * t];
    const headLength = Math.min(ARROW_HEAD_LENGTH, half - radius);
    const [tail, tailEnd, start, base, tip] = [project(at(-half)), project(at(-radius)), project(at(radius)), project(at(half - headLength)), project(at(half))];
    const width = ARROW_SHAFT * scale;
    drawn.push({ kind: "arrow", x1: tail[0], y1: tail[1], x2: tailEnd[0], y2: tailEnd[1], width, depth: (tail[2] + tailEnd[2]) / 2 });
    // The head: its base is perpendicular, on screen, to the arrow.
    const [hx, hy] = [tip[0] - base[0], tip[1] - base[1]];
    const n = Math.hypot(hx, hy);
    const w = (ARROW_HEAD_WIDTH * scale) / 2;
    const head =
      n > 1e-6
        ? `${n1(tip[0])},${n1(tip[1])} ${n1(base[0] - (hy / n) * w)},${n1(base[1] + (hx / n) * w)} ${n1(base[0] + (hy / n) * w)},${n1(base[1] - (hx / n) * w)}`
        : undefined;
    drawn.push({ kind: "arrow", x1: start[0], y1: start[1], x2: base[0], y2: base[1], width, depth: (start[2] + tip[2]) / 2, ...(head !== undefined ? { head } : {}) });
  }
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
  if (style.wedges) {
    return `${wedgePaths(x, y, r, style.wedges)}<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r)}" fill="url(#${PIE_SHADE})" stroke="${PIE_OUTLINE}" stroke-width="2"/>\n`;
  }
  const outline = mixHex(style.colour, "#000000", 0.35);
  return `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(r)}" fill="url(#${gradientId(style.colour)})" stroke="${outline}" stroke-width="2"/>\n`;
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
export function legendLayout(scene: Scene, canvas: Canvas, available: number): LegendItem[] {
  if (scene.legend.length === 0) return [];
  const largest = Math.max(...scene.legend.map((e) => scene.styles[e.style]!.radius));
  const place = (k: number): { items: LegendItem[]; end: number } => {
    const items: LegendItem[] = [];
    let x = 60 * k;
    for (const e of scene.legend) {
      const r = Math.max(14, (44 * scene.styles[e.style]!.radius) / largest) * k;
      const fontSize = 92 * k;
      const textX = x + 2 * r + 22 * k;
      items.push({ style: e.style, name: e.name, x: x + r, y: canvas.height - 92, r, textX, fontSize });
      x = textX + textWidth(e.name, fontSize) + 70 * k;
    }
    return { items, end: x - 70 * k };
  };
  const full = place(1);
  return full.end <= available ? full.items : place(available / full.end).items;
}

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
export function axisArrows(scene: Scene, view: View): AxisArrow[] {
  return scene.axes.map((axis) => {
    const p = mulVec(view, axis.direction);
    return { name: axis.name, dx: p[0] * AXIS_LENGTH, dy: -p[1] * AXIS_LENGTH, depth: p[2] };
  });
}

/** Sizes of the axis arrows, px: shaft thickness, head length and head width. */
const AXIS_SHAFT = 13;
const AXIS_HEAD = 42;
const AXIS_HEAD_WIDTH = 36;

/**
 * The axis triad as SVG, placed so that it sits in the bottom right corner whatever the orientation.
 * Each arrow is drawn as a solid: a round shaft and a cone head, shaded like the spheres (light from
 * the upper left). The cone's round base is drawn as the ellipse it appears as, so an arrow pointing
 * at the viewer shows the cone face on, and one pointing away shows its flat base. Still plain vector
 * shapes with gradients.
 */
function axesSvg(scene: Scene, view: View, canvas: Canvas): { svg: string; defs: string; left: number } {
  const arrows = axisArrows(scene, view);
  if (arrows.length === 0) return { svg: "", defs: "", left: canvas.width };
  const [labelGap, fontSize] = [42, 76];
  // Where each letter goes, relative to the origin; an axis seen end on has no direction on screen and gets no letter.
  const letters = arrows.map((a) => {
    const n = Math.hypot(a.dx, a.dy);
    return n < 0.12 * AXIS_LENGTH ? null : { x: a.dx + (a.dx / n) * labelGap, y: a.dy + (a.dy / n) * labelGap };
  });
  const half = AXIS_HEAD_WIDTH / 2;
  const xs = [-half, half, ...arrows.flatMap((a) => [a.dx - half, a.dx + half]), ...letters.flatMap((l) => (l ? [l.x - fontSize * 0.4, l.x + fontSize * 0.4] : []))];
  const ys = [-half, half, ...arrows.flatMap((a) => [a.dy - half, a.dy + half]), ...letters.flatMap((l) => (l ? [l.y - fontSize * 0.45, l.y + fontSize * 0.45] : []))];
  const ox = canvas.width - 45 - Math.max(...xs);
  const oy = canvas.height - 25 - Math.max(...ys);
  const [light, dark, darker] = [mixHex(AXIS_COLOUR, "#ffffff", 0.55), mixHex(AXIS_COLOUR, "#000000", 0.3), mixHex(AXIS_COLOUR, "#000000", 0.45)];
  let defs =
    `<radialGradient id="axis-ball" cx="36%" cy="30%" r="72%"><stop offset="0" stop-color="${light}"/>` +
    `<stop offset="0.55" stop-color="${AXIS_COLOUR}"/><stop offset="1" stop-color="${dark}"/></radialGradient>\n`;
  let svg = "";
  // Back to front: the arrow pointing most away from the viewer first; the ball at the origin between
  // the arrows that point away and those that point towards the viewer.
  const order = arrows.map((a, i) => ({ a, letter: letters[i]! })).sort((p, q) => p.a.depth - q.a.depth);
  const ball = (): string => `<circle class="axis-origin" cx="${n1(ox)}" cy="${n1(oy)}" r="${n1(AXIS_SHAFT * 0.85)}" fill="url(#axis-ball)"/>\n`;
  let ballDrawn = false;
  for (const { a, letter } of order) {
    if (!ballDrawn && a.depth >= 0) {
      svg += ball();
      ballDrawn = true;
    }
    const n = Math.hypot(a.dx, a.dy); // drawn length; AXIS_LENGTH when the axis lies in the screen
    // Direction on screen. Seen end on there is none; any direction then serves, the shapes are round.
    const [ux, uy] = n > 1e-6 ? [a.dx / n, a.dy / n] : [1, 0];
    // Across the arrow, on the side the light comes from (upper left).
    let [px, py] = [-uy, ux];
    if (px * -0.5 + py * -0.7 < 0) [px, py] = [-px, -py];
    const tilt = Math.abs(a.depth); // 0 in the screen plane, 1 end on
    const [tx, ty] = [ox + a.dx, oy + a.dy]; // tip
    const headOnScreen = AXIS_HEAD * Math.sqrt(Math.max(0, 1 - tilt * tilt));
    const [bx, by] = [tx - ux * headOnScreen, ty - uy * headOnScreen]; // centre of the cone's base
    const id = `axis-${a.name}`;
    // Shading across the arrow: lightest a third of the way in from the lit side, darkest on the far side.
    const across = (name: string, width: number, cx: number, cy: number): string =>
      `<linearGradient id="${name}" gradientUnits="userSpaceOnUse" x1="${n1(cx + (px * width) / 2)}" y1="${n1(cy + (py * width) / 2)}" x2="${n1(cx - (px * width) / 2)}" y2="${n1(cy - (py * width) / 2)}">` +
      `<stop offset="0" stop-color="${AXIS_COLOUR}"/><stop offset="0.3" stop-color="${light}"/><stop offset="0.65" stop-color="${AXIS_COLOUR}"/><stop offset="1" stop-color="${dark}"/></linearGradient>\n`;
    defs += across(`${id}-shaft`, AXIS_SHAFT, ox, oy) + across(`${id}-head`, AXIS_HEAD_WIDTH, bx, by);
    const corner = (x: number, y: number, side: number, width: number): string => `${n1(x + (side * px * width) / 2)},${n1(y + (side * py * width) / 2)}`;
    const shaft = `<polygon class="axis-shaft" points="${corner(ox, oy, 1, AXIS_SHAFT)} ${corner(bx, by, 1, AXIS_SHAFT)} ${corner(bx, by, -1, AXIS_SHAFT)} ${corner(ox, oy, -1, AXIS_SHAFT)}" fill="url(#${id}-shaft)"/>`;
    // The base of the cone is a circle seen at an angle: an ellipse, as wide as the head across the arrow
    // and `tilt` times that along it.
    const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
    const base = (fill: string): string =>
      `<ellipse class="axis-base" cx="${n1(bx)}" cy="${n1(by)}" rx="${n1((AXIS_HEAD_WIDTH / 2) * tilt)}" ry="${n1(AXIS_HEAD_WIDTH / 2)}" transform="rotate(${n1(angle)} ${n1(bx)} ${n1(by)})" fill="${fill}"/>`;
    const cone = `<polygon class="axis-head" points="${n1(tx)},${n1(ty)} ${corner(bx, by, 1, AXIS_HEAD_WIDTH)} ${corner(bx, by, -1, AXIS_HEAD_WIDTH)}" fill="url(#${id}-head)"/>`;
    if (a.depth >= 0) {
      // Pointing towards the viewer: the cone's side is seen, covering its base and the end of the shaft.
      svg += shaft + base(`url(#${id}-head)`) + cone;
    } else {
      // Pointing away: the flat base of the cone faces the viewer and covers the cone behind it; the shaft comes last.
      svg += cone + base(darker) + shaft;
    }
    if (letter) {
      // The baseline is set 0.3 em below the wanted centre, so no reader needs to support "dominant-baseline".
      svg +=
        `<text x="${n1(ox + letter.x)}" y="${n1(oy + letter.y + 0.3 * fontSize)}" text-anchor="middle" font-family="${FONT}" ` +
        `font-weight="${scene.letterWeight}" font-style="italic" font-size="${fontSize}" fill="${AXIS_COLOUR}">${a.name}</text>`;
    }
    svg += "\n";
  }
  if (!ballDrawn) svg += ball();
  return { svg, defs, left: ox + Math.min(...xs) };
}

export function renderSvg(scene: Scene, view: View, canvas: Canvas = DEFAULT_CANVAS, fit?: Fit): string {
  const drawn = layoutAll(scene, view, canvas, fit);
  const { width, height } = canvas;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n<defs>\n`;
  const used = new Set([...drawn.flatMap((d) => (d.kind === "sphere" ? [d.style] : [])), ...scene.legend.map((e) => e.style)]);
  const plain = new Set<string>();
  let pies = false;
  for (const key of used) {
    const style = scene.styles[key]!;
    if (style.wedges) pies = true;
    else plain.add(style.colour);
  }
  for (const colour of plain) {
    // One radial gradient per colour, highlight up and to the left.
    out +=
      `<radialGradient id="${gradientId(colour)}" cx="36%" cy="30%" r="72%">` +
      `<stop offset="0" stop-color="${mixHex(colour, "#ffffff", 0.65)}"/>` +
      `<stop offset="0.55" stop-color="${colour}"/>` +
      `<stop offset="1" stop-color="${mixHex(colour, "#000000", 0.35)}"/></radialGradient>\n`;
  }
  if (pies) {
    // Laid over the flat wedges of a pie sphere: a highlight up and to the left, a shadow at the rim.
    out +=
      `<radialGradient id="${PIE_SHADE}" cx="36%" cy="30%" r="72%"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/>` +
      `<stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.28"/></radialGradient>\n`;
  }
  const axes = axesSvg(scene, view, canvas);
  out += `${axes.defs}</defs>\n`;
  if (canvas.background !== null) out += `<rect width="${width}" height="${height}" fill="${canvas.background}"/>\n`;
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
      out += `<polygon class="fill" points="${d.parts[0]}" fill="${d.colour}" fill-opacity="${d.opacity}"/>\n`;
    } else if (d.kind === "band") {
      // A group, so that where two strokes of the band overlap the colour does not double.
      out += `<g class="band" opacity="${d.opacity}" stroke="${d.colour}" stroke-width="${n1(d.width)}" stroke-linecap="round">`;
      for (const part of d.parts) {
        const [p, q] = part.split(" ");
        out += `<line x1="${p!.split(",")[0]}" y1="${p!.split(",")[1]}" x2="${q!.split(",")[0]}" y2="${q!.split(",")[1]}"/>`;
      }
      out += "</g>\n";
    } else if (d.kind === "arrow") {
      out += `<line class="arrow" x1="${n1(d.x1)}" y1="${n1(d.y1)}" x2="${n1(d.x2)}" y2="${n1(d.y2)}" stroke="${scene.arrowColour}" stroke-width="${n1(d.width)}" stroke-linecap="butt"/>`;
      if (d.head) out += `<polygon class="arrow-head" points="${d.head}" fill="${scene.arrowColour}"/>`;
      out += "\n";
    } else {
      const look =
        d.kind === "bond"
          ? `stroke="${d.colour ?? BOND_COLOUR}" stroke-width="${n1(d.width)}" stroke-linecap="round"`
          : `${CELL_STROKE} stroke-dashoffset="${n1(d.along ?? 0)}"`;
      out += `<line class="${d.kind}" x1="${n1(d.x1)}" y1="${n1(d.y1)}" x2="${n1(d.x2)}" y2="${n1(d.y2)}" ${look}/>\n`;
    }
  }
  // Angle labels go on top of the structure, so that no atom hides a number.
  for (const d of drawn) {
    if (d.kind !== "sector" || !d.label) continue;
    out +=
      `<text class="angle-label" x="${n1(d.label.x)}" y="${n1(d.label.y + 0.35 * ANGLE_LABEL_SIZE)}" text-anchor="middle" font-family="${FONT}" font-weight="${Math.min(scene.letterWeight, 600)}" ` +
      `font-size="${ANGLE_LABEL_SIZE}" fill="${mixHex(d.colour, "#000000", 0.35)}" stroke="#ffffff" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${d.label.text}</text>\n`;
  }
  if (fit?.clip) out += "</g>\n";
  // The band under the structure: axes on the right, legend on the left in the space that remains.
  for (const item of legendLayout(scene, canvas, axes.left - 40)) {
    out += sphereSvg(scene, item.style, item.x, item.y, item.r);
    // Baseline 0.35 em below the sphere's centre: capitals are then centred on it.
    out +=
      `<text class="legend" x="${n1(item.textX)}" y="${n1(item.y + 0.35 * item.fontSize)}" font-family="${FONT}" font-weight="${scene.letterWeight}" ` +
      `font-size="${n1(item.fontSize)}" fill="${LEGEND_COLOUR}">${escapeXml(item.name)}</text>\n`;
  }
  out += axes.svg;
  return `${out}</svg>\n`;
}
