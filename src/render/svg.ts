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

export type Drawn = DrawnSphere | DrawnLine;

/** Lettering of the legend and the axes. Avenir exists on macOS; elsewhere the next font in the list is used. */
export const FONT = "'Avenir Next', Avenir, 'Helvetica Neue', Arial, sans-serif";
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
    drawn.push({ kind: "bond", x1: p[0], y1: p[1], x2: q[0], y2: q[1], width: BOND_WIDTH * scale, depth: (p[2] + q[2]) / 2 - 0.1 });
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

/** The axis triad as SVG, placed so that it sits in the bottom right corner whatever the orientation. */
function axesSvg(scene: Scene, view: View, canvas: Canvas): { svg: string; left: number } {
  const arrows = axisArrows(scene, view);
  if (arrows.length === 0) return { svg: "", left: canvas.width };
  const [head, labelGap, fontSize, stroke] = [32, 42, 76, 9];
  // Where each letter goes, relative to the origin; an axis seen end on has no direction on screen and gets no letter.
  const letters = arrows.map((a) => {
    const n = Math.hypot(a.dx, a.dy);
    return n < 0.12 * AXIS_LENGTH ? null : { x: a.dx + (a.dx / n) * labelGap, y: a.dy + (a.dy / n) * labelGap };
  });
  const xs = [0, ...arrows.map((a) => a.dx), ...letters.flatMap((l) => (l ? [l.x - fontSize * 0.4, l.x + fontSize * 0.4] : []))];
  const ys = [0, ...arrows.map((a) => a.dy), ...letters.flatMap((l) => (l ? [l.y - fontSize * 0.45, l.y + fontSize * 0.45] : []))];
  const ox = canvas.width - 45 - Math.max(...xs);
  const oy = canvas.height - 25 - Math.max(...ys);
  let svg = "";
  // Back to front: the arrow pointing most away from the viewer first.
  const order = arrows.map((a, i) => ({ a, letter: letters[i]! })).sort((p, q) => p.a.depth - q.a.depth);
  const drawOrigin = (): string => `<circle class="axis-origin" cx="${n1(ox)}" cy="${n1(oy)}" r="9" fill="${AXIS_COLOUR}"/>\n`;
  let originDrawn = false;
  for (const { a, letter } of order) {
    if (!originDrawn && a.depth >= 0) {
      svg += drawOrigin();
      originDrawn = true;
    }
    const n = Math.hypot(a.dx, a.dy);
    if (n < 1) continue;
    const [ux, uy] = [a.dx / n, a.dy / n];
    const h = Math.min(head, 0.45 * n); // a foreshortened axis gets a smaller head
    const [bx, by] = [ox + a.dx - ux * h, oy + a.dy - uy * h];
    svg +=
      `<line class="axis" x1="${n1(ox)}" y1="${n1(oy)}" x2="${n1(bx)}" y2="${n1(by)}" stroke="${AXIS_COLOUR}" stroke-width="${stroke}" stroke-linecap="round"/>` +
      `<polygon points="${n1(ox + a.dx)},${n1(oy + a.dy)} ${n1(bx - (uy * h) / 2)},${n1(by + (ux * h) / 2)} ${n1(bx + (uy * h) / 2)},${n1(by - (ux * h) / 2)}" fill="${AXIS_COLOUR}"/>`;
    if (letter) {
      // The baseline is set 0.3 em below the wanted centre, so no reader needs to support "dominant-baseline".
      svg +=
        `<text x="${n1(ox + letter.x)}" y="${n1(oy + letter.y + 0.3 * fontSize)}" text-anchor="middle" font-family="${FONT}" ` +
        `font-weight="800" font-style="italic" font-size="${fontSize}" fill="${AXIS_COLOUR}">${a.name}</text>`;
    }
    svg += "\n";
  }
  if (!originDrawn) svg += drawOrigin();
  return { svg, left: ox + Math.min(...xs) };
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
  out += "</defs>\n";
  if (canvas.background !== null) out += `<rect width="${width}" height="${height}" fill="${canvas.background}"/>\n`;
  for (const d of drawn) {
    if (d.kind === "sphere") {
      out += sphereSvg(scene, d.style, d.x, d.y, d.r);
    } else {
      const look =
        d.kind === "bond"
          ? `stroke="${BOND_COLOUR}" stroke-width="${n1(d.width)}" stroke-linecap="round"`
          : `${CELL_STROKE} stroke-dashoffset="${n1(d.along ?? 0)}"`;
      out += `<line class="${d.kind}" x1="${n1(d.x1)}" y1="${n1(d.y1)}" x2="${n1(d.x2)}" y2="${n1(d.y2)}" ${look}/>\n`;
    }
  }
  // The band under the structure: axes on the right, legend on the left in the space that remains.
  const axes = axesSvg(scene, view, canvas);
  for (const item of legendLayout(scene, canvas, axes.left - 40)) {
    out += sphereSvg(scene, item.style, item.x, item.y, item.r);
    // Baseline 0.35 em below the sphere's centre: capitals are then centred on it.
    out +=
      `<text class="legend" x="${n1(item.textX)}" y="${n1(item.y + 0.35 * item.fontSize)}" font-family="${FONT}" font-weight="800" ` +
      `font-size="${n1(item.fontSize)}" fill="${LEGEND_COLOUR}">${escapeXml(item.name)}</text>\n`;
  }
  out += axes.svg;
  return `${out}</svg>\n`;
}
