/**
 * Scene + view -> SVG text. This text is the figure: the screen shows it, the
 * SVG export saves it, and the PNG export rasterises it.
 */
import { mulVec } from "../structure/cell";
import { mixHex } from "../scene/elementStyle";
import type { Scene } from "../scene/scene";
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

/** Px per angstrom. Depends on the scene and the canvas, not on the view. */
export function pxPerAngstrom(scene: Scene, canvas: Canvas): number {
  return (Math.min(canvas.width, canvas.height) - 2 * canvas.margin) / (2 * scene.extent);
}

/** Project everything and order it back to front. */
export function layoutAll(scene: Scene, view: View, canvas: Canvas): Drawn[] {
  const scale = pxPerAngstrom(scene, canvas);
  // Screen position (px) and depth (angstrom) of a point given in angstrom.
  const project = (p: Vec3): Vec3 => {
    const q = mulVec(view, [p[0] - scene.centre[0], p[1] - scene.centre[1], p[2] - scene.centre[2]]);
    return [canvas.width / 2 + q[0] * scale, canvas.height / 2 - q[1] * scale, q[2]]; // SVG y runs down
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
export function layout(scene: Scene, view: View, canvas: Canvas): DrawnSphere[] {
  return layoutAll(scene, view, canvas).filter((d): d is DrawnSphere => d.kind === "sphere");
}

const n1 = (v: number): string => (Math.round(v * 10) / 10).toString();
const gradientId = (style: string): string => `g-${style.replace(/[^A-Za-z0-9]/g, "_")}`;

export function renderSvg(scene: Scene, view: View, canvas: Canvas = DEFAULT_CANVAS): string {
  const { width, height } = canvas;
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n<defs>\n`;
  for (const [style, { colour }] of Object.entries(scene.styles)) {
    // One radial gradient per element, highlight up and to the left.
    out +=
      `<radialGradient id="${gradientId(style)}" cx="36%" cy="30%" r="72%">` +
      `<stop offset="0" stop-color="${mixHex(colour, "#ffffff", 0.65)}"/>` +
      `<stop offset="0.55" stop-color="${colour}"/>` +
      `<stop offset="1" stop-color="${mixHex(colour, "#000000", 0.35)}"/></radialGradient>\n`;
  }
  out += "</defs>\n";
  if (canvas.background !== null) out += `<rect width="${width}" height="${height}" fill="${canvas.background}"/>\n`;
  for (const d of layoutAll(scene, view, canvas)) {
    if (d.kind === "sphere") {
      const outline = mixHex(scene.styles[d.style]!.colour, "#000000", 0.35);
      out += `<circle cx="${n1(d.x)}" cy="${n1(d.y)}" r="${n1(d.r)}" fill="url(#${gradientId(d.style)})" stroke="${outline}" stroke-width="2"/>\n`;
    } else {
      const look =
        d.kind === "bond"
          ? `stroke="${BOND_COLOUR}" stroke-width="${n1(d.width)}" stroke-linecap="round"`
          : `${CELL_STROKE} stroke-dashoffset="${n1(d.along ?? 0)}"`;
      out += `<line class="${d.kind}" x1="${n1(d.x1)}" y1="${n1(d.y1)}" x2="${n1(d.x2)}" y2="${n1(d.y2)}" ${look}/>\n`;
    }
  }
  return `${out}</svg>\n`;
}
