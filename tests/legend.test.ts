// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AXIS_LENGTH, BAND, DEFAULT_CANVAS, FONT, LEGEND_FOLLOW_MAX, LEGEND_FOLLOW_MIN, axisArrows, fitView, fontList, layout, legendLayout, pxPerAngstrom, renderSvg, structureHeight, textWidth } from "../src/render/svg";
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
      stickStyles: [],
      ruleInfo: [],
      bands: [],
      polygons: [],
      sectors: [],
      angleKinds: [],
      styles: { X: { colour: "#808080", radius: 0.3 } },
      centre: [0, 0, 0],
      extent: 6,
      arrows: [],
      arrowColour: "#000000",
      letterWeight: 800,
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
      const shapes = [...svg.matchAll(/<polygon class="axis-(?:shaft|head)" points="([^"]+)"/g)];
      expect(shapes.length).toBe(6); // a shaft and a head for each of a, b, c
      for (const m of shapes) {
        for (const point of m[1]!.split(" ")) {
          const [x, y] = point.split(",").map(Number) as [number, number];
          expect(x >= 0 && x <= DEFAULT_CANVAS.width && y >= 0 && y <= DEFAULT_CANVAS.height).toBe(true);
        }
      }
    }
  });

  it("are drawn as solids: the head's tip is where the arrow ends, and its round base opens up as the arrow tilts out of the screen", () => {
    const scene = buildScene(structure("halite-NaCl_COD-9008678.cif".replace(".cif", "")));
    const head = (view: typeof DEFAULT_VIEW, name: string) => {
      const svg = renderSvg(scene, view);
      // Each arrow's shapes sit together; find the group that ends with this letter, or by order for a letterless one.
      const groups = svg.split("\n").filter((line) => line.includes('class="axis-shaft"'));
      const line = groups.find((g) => g.includes(`>${name}</text>`)) ?? groups.find((g) => !g.includes("</text>"))!;
      const tip = /class="axis-head" points="([\d.-]+),([\d.-]+) /.exec(line)!;
      const base = /class="axis-base" cx="([\d.-]+)" cy="([\d.-]+)" rx="([\d.-]+)" ry="([\d.-]+)"/.exec(line)!;
      const origin = /class="axis-origin" cx="([\d.-]+)" cy="([\d.-]+)"/.exec(svg)!;
      return { tip: [Number(tip[1]) - Number(origin[1]), Number(tip[2]) - Number(origin[2])], rx: Number(base[3]), ry: Number(base[4]), line };
    };
    const side = viewFromAngles(0, 0); // a to the right in the screen plane, b straight away from the viewer
    const a = head(side, "a");
    expect(a.tip[0]).toBeCloseTo(AXIS_LENGTH, 0);
    expect(a.tip[1]).toBeCloseTo(0, 0);
    expect(a.rx).toBeCloseTo(0, 6); // base seen edge on
    const b = head(side, "b"); // end on, pointing away: the base is a full circle, drawn over the cone
    expect(b.rx).toBeCloseTo(b.ry, 6);
    expect(b.line.indexOf("axis-base")).toBeGreaterThan(b.line.indexOf("axis-head"));
    // Turned so that b points at the viewer: the cone is drawn over its base.
    const front = head(viewFromAngles(180, 0), "b");
    expect(front.line.indexOf("axis-head")).toBeGreaterThan(front.line.indexOf("axis-base"));
    // Turned 30 degrees from end on: the base is an ellipse cos(30 degrees) as wide as it is high.
    const tilted = head(viewFromAngles(30, 0), "b");
    expect(tilted.rx / tilted.ry).toBeCloseTo(Math.cos((30 * Math.PI) / 180), 2);
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

  it("can follow the size of the structure: the largest legend sphere is as large as that atom is drawn, letters in proportion", () => {
    const scene = buildScene(olivine, { ...DEFAULT_SPEC, legendFollowsZoom: true });
    const usual = legendLayout(scene, DEFAULT_CANVAS, 5000);
    const largest = Math.max(...scene.legend.map((e) => scene.styles[e.style]!.radius));
    for (const pxPerAngstrom of [30, 60, 80]) {
      const items = legendLayout(scene, DEFAULT_CANVAS, 5000, pxPerAngstrom);
      expect(Math.max(...items.map((i) => i.r))).toBeCloseTo(largest * pxPerAngstrom, 9); // the atom's size in the figure
      expect(items[0]!.fontSize / usual[0]!.fontSize).toBeCloseTo((largest * pxPerAngstrom) / 44, 9);
    }
    // Within limits, so it stays readable and inside its band.
    expect(Math.max(...legendLayout(scene, DEFAULT_CANVAS, 5000, 1000).map((i) => i.r))).toBeCloseTo(44 * LEGEND_FOLLOW_MAX, 9);
    expect(Math.max(...legendLayout(scene, DEFAULT_CANVAS, 5000, 1).map((i) => i.r))).toBeCloseTo(44 * LEGEND_FOLLOW_MIN, 9);
    // In the figure: zooming in makes the legend larger; with the option off the zoom does not touch it.
    const size = (svg: string): number => Number(/class="legend"[^>]*font-size="([\d.]+)"/.exec(svg)![1]);
    const base = { ...fitView(scene, DEFAULT_VIEW, DEFAULT_CANVAS), scale: 40 }; // well inside the limits
    const zoomed = { ...base, scale: 60 };
    expect(size(renderSvg(scene, DEFAULT_VIEW, DEFAULT_CANVAS, zoomed)) / size(renderSvg(scene, DEFAULT_VIEW, DEFAULT_CANVAS, base))).toBeCloseTo(1.5, 1);
    const fixed = buildScene(olivine);
    expect(size(renderSvg(fixed, DEFAULT_VIEW, DEFAULT_CANVAS, zoomed))).toBe(size(renderSvg(fixed, DEFAULT_VIEW, DEFAULT_CANVAS, base)));
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

  it("the lettering font can be chosen; it is written first in the font list, and a name cannot break the figure", () => {
    expect(fontList(undefined)).toBe(FONT);
    expect(fontList("Avenir")).toBe(FONT);
    expect(fontList("Gill Sans")).toBe(`'Gill Sans', ${FONT}`);
    expect(fontList(`Evil" onload="x' <script>`)).toBe(`'Evil onloadx script', ${FONT}`);
    const svg = renderSvg(buildScene(quartz, { ...DEFAULT_SPEC, fontFamily: "Gill Sans" }), DEFAULT_VIEW);
    const families = [...svg.matchAll(/font-family="([^"]+)"/g)].map((m) => m[1]);
    expect(families.length).toBe(2 + 3); // two legend names and the letters a, b, c
    for (const f of families) expect(f).toBe(`'Gill Sans', ${FONT}`);
    // Nothing else about the figure changes with the font.
    const strip = (text: string): string => text.replace(/font-family="[^"]+"/g, "");
    expect(strip(svg)).toBe(strip(renderSvg(buildScene(quartz), DEFAULT_VIEW)));
  });

  it("the page's two layers hold together exactly what the saved figure holds", () => {
    const scene = buildScene(olivine, { ...DEFAULT_SPEC, bonds: [{ centre: "Si", neighbour: "O", max: 1.8, complete: true }], angles: [{ centre: "Si", ends: ["O", "O"], min: 0, max: 180 }] });
    const canvas = { ...DEFAULT_CANVAS, background: "#ffffff" };
    const body = (part: "all" | "structure" | "band"): string[] => {
      const svg = renderSvg(scene, DEFAULT_VIEW, canvas, undefined, part);
      return svg.slice(svg.indexOf("</defs>") + 8, svg.lastIndexOf("</svg>")).split("\n").filter(Boolean);
    };
    expect([...body("structure"), ...body("band")]).toEqual(body("all"));
    expect(body("band").some((line) => line.includes("<rect"))).toBe(false); // the background belongs to the structure layer
    expect(body("structure").some((line) => line.includes('class="legend"') || line.includes("axis-"))).toBe(false);
  });

  it("the size of the legend and of the axis arrows can be set, each on its own", () => {
    const usual = buildScene(olivine);
    const big = buildScene(olivine, { ...DEFAULT_SPEC, legendSize: 1.5, axesSize: 0.5 });
    const [a, b] = [legendLayout(usual, DEFAULT_CANVAS, 5000), legendLayout(big, DEFAULT_CANVAS, 5000)];
    a.forEach((item, i) => {
      expect(b[i]!.r / item.r).toBeCloseTo(1.5, 9);
      expect(b[i]!.fontSize / item.fontSize).toBeCloseTo(1.5, 9);
    });
    // Axis arrows half as long, half as thick, letters half the size; still inside the canvas.
    const [u, v] = [axisArrows(usual, DEFAULT_VIEW), axisArrows(big, DEFAULT_VIEW)];
    u.forEach((arrow, i) => {
      expect(v[i]!.dx).toBeCloseTo(arrow.dx / 2, 9);
      expect(v[i]!.dy).toBeCloseTo(arrow.dy / 2, 9);
    });
    const letter = (svg: string): number => Number(/font-style="italic" font-size="([\d.]+)"/.exec(svg)![1]);
    expect(letter(renderSvg(big, DEFAULT_VIEW)) / letter(renderSvg(usual, DEFAULT_VIEW))).toBeCloseTo(0.5, 9);
    const width = (svg: string): number => {
      const pts = /class="axis-shaft" points="([^"]+)"/.exec(svg)![1]!.split(" ").map((p) => p.split(",").map(Number));
      return Math.hypot(pts[0]![0]! - pts[3]![0]!, pts[0]![1]! - pts[3]![1]!);
    };
    expect(width(renderSvg(big, DEFAULT_VIEW)) / width(renderSvg(usual, DEFAULT_VIEW))).toBeCloseTo(0.5, 1);
    // The cones of the axis arrows alone: twice as wide, shafts unchanged.
    const headOf = (svg: string): number => Number(/class="axis-base"[^>]*ry="([\d.]+)"/.exec(svg)![1]);
    const cones = buildScene(olivine, { ...DEFAULT_SPEC, axesHeadSize: 2 });
    expect(headOf(renderSvg(cones, DEFAULT_VIEW)) / headOf(renderSvg(usual, DEFAULT_VIEW))).toBeCloseTo(2, 9);
    expect(width(renderSvg(cones, DEFAULT_VIEW))).toBeCloseTo(width(renderSvg(usual, DEFAULT_VIEW)), 0); // coordinates are written to 0.1 px
    // The structure itself is untouched.
    expect(big.spheres).toEqual(usual.spheres);
  });

  it("the axis arrows can be outlined; their letters are not", () => {
    const svg = renderSvg(buildScene(quartz, { ...DEFAULT_SPEC, axesOutline: true }), DEFAULT_VIEW);
    expect(svg).toMatch(/<g class="axes-outline" stroke="#[0-9a-f]{6}" stroke-width="1.5"/);
    for (const m of svg.matchAll(/<text [^>]*font-style="italic"[^>]*>/g)) expect(m[0]).toContain('stroke="none"');
    expect(renderSvg(buildScene(quartz), DEFAULT_VIEW)).not.toContain("axes-outline");
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
