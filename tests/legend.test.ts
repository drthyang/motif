import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AXIS_LENGTH, BAND, DEFAULT_CANVAS, axisArrows, layout, legendLayout, pxPerAngstrom, renderSvg, structureHeight, textWidth } from "../src/render/svg";
import { DEFAULT_VIEW, dragView, viewFromAngles } from "../src/render/view";
import { buildScene, cellAxes, DEFAULT_SPEC, type Scene } from "../src/scene/scene";
import { fractionalToCartesian } from "../src/structure/cell";
import { readCif } from "../src/structure/readCif";

const structure = (name: string) => readCif(readFileSync(`examples/${name}.cif`, "utf8"));
const quartz = structure("quartz_COD-9009666");
const olivine = structure("olivine-FeMg_COD-1541262");
const arrow = (scene: ReturnType<typeof buildScene>, view: typeof DEFAULT_VIEW, name: string) => axisArrows(scene, view).find((a) => a.name === name)!;

describe("axes", () => {
  it("are unit vectors along the cell edges: in quartz a and b are 120 degrees apart, c is perpendicular to both", () => {
    const [a, b, c] = cellAxes(quartz).map((x) => x.direction);
    const dot = (p: readonly number[], q: readonly number[]): number => p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!;
    for (const v of [a!, b!, c!]) expect(dot(v, v)).toBeCloseTo(1, 12);
    expect(dot(a!, b!)).toBeCloseTo(Math.cos((120 * Math.PI) / 180), 12);
    expect(dot(a!, c!)).toBeCloseTo(0, 12);
    expect(dot(b!, c!)).toBeCloseTo(0, 12);
  });

  it("default view of a cubic cell: a points right, c points up, b is short (it runs into the page)", () => {
    const scene = buildScene(structure("halite-NaCl_COD-9008678"));
    const [a, b, c] = ["a", "b", "c"].map((n) => arrow(scene, DEFAULT_VIEW, n));
    expect(a!.dx).toBeGreaterThan(0.9 * AXIS_LENGTH);
    expect(c!.dy).toBeLessThan(-0.9 * AXIS_LENGTH); // SVG y runs down, so up is negative
    expect(Math.hypot(b!.dx, b!.dy)).toBeLessThan(0.4 * AXIS_LENGTH);
    expect(b!.depth).toBeLessThan(0); // away from the viewer
  });

  it("looking down c at quartz: a to the right, b at 120 degrees anticlockwise from it (a right-handed cell seen from +c)", () => {
    const scene = buildScene(quartz);
    const down = viewFromAngles(0, 90); // from above: c towards the viewer
    const [a, b, c] = ["a", "b", "c"].map((n) => arrow(scene, down, n));
    expect(c!.depth).toBeCloseTo(1, 12);
    expect(Math.hypot(c!.dx, c!.dy)).toBeLessThan(1e-9);
    // Angles measured anticlockwise with y up (so -dy).
    const angle = (v: { dx: number; dy: number }): number => (Math.atan2(-v.dy, v.dx) * 180) / Math.PI;
    expect(angle(a!)).toBeCloseTo(0, 9);
    expect(angle(b!)).toBeCloseTo(120, 9);
    // An axis seen end on gets no letter; the other two do.
    const svg = renderSvg(scene, down);
    expect(svg).toMatch(/font-style="italic"[^>]*>a<\/text>/);
    expect(svg).toMatch(/font-style="italic"[^>]*>b<\/text>/);
    expect(svg).not.toMatch(/font-style="italic"[^>]*>c<\/text>/);
  });

  it("the arrows turn with the structure: an arrow is parallel on screen to the cell edge it names", () => {
    // Two spheres one cell edge apart along b of quartz (an oblique cell), with the quartz axes.
    const edge = fractionalToCartesian(quartz.cell, [0, 1, 0]);
    const scene: Scene = {
      spheres: [{ style: "X", label: "p", centre: [0, 0, 0] }, { style: "X", label: "q", centre: edge }],
      sticks: [],
      cellEdges: [],
      styles: { X: { colour: "#808080", radius: 0.3 } },
      centre: [0, 0, 0],
      extent: 6,
      legend: [],
      axes: cellAxes(quartz),
      warnings: [],
    };
    let view = DEFAULT_VIEW;
    for (const [right, down] of [[0.7, 0.2], [-1.3, 0.9], [2.2, -0.6]] as const) {
      view = dragView(view, right, down);
      const drawn = layout(scene, view, DEFAULT_CANVAS);
      const [p, q] = [drawn.find((d) => d.label === "p")!, drawn.find((d) => d.label === "q")!];
      const b = arrow(scene, view, "b");
      const [ex, ey] = [q.x - p.x, q.y - p.y];
      expect(Math.abs(ex * b.dy - ey * b.dx)).toBeLessThan(1e-9 * Math.hypot(ex, ey) * AXIS_LENGTH + 1e-9); // parallel
      expect(ex * b.dx + ey * b.dy).toBeGreaterThan(0); // same sense
      // Same foreshortening: drawn edge / true edge = drawn arrow / full arrow, up to the drawing scale.
      expect(Math.hypot(b.dx, b.dy) / AXIS_LENGTH).toBeCloseTo(Math.hypot(ex, ey) / (quartz.cell.b * pxPerAngstrom(scene, view, DEFAULT_CANVAS)), 9);
    }
  });

  it("stay inside the canvas at any orientation", () => {
    const scene = buildScene(quartz);
    let view = DEFAULT_VIEW;
    for (let n = 0; n < 60; n++) {
      view = dragView(view, 0.37, 0.23);
      const svg = renderSvg(scene, view);
      for (const m of svg.matchAll(/<line class="axis" x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/g)) {
        for (const i of [1, 3]) expect(Number(m[i]) >= 0 && Number(m[i]) <= DEFAULT_CANVAS.width).toBe(true);
        for (const i of [2, 4]) expect(Number(m[i]) >= 0 && Number(m[i]) <= DEFAULT_CANVAS.height).toBe(true);
      }
    }
  });
});

describe("legend", () => {
  it("lists each name once, in file order, with the user's names", () => {
    expect(buildScene(olivine).legend.map((e) => e.name)).toEqual(["Si", "O", "Fe/Mg"]);
    const named = buildScene(olivine, { ...DEFAULT_SPEC, looks: { "Fe/Mg": { name: "M" } } });
    expect(named.legend.map((e) => e.name)).toEqual(["Si", "O", "M"]);
    expect(named.styles[named.legend[2]!.style]!.wedges).toBeDefined(); // the legend shows the pie
  });

  it("lists only what is drawn", () => {
    const slab = buildScene(structure("perovskite-SrTiO3_COD-9006864"), { ...DEFAULT_SPEC, range: { from: [0.3, 0.3, 0.3], to: [0.7, 0.7, 0.7], boundary: "both" } });
    expect(slab.legend.map((e) => e.name)).toEqual(["Sr"]); // only the body-centre atom is in this range
  });

  it("sphere sizes keep the ratio of the atoms' radii", () => {
    const scene = buildScene(olivine);
    const items = legendLayout(scene, DEFAULT_CANVAS, 1000);
    const [si, o] = [items.find((i) => i.name === "Si")!, items.find((i) => i.name === "O")!];
    expect(si.r / o.r).toBeCloseTo(scene.styles["Si"]!.radius / scene.styles["O"]!.radius, 9);
    expect(Math.max(...items.map((i) => i.r))).toBeCloseTo(44, 9);
  });

  it("shrinks to fit the space it is given, and escapes names", () => {
    const scene = buildScene(olivine, { ...DEFAULT_SPEC, looks: { "Fe/Mg": { name: "a <very> long & odd name" } } });
    const narrow = legendLayout(scene, DEFAULT_CANVAS, 500);
    expect(narrow[0]!.fontSize).toBeLessThan(92);
    const last = narrow[narrow.length - 1]!;
    expect(last.textX + textWidth(last.name, last.fontSize)).toBeLessThanOrEqual(500 + 1e-6);
    const svg = renderSvg(scene, DEFAULT_VIEW);
    expect(svg).toContain("a &lt;very&gt; long &amp; odd name");
    expect(svg).not.toContain("<very>");
  });

  it("the band under the structure is there only when the legend or the axes are", () => {
    const both = buildScene(quartz);
    const none = buildScene(quartz, { ...DEFAULT_SPEC, showLegend: false, showAxes: false });
    expect(structureHeight(both, DEFAULT_CANVAS)).toBe(DEFAULT_CANVAS.height - BAND);
    expect(structureHeight(none, DEFAULT_CANVAS)).toBe(DEFAULT_CANVAS.height);
    expect(renderSvg(none, DEFAULT_VIEW)).not.toContain("<text");
    // Atoms stay above the band.
    for (const d of layout(both, DEFAULT_VIEW, DEFAULT_CANVAS)) expect(d.y + d.r).toBeLessThanOrEqual(DEFAULT_CANVAS.height - BAND);
  });
});
