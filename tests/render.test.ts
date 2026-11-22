import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CANVAS, MAX_SCALE, fitView, layout, pxPerAngstrom, renderSvg } from "../src/render/svg";
import { DEFAULT_VIEW, determinant, dragView, viewFromAngles, type View } from "../src/render/view";
import { buildScene, DEFAULT_SPEC, type Scene } from "../src/scene/scene";
import { mulVec, orthogonalizationMatrix } from "../src/structure/cell";
import { readCif } from "../src/structure/readCif";
import type { Vec3 } from "../src/structure/types";

// The structure alone: no legend, no axes (those are tested in tests/legend.test.ts).
const scene = (name: string): Scene =>
  buildScene(readCif(readFileSync(`examples/${name}.cif`, "utf8")), { ...DEFAULT_SPEC, showLegend: false, showAxes: false });
const IDENTITY: View = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A small repeatable random number generator. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe("view", () => {
  it("default view: a to the right, c* up, b away from the viewer", () => {
    const [a, b, c] = [mulVec(DEFAULT_VIEW, [1, 0, 0]), mulVec(DEFAULT_VIEW, [0, 1, 0]), mulVec(DEFAULT_VIEW, [0, 0, 1])];
    expect(a[0]).toBeGreaterThan(0.9); // screen x
    expect(c[1]).toBeGreaterThan(0.9); // screen y (up)
    expect(b[2]).toBeLessThan(-0.9); // depth: negative = into the page
  });

  it("is a proper rotation, and stays one over 2000 drags", () => {
    const random = rng(7);
    let view = DEFAULT_VIEW;
    expect(determinant(view)).toBeCloseTo(1, 12);
    for (let i = 0; i < 2000; i++) view = dragView(view, random() - 0.5, random() - 0.5);
    expect(determinant(view)).toBeCloseTo(1, 12);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(dot(view[i]!, view[j]!)).toBeCloseTo(i === j ? 1 : 0, 12);
  });

  it("never mirrors: a, b, c stay right-handed on screen for an oblique cell", () => {
    const m = orthogonalizationMatrix(readCif(readFileSync("examples/quartz_COD-9009666.cif", "utf8")).cell);
    const axis = (i: number): Vec3 => [m[0][i]!, m[1][i]!, m[2][i]!];
    expect(dot(cross(axis(0), axis(1)), axis(2))).toBeGreaterThan(0); // right-handed in cartesian space
    const random = rng(11);
    let view = DEFAULT_VIEW;
    for (let n = 0; n < 200; n++) {
      view = dragView(view, 3 * (random() - 0.5), 3 * (random() - 0.5));
      // Screen frame: x right, y up, z towards the viewer (itself right-handed).
      const [a, b, c] = [mulVec(view, axis(0)), mulVec(view, axis(1)), mulVec(view, axis(2))];
      expect(dot(cross(a, b), c)).toBeGreaterThan(0);
    }
  });

  it("dragging right brings the front to the right; dragging down brings it down", () => {
    const front: Vec3 = [0, 0, 1];
    expect(mulVec(dragView(IDENTITY, 0.3, 0), front)[0]).toBeGreaterThan(0);
    expect(mulVec(dragView(IDENTITY, 0, 0.3), front)[1]).toBeLessThan(0); // screen y is up, so down is negative
  });

  it("azimuth and elevation: positive elevation looks from above", () => {
    // From above, a point higher along z appears higher on screen and a point nearer the viewer appears lower.
    const view = viewFromAngles(0, 30);
    expect(mulVec(view, [0, 0, 1])[1]).toBeGreaterThan(0);
    expect(mulVec(view, [0, -1, 0])[2]).toBeGreaterThan(0); // -y is towards the viewer
    expect(mulVec(view, [0, -1, 0])[1]).toBeLessThan(0);
  });
});

describe("drawing", () => {
  it("draws one circle per atom, back to front", () => {
    const s = scene("perovskite-SrTiO3_COD-9006864");
    const drawn = layout(s, DEFAULT_VIEW, DEFAULT_CANVAS);
    expect(drawn.length).toBe(21);
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]!.depth).toBeGreaterThanOrEqual(drawn[i - 1]!.depth);
    expect(renderSvg(s, DEFAULT_VIEW).match(/<circle /g)?.length).toBe(21);
  });

  it("puts up on screen at the top of the SVG, and right at the right", () => {
    // Two spheres: one at the origin, one displaced along +x and +z (cartesian).
    const s: Scene = {
      spheres: [{ style: "X", label: "o", centre: [0, 0, 0] }, { style: "X", label: "p", centre: [1, 0, 2] }],
      sticks: [],
      cellEdges: [],
      styles: { X: { colour: "#808080", radius: 0.3 } },
      centre: [0, 0, 0],
      extent: 4,
      legend: [],
      axes: [],
      warnings: [],
    };
    const drawn = layout(s, viewFromAngles(0, 0), DEFAULT_CANVAS);
    const o = drawn.find((d) => d.label === "o")!;
    const p = drawn.find((d) => d.label === "p")!;
    expect(p.x).toBeGreaterThan(o.x);
    expect(p.y).toBeLessThan(o.y); // SVG y grows downwards
    expect((o.y - p.y) / (p.x - o.x)).toBeCloseTo(2, 9); // same scale in both directions
  });

  it("fits the structure to the canvas at any orientation: inside the margins, touching them on one pair of sides", () => {
    // Atoms only: with the cell outline shown, the outline would set the size.
    const s = buildScene(readCif(readFileSync("examples/quartz_COD-9009666.cif", "utf8")), { ...DEFAULT_SPEC, showCell: false, showLegend: false, showAxes: false });
    const random = rng(3);
    let view = DEFAULT_VIEW;
    const { width, height, margin } = DEFAULT_CANVAS;
    for (let n = 0; n < 100; n++) {
      view = dragView(view, 3 * (random() - 0.5), 3 * (random() - 0.5));
      const drawn = layout(s, view, DEFAULT_CANVAS);
      const [x0, x1] = [Math.min(...drawn.map((d) => d.x - d.r)), Math.max(...drawn.map((d) => d.x + d.r))];
      const [y0, y1] = [Math.min(...drawn.map((d) => d.y - d.r)), Math.max(...drawn.map((d) => d.y + d.r))];
      expect(x0).toBeGreaterThanOrEqual(margin - 1e-6);
      expect(x1).toBeLessThanOrEqual(width - margin + 1e-6);
      expect(y0).toBeGreaterThanOrEqual(margin - 1e-6);
      expect(y1).toBeLessThanOrEqual(height - margin + 1e-6);
      const touches = Math.abs(x0 - margin) < 1e-6 || Math.abs(y0 - margin) < 1e-6;
      // ... unless the structure is so small in this view that the largest allowed scale is reached first.
      expect(touches || pxPerAngstrom(s, view, DEFAULT_CANVAS) === MAX_SCALE).toBe(true);
      expect((x0 + x1) / 2).toBeCloseTo(width / 2, 6); // centred
      expect((y0 + y1) / 2).toBeCloseTo(height / 2, 6);
    }
  });

  it("with a placement held fixed (as during a drag), turning changes neither the scale nor the centre", () => {
    const s = scene("quartz_COD-9009666");
    const fit = fitView(s, DEFAULT_VIEW, DEFAULT_CANVAS);
    const before = layout(s, DEFAULT_VIEW, DEFAULT_CANVAS, fit).find((d) => d.style === "Si")!.r;
    const turned = dragView(DEFAULT_VIEW, 1.1, -0.7);
    expect(layout(s, turned, DEFAULT_CANVAS, fit).find((d) => d.style === "Si")!.r).toBeCloseTo(before, 12);
    expect(pxPerAngstrom(s, turned, DEFAULT_CANVAS, fit)).toBe(fit.scale);
  });

  it("has a background only when asked for one", () => {
    const s = scene("silicon_COD-9008565");
    expect(renderSvg(s, DEFAULT_VIEW)).not.toContain("<rect");
    expect(renderSvg(s, DEFAULT_VIEW, { ...DEFAULT_CANVAS, background: "#ffffff" })).toContain('<rect width="1440" height="1100" fill="#ffffff"/>');
  });
});
