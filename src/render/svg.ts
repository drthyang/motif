/**
 * Scene + view -> SVG text. This text is the figure: the screen shows it, the
 * SVG export saves it, and the PNG export rasterises it.
 */
import { mulVec } from "../structure/cell";
import { mixHex } from "../scene/elementStyle";
import type { Scene } from "../scene/scene";
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

/** A sphere as drawn: centre and radius in px, depth in angstrom (larger = nearer the viewer). */
export interface DrawnSphere {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly depth: number;
  readonly style: string;
  readonly label: string;
}

/** Project the spheres and order them back to front. */
export function layout(scene: Scene, view: View, canvas: Canvas): DrawnSphere[] {
  const scale = (Math.min(canvas.width, canvas.height) - 2 * canvas.margin) / (2 * scene.extent);
  const drawn = scene.spheres.map((s) => {
    const p = mulVec(view, [s.centre[0] - scene.centre[0], s.centre[1] - scene.centre[1], s.centre[2] - scene.centre[2]]);
    return {
      x: canvas.width / 2 + p[0] * scale,
      y: canvas.height / 2 - p[1] * scale, // SVG y runs down
      r: scene.styles[s.style]!.radius * scale,
      depth: p[2],
      style: s.style,
      label: s.label,
    };
  });
  return drawn.sort((p, q) => p.depth - q.depth);
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
  for (const s of layout(scene, view, canvas)) {
    const outline = mixHex(scene.styles[s.style]!.colour, "#000000", 0.35);
    out += `<circle cx="${n1(s.x)}" cy="${n1(s.y)}" r="${n1(s.r)}" fill="url(#${gradientId(s.style)})" stroke="${outline}" stroke-width="2"/>\n`;
  }
  return `${out}</svg>\n`;
}
