// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CANVAS, fitView, layout, legendLayout, renderSvg, structureCentre, structureHeight } from "../src/render/svg";
import { DEFAULT_VIEW } from "../src/render/view";
import { MAX_ZOOM, MIN_ZOOM, NO_ZOOM, isZoomed, panBy, zoomAbout, zoomToBox, zoomedFit } from "../src/render/zoom";
import { buildScene } from "../src/scene/scene";
import { readCif } from "../src/structure/readCif";

const scene = buildScene(readCif(readFileSync("examples/quartz_COD-9009666.cif", "utf8")));
const base = fitView(scene, DEFAULT_VIEW, DEFAULT_CANVAS);
const centre = structureCentre(scene, DEFAULT_CANVAS);
const atoms = (zoom = NO_ZOOM) => layout(scene, DEFAULT_VIEW, DEFAULT_CANVAS, zoomedFit(base, zoom, centre));

describe("zoom and pan", () => {
  it("no zoom is the fitted figure, untouched", () => {
    expect(zoomedFit(base, NO_ZOOM, centre)).toBe(base);
    expect(isZoomed(NO_ZOOM)).toBe(false);
    expect(renderSvg(scene, DEFAULT_VIEW, DEFAULT_CANVAS, zoomedFit(base, NO_ZOOM, centre))).toBe(renderSvg(scene, DEFAULT_VIEW));
  });

  it("zooming about a point keeps that point of the structure where it is, and scales everything else from it", () => {
    const before = atoms();
    const target = before[3]!;
    const zoom = zoomAbout(NO_ZOOM, 2.5, [target.x, target.y], centre);
    const after = atoms(zoom);
    const same = after.find((a) => a.label === target.label && Math.abs(a.depth - target.depth) < 1e-9)!;
    expect(same.x).toBeCloseTo(target.x, 9);
    expect(same.y).toBeCloseTo(target.y, 9);
    expect(same.r).toBeCloseTo(target.r * 2.5, 9);
    // Every other atom is 2.5 times as far from that point as before (same order back to front).
    before.forEach((b, i) => {
      expect(after[i]!.x - target.x).toBeCloseTo((b.x - target.x) * 2.5, 6);
      expect(after[i]!.y - target.y).toBeCloseTo((b.y - target.y) * 2.5, 6);
    });
    // Zooming back about the same point returns to the fitted figure.
    const back = zoomAbout(zoom, 1 / 2.5, [target.x, target.y], centre);
    expect(back.factor).toBeCloseTo(1, 12);
    expect(back.x).toBeCloseTo(0, 9);
    expect(back.y).toBeCloseTo(0, 9);
  });

  it("panning moves every atom by the same amount and changes no size", () => {
    const [before, after] = [atoms(), atoms(panBy(NO_ZOOM, 37, -12))];
    before.forEach((b, i) => {
      expect(after[i]!.x - b.x).toBeCloseTo(37, 9);
      expect(after[i]!.y - b.y).toBeCloseTo(-12, 9);
      expect(after[i]!.r).toBe(b.r);
    });
  });

  it("box zoom brings the middle of the box to the middle of the space and makes the box fill it", () => {
    const [w, h] = [DEFAULT_CANVAS.width, structureHeight(scene, DEFAULT_CANVAS)];
    const before = atoms();
    const a = before[2]!;
    // A box 200 x 100 px centred on an atom: the limiting side is the width (1440 / 200 = 7.2 < 900 / 100).
    const zoom = zoomToBox(NO_ZOOM, [a.x - 100, a.y - 50], [a.x + 100, a.y + 50], centre, w, h);
    expect(zoom.factor).toBeCloseTo(Math.min(w / 200, h / 100), 9);
    const moved = atoms(zoom).find((x) => x.label === a.label && Math.abs(x.depth - a.depth) < 1e-9)!;
    expect(moved.x).toBeCloseTo(centre[0], 6);
    expect(moved.y).toBeCloseTo(centre[1], 6);
    // A box too small to be meant changes nothing.
    expect(zoomToBox(NO_ZOOM, [10, 10], [12, 11], centre, w, h)).toBe(NO_ZOOM);
  });

  it("stays within its limits", () => {
    expect(zoomAbout(NO_ZOOM, 1e6, centre, centre).factor).toBe(MAX_ZOOM);
    expect(zoomAbout(NO_ZOOM, 1e-6, centre, centre).factor).toBe(MIN_ZOOM);
  });

  it("a zoomed structure uses the whole canvas (nothing is cut off inside it), and the legend and axes do not move", () => {
    const zoom = zoomAbout(NO_ZOOM, 3, centre, centre);
    const svg = renderSvg(scene, DEFAULT_VIEW, DEFAULT_CANVAS, zoomedFit(base, zoom, centre));
    expect(svg).not.toContain("clipPath");
    const plain = renderSvg(scene, DEFAULT_VIEW);
    // Everything from the first legend letter on (legend, axes) is identical with and without the zoom,
    // and comes after the structure, so it is drawn over it.
    const band = (text: string): string => text.slice(text.indexOf('<text class="legend"'));
    expect(band(svg)).toBe(band(plain));
    expect(svg.indexOf('class="legend"')).toBeGreaterThan(svg.lastIndexOf('class="bond"'));
    expect(legendLayout(scene, DEFAULT_CANVAS, 1000).length).toBe(2);
  });
});
