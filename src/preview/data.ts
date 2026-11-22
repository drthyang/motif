// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The numbers the GPU preview draws from. The preview is a stand-in shown only while a large
 * structure is being turned, moved or zoomed; the figure itself is always the SVG.
 *
 * The preview places every atom with the same formula as the SVG (see previewScreen below, which
 * the shader repeats line for line), from the same view, the same placement and the same scene.
 * It draws less than the figure: spheres (pie spheres with their wedges), bonds, moment arrows as
 * bars, and the cell as plain lines. Bands, filled triangles, angle marks and
 * labels come back when the movement stops.
 */
import { ARROW_HEAD_LENGTH, ARROW_HEAD_WIDTH, ARROW_SHAFT, BOND_COLOUR, BOND_WIDTH, type Canvas, type Fit, structureHeight } from "../render/svg";
import type { View } from "../render/view";
import { mixHex } from "../scene/elementStyle";
import type { Scene } from "../scene/scene";
import { mulVec } from "../structure/cell";
import type { Vec3 } from "../structure/types";

/**
 * Numbers per sphere, or per wedge of a pie sphere: centre x, y, z (angstrom), radius (angstrom), red, green,
 * blue (0 to 1), then the part of the disc it covers as fractions of a turn, clockwise from the top (0 to 1
 * for a plain sphere), and 1 for a wedge of a pie (shaded like the SVG's pies) or 0 for a plain sphere.
 */
export const SPHERE_STRIDE = 10;
/** Numbers per line: both ends (angstrom), width (angstrom if positive, px of the canvas if negative), red, green, blue. */
export const LINE_STRIDE = 10;

export interface PreviewData {
  readonly spheres: Float32Array;
  readonly lines: Float32Array;
  readonly centre: Vec3;
  /** Half the depth range to keep, in angstrom: everything drawn lies within this distance of the centre. */
  readonly reach: number;
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

export function buildPreviewData(scene: Scene): PreviewData {
  const sphereData: number[] = [];
  for (const sphere of scene.spheres) {
    const style = scene.styles[sphere.style]!;
    const place = [sphere.centre[0], sphere.centre[1], sphere.centre[2], style.radius];
    if (!style.wedges) {
      sphereData.push(...place, ...rgb(style.colour), 0, 1, 0);
      continue;
    }
    // A pie sphere: one entry per wedge, each covering its share of the turn, in the SVG's order.
    let turn = 0;
    for (const w of style.wedges) {
      if (w.fraction <= 0) continue;
      sphereData.push(...place, ...rgb(w.colour), turn, turn + w.fraction, 1);
      turn += w.fraction;
    }
  }
  const spheres = new Float32Array(sphereData);
  const lines: number[] = [];
  for (const stick of scene.sticks) {
    const [a, b] = [scene.spheres[stick.i]!.centre, scene.spheres[stick.j]!.centre];
    const look = scene.stickStyles[stick.rule] ?? { colour: BOND_COLOUR, width: BOND_WIDTH };
    lines.push(...a, ...b, (stick.pale ? 0.65 : 1) * look.width, ...rgb(stick.pale ? mixHex(look.colour, "#ffffff", 0.55) : look.colour));
  }
  for (const arrow of scene.arrows) {
    // The shaft from tail to the base of the head, then the head as a short, wider bar.
    const c = scene.spheres[arrow.sphere]!.centre;
    const half = Math.hypot(arrow.vector[0], arrow.vector[1], arrow.vector[2]) / 2;
    if (half === 0) continue;
    const at = (t: number): Vec3 => [c[0] + (arrow.vector[0] / (2 * half)) * t, c[1] + (arrow.vector[1] / (2 * half)) * t, c[2] + (arrow.vector[2] / (2 * half)) * t];
    const head = Math.min(ARROW_HEAD_LENGTH, half);
    lines.push(...at(-half), ...at(half - head), ARROW_SHAFT, ...rgb(scene.arrowColour));
    lines.push(...at(half - head), ...at(half - head * 0.35), ARROW_HEAD_WIDTH * 0.75, ...rgb(scene.arrowColour));
  }
  for (const [from, to] of scene.cellEdges) lines.push(...from, ...to, -3, ...rgb("#aab3ba"));
  return { spheres, lines: new Float32Array(lines), centre: scene.centre, reach: scene.extent * 1.05 + 1 };
}

/** What changes from one frame to the next: the view, the placement, and the size of the canvas. */
export interface PreviewFrame {
  /** The view, row by row (9 numbers). */
  readonly view: number[];
  readonly scale: number;
  readonly x: number;
  readonly y: number;
  /** Size of the figure's canvas in its own px (the SVG's width and height), and the height of the structure's space. */
  readonly width: number;
  readonly height: number;
  readonly spaceHeight: number;
}

export function previewFrame(scene: Scene, view: View, canvas: Canvas, fit: Fit): PreviewFrame {
  return { view: view.flat(), scale: fit.scale, x: fit.x, y: fit.y, width: canvas.width, height: canvas.height, spaceHeight: structureHeight(scene, canvas) };
}

/**
 * Where the preview draws a point given in angstrom: canvas px (x right, y down) and depth in angstrom
 * (larger = nearer). The vertex shader in worker.ts computes exactly this; the test compares it with
 * the SVG's own placement, so the two cannot drift apart unnoticed.
 */
export function previewScreen(point: Vec3, data: PreviewData, frame: PreviewFrame): Vec3 {
  const v = frame.view;
  const p = mulVec([[v[0]!, v[1]!, v[2]!], [v[3]!, v[4]!, v[5]!], [v[6]!, v[7]!, v[8]!]], [point[0] - data.centre[0], point[1] - data.centre[1], point[2] - data.centre[2]]);
  return [frame.x + p[0] * frame.scale, frame.y - p[1] * frame.scale, p[2]];
}
