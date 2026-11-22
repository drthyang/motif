// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LINE_STRIDE, SPHERE_STRIDE, buildPreviewData, previewFrame, previewScreen } from "../src/preview/data";
import { DEFAULT_CANVAS, fitView, layout, structureCentre } from "../src/render/svg";
import { DEFAULT_VIEW, dragView } from "../src/render/view";
import { zoomAbout, zoomedFit, NO_ZOOM } from "../src/render/zoom";
import { buildScene, DEFAULT_SPEC } from "../src/scene/scene";
import { readCif } from "../src/structure/readCif";

const structure = (file: string) => readCif(readFileSync(`examples/${file}`, "utf8"));

describe("the GPU preview is given the same structure and places it with the same formula as the SVG", () => {
  const scene = buildScene(structure("olivine-FeMg_COD-1541262.cif"), { ...DEFAULT_SPEC, bonds: [{ centre: "Si", neighbour: "O", max: 1.8, complete: true }] });
  const data = buildPreviewData(scene);

  it("one entry per plain sphere and one per wedge of a pie, at the atom's position and radius; one line per bond and cell edge", () => {
    const wedges = scene.spheres.reduce((n, s) => n + (scene.styles[s.style]!.wedges?.length ?? 1), 0);
    expect(data.spheres.length).toBe(wedges * SPHERE_STRIDE);
    expect(data.lines.length).toBe((scene.sticks.length + scene.cellEdges.length) * LINE_STRIDE);
    let entry = 0;
    for (const s of scene.spheres) {
      const style = scene.styles[s.style]!;
      for (let k = 0; k < (style.wedges?.length ?? 1); k++, entry++) {
        const at = Array.from(data.spheres.slice(entry * SPHERE_STRIDE, entry * SPHERE_STRIDE + 4));
        for (let i = 0; i < 3; i++) expect(at[i]).toBeCloseTo(s.centre[i]!, 4);
        expect(at[3]).toBeCloseTo(style.radius, 6);
      }
    }
    // A bond runs between the centres of its two atoms.
    const first = scene.sticks[0]!;
    const line = Array.from(data.lines.slice(0, 6));
    [...scene.spheres[first.i]!.centre, ...scene.spheres[first.j]!.centre].forEach((x, k) => expect(line[k]).toBeCloseTo(x, 4));
  });

  it("a pie sphere keeps its wedges: each in its colour, covering its share of the turn, in the SVG's order", () => {
    let entry = 0;
    const channel = (hex: string, k: number): number => parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16) / 255;
    for (const s of scene.spheres) {
      const style = scene.styles[s.style]!;
      if (!style.wedges) {
        const e = Array.from(data.spheres.slice(entry * SPHERE_STRIDE, (entry + 1) * SPHERE_STRIDE));
        expect(e.slice(7)).toEqual([0, 1, 0]); // the whole disc, not a pie
        entry++;
        continue;
      }
      let turn = 0;
      for (const w of style.wedges) {
        const e = Array.from(data.spheres.slice(entry * SPHERE_STRIDE, (entry + 1) * SPHERE_STRIDE));
        for (let k = 0; k < 3; k++) expect(e[4 + k]).toBeCloseTo(channel(w.colour, k), 6);
        expect(e[7]).toBeCloseTo(turn, 6);
        expect(e[8]).toBeCloseTo(turn + w.fraction, 6);
        expect(e[9]).toBe(1);
        turn += w.fraction;
        entry++;
      }
      expect(turn).toBeCloseTo(1, 6);
    }
  });

  it("every atom lands on the same pixel, at the same size and depth, as in the SVG: any view, zoomed or not", () => {
    let view = DEFAULT_VIEW;
    for (const zoom of [NO_ZOOM, zoomAbout(NO_ZOOM, 3.3, [400, 250], structureCentre(scene, DEFAULT_CANVAS))]) {
      for (let n = 0; n < 6; n++) {
        view = dragView(view, 0.9, -0.4);
        const fit = zoomedFit(fitView(scene, view, DEFAULT_CANVAS), zoom, structureCentre(scene, DEFAULT_CANVAS));
        const frame = previewFrame(scene, view, DEFAULT_CANVAS, fit);
        const drawn = layout(scene, view, DEFAULT_CANVAS, fit);
        scene.spheres.forEach((s) => {
          const [x, y, depth] = previewScreen(s.centre, data, frame);
          const same = drawn.find((d) => Math.abs(d.x - x) < 1e-6 && Math.abs(d.y - y) < 1e-6 && Math.abs(d.depth - depth) < 1e-9);
          expect(same, `${s.label} has no counterpart in the SVG`).toBeDefined();
          expect(same!.r).toBeCloseTo(scene.styles[s.style]!.radius * frame.scale, 9);
        });
      }
    }
  });

  it("the depth range holds everything drawn", () => {
    for (const s of scene.spheres) {
      const d = Math.hypot(s.centre[0] - data.centre[0], s.centre[1] - data.centre[1], s.centre[2] - data.centre[2]) + scene.styles[s.style]!.radius;
      expect(d).toBeLessThan(data.reach);
    }
  });
});
