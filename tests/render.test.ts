import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CANVAS, layout, renderSvg } from "../src/render/svg";
import { DEFAULT_VIEW, determinant, dragView, viewFromAngles, type View } from "../src/render/view";
import { buildScene, type Scene } from "../src/scene/scene";
import { mulVec, orthogonalizationMatrix } from "../src/structure/cell";
import { readCif } from "../src/structure/readCif";
import type { Vec3 } from "../src/structure/types";

const scene = (name: string): Scene => buildScene(readCif(readFileSync(`examples/${name}.cif`, "utf8")));
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
      styles: { X: { colour: "#808080", radius: 0.3 } },
      centre: [0, 0, 0],
      extent: 4,
      warnings: [],
    };
    const drawn = layout(s, viewFromAngles(0, 0), DEFAULT_CANVAS);
    const o = drawn.find((d) => d.label === "o")!;
    const p = drawn.find((d) => d.label === "p")!;
    expect(p.x).toBeGreaterThan(o.x);
    expect(p.y).toBeLessThan(o.y); // SVG y grows downwards
    expect((o.y - p.y) / (p.x - o.x)).toBeCloseTo(2, 9); // same scale in both directions
  });

  it("keeps every atom inside the canvas at any orientation, at one fixed scale", () => {
    const s = scene("quartz_COD-9009666");
    const random = rng(3);
    let view = DEFAULT_VIEW;
    const radius = layout(s, view, DEFAULT_CANVAS).find((d) => d.style === "Si")!.r;
    for (let n = 0; n < 100; n++) {
      view = dragView(view, 3 * (random() - 0.5), 3 * (random() - 0.5));
      for (const d of layout(s, view, DEFAULT_CANVAS)) {
        expect(d.x - d.r >= 0 && d.x + d.r <= DEFAULT_CANVAS.width && d.y - d.r >= 0 && d.y + d.r <= DEFAULT_CANVAS.height).toBe(true);
        if (d.style === "Si") expect(d.r).toBeCloseTo(radius, 9);
      }
    }
  });

  it("has a background only when asked for one", () => {
    const s = scene("silicon_COD-9008565");
    expect(renderSvg(s, DEFAULT_VIEW)).not.toContain("<rect");
    expect(renderSvg(s, DEFAULT_VIEW, { ...DEFAULT_CANVAS, background: "#ffffff" })).toContain('<rect width="1440" height="1100" fill="#ffffff"/>');
  });
});
