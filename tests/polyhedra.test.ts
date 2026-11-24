// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CANVAS, layoutAll, renderSvg } from "../src/render/svg";
import type { View } from "../src/render/view";
import type { BondRule, PolyhedronLook } from "../src/scene/bonds";
import { defaultColour } from "../src/scene/elementStyle";
import { convexHull, hullEdges } from "../src/scene/polyhedra";
import { buildScene, DEFAULT_SPEC, type Scene } from "../src/scene/scene";
import type { Range } from "../src/scene/select";
import { readCif } from "../src/structure/readCif";
import type { Vec3 } from "../src/structure/types";

const structure = (file: string) => readCif(readFileSync(`examples/${file}`, "utf8"));
const rule = (centre: string, neighbour: string, max: number, extra: Partial<BondRule> = {}): BondRule => ({ centre, neighbour, max, complete: false, polyhedra: true, ...extra });
const range = (from: Vec3, to: Vec3): Range => ({ from, to, boundary: "both" });
const dist = (p: Vec3, q: Vec3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** Corner distances of every polyhedron, to 0.001 A, as a sorted list of the distinct values. */
function cornerDistances(scene: Scene): number[] {
  const found = new Set<number>();
  for (const p of scene.polyhedra ?? []) for (const c of p.corners) found.add(Math.round(dist(scene.spheres[p.centre]!.centre, scene.spheres[c]!.centre) * 1000) / 1000);
  return [...found].sort((a, b) => a - b);
}

describe("convex hull", () => {
  const octahedron: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  it("gives an octahedron 8 triangles, 12 edges and 6 corners (Euler: V - E + F = 2)", () => {
    const hull = convexHull(octahedron)!;
    expect(hull.flat).toBe(false);
    expect(hull.faces).toHaveLength(8);
    expect(hull.faces.every((f) => f.length === 3)).toBe(true);
    const edges = hullEdges(hull.faces);
    expect(edges).toHaveLength(12);
    expect(edges.every((e) => e.faces.length === 2)).toBe(true);
    expect(6 - edges.length + hull.faces.length).toBe(2);
  });

  it("points every normal outward and orders every face anticlockwise seen from outside", () => {
    const hull = convexHull(octahedron)!;
    hull.faces.forEach((face, f) => {
      const n = hull.normals[f]!;
      const [a, b, c] = face.map((i) => octahedron[i]!) as [Vec3, Vec3, Vec3];
      const mid = [0, 1, 2].map((i) => (a[i]! + b[i]! + c[i]!) / 3);
      expect(n[0] * mid[0]! + n[1] * mid[1]! + n[2] * mid[2]!).toBeGreaterThan(0); // the centre (origin) is behind the face
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const turn = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      expect(turn[0]! * n[0] + turn[1]! * n[1] + turn[2]! * n[2]).toBeGreaterThan(0);
    });
  });

  it("merges the two triangles of a square face: a cube has 6 square faces", () => {
    const cube: Vec3[] = [];
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) cube.push([x, y, z]);
    const hull = convexHull(cube)!;
    expect(hull.faces).toHaveLength(6);
    expect(hull.faces.every((f) => f.length === 4)).toBe(true);
    expect(hullEdges(hull.faces)).toHaveLength(12);
  });

  it("gives a tetrahedron 4 faces", () => {
    const hull = convexHull([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]])!;
    expect(hull.faces).toHaveLength(4);
    expect(hullEdges(hull.faces)).toHaveLength(6);
  });

  it("gives corners in one plane one flat face, and nothing for fewer than three or a line", () => {
    const square = convexHull([[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]])!;
    expect(square.flat).toBe(true);
    expect(square.faces).toEqual([expect.arrayContaining([0, 1, 2, 3])]);
    expect(convexHull([[0, 0, 0], [1, 0, 0]])).toBeNull();
    expect(convexHull([[0, 0, 0], [1, 0, 0], [2, 0, 0]])).toBeNull();
  });
});

// Counts and distances checked against gemmi (symmetry expansion) and scipy (hulls) on the same files and ranges:
// the mock script of 2026-11-24, with the range rule of MOTIF (an atom within 0.001 of a limit is drawn at both ends).
describe("polyhedra of the examples", () => {
  it("cubic SrTiO3, 2 x 2 x 1 cells: 18 TiO6 octahedra with every Ti-O = a/2 = 1.953 A, the Ti-O bonds left out", () => {
    const s = structure("perovskite-SrTiO3_COD-9006864.cif");
    expect(s.cell.a / 2).toBeCloseTo(1.95264, 5);
    const scene = buildScene(s, { ...DEFAULT_SPEC, range: range([0, 0, 0], [2, 2, 1]), bonds: [rule("Ti", "O", 2.3)] });
    const polyhedra = scene.polyhedra ?? [];
    expect(polyhedra).toHaveLength(18);
    for (const p of polyhedra) {
      expect(p.corners).toHaveLength(6);
      expect(p.faces).toHaveLength(8);
      expect(p.flat).toBe(false);
      expect(p.look).toBe("glass");
      expect(p.colour).toBe(defaultColour("Ti"));
    }
    expect(cornerDistances(scene)).toEqual([1.953]);
    expect(scene.sticks.filter((k) => k.rule === 0)).toHaveLength(0);
    expect(scene.ruleInfo[0]!.polyhedra).toEqual([{ corners: 6, count: 18 }]);
    // Asked for, the bonds inside are drawn: 6 per octahedron.
    const withBonds = buildScene(s, { ...DEFAULT_SPEC, range: range([0, 0, 0], [2, 2, 1]), bonds: [rule("Ti", "O", 2.3, { polyhedronBonds: true })] });
    expect(withBonds.sticks.filter((k) => k.rule === 0)).toHaveLength(18 * 6);
  });

  it("adds the corners outside the range: a polyhedron at the edge is whole although `complete` is off", () => {
    const s = structure("perovskite-SrTiO3_COD-9006864.cif");
    const scene = buildScene(s, { ...DEFAULT_SPEC, range: range([0, 0, 0], [1, 1, 1]), bonds: [rule("Ti", "O", 2.3)] });
    expect(scene.polyhedra!.every((p) => p.corners.length === 6)).toBe(true);
    expect(scene.spheres.some((sp) => sp.added)).toBe(true);
  });

  it("quartz, 2 x 2 x 1 cells: 20 SiO4 tetrahedra, Si-O 1.607 and 1.611 A", () => {
    const scene = buildScene(structure("quartz_COD-9009666.cif"), { ...DEFAULT_SPEC, range: range([0, 0, 0], [2, 2, 1]), bonds: [rule("Si", "O", 1.8)] });
    expect(scene.polyhedra).toHaveLength(20);
    expect(scene.polyhedra!.every((p) => p.corners.length === 4 && p.faces.length === 4)).toBe(true);
    expect(cornerDistances(scene)).toEqual([1.607, 1.611]);
  });

  it("olivine, one cell: 4 SiO4 tetrahedra and 19 (Fe,Mg)O6 octahedra, coloured by occupancy", () => {
    const s = structure("olivine-FeMg_COD-1541262.cif");
    const scene = buildScene(s, { ...DEFAULT_SPEC, range: range([0, 0, 0], [1, 1, 1]), bonds: [rule("Si", "O", 1.8), rule("Fe/Mg", "O", 2.45)] });
    expect(scene.ruleInfo[0]!.polyhedra).toEqual([{ corners: 4, count: 4 }]);
    expect(scene.ruleInfo[1]!.polyhedra).toEqual([{ corners: 6, count: 19 }]);
    const d = cornerDistances(scene);
    expect(d[0]).toBeCloseTo(1.62, 2);
    expect(d[d.length - 1]).toBeCloseTo(2.283, 3);
    // M1 at the origin is Fe 0.878 + Mg 0.122: its colour is the two element colours mixed in that proportion.
    const ch = (hex: string, i: number): number => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
    const mixed = `#${[0, 1, 2].map((i) => Math.round(0.878 * ch(defaultColour("Fe"), i) + 0.122 * ch(defaultColour("Mg"), i)).toString(16).padStart(2, "0")).join("")}`;
    const atOrigin = scene.polyhedra!.find((p) => p.rule === 1 && dist(scene.spheres[p.centre]!.centre, [0, 0, 0]) < 1e-6)!;
    expect(atOrigin.colour).toBe(mixed);
  });

  it("LaMnO3, one layer of 2 x 2 cells: 12 MnO6 octahedra, stretched by Jahn-Teller (Mn-O 1.906, 1.968, 2.180 A)", () => {
    const scene = buildScene(structure("LaMnO3-orbital-order_COD-1006141.cif"), { ...DEFAULT_SPEC, range: range([0, 0, -0.06], [2, 2, 0.06]), bonds: [rule("Mn", "O", 2.4)] });
    expect(scene.polyhedra).toHaveLength(12);
    expect(cornerDistances(scene)).toEqual([1.906, 1.968, 2.18]);
  });
});

describe("drawing a polyhedron", () => {
  // One TiO6 octahedron (the Ti at the origin of cubic SrTiO3, its six O added), seen down [111]: rows of the view
  // are screen right, screen up and towards the viewer, a right-handed frame (z = x cross y).
  const r2 = Math.SQRT2;
  const r6 = Math.sqrt(6);
  const r3 = Math.sqrt(3);
  const down111: View = [
    [1 / r2, -1 / r2, 0],
    [1 / r6, 1 / r6, -2 / r6],
    [1 / r3, 1 / r3, 1 / r3],
  ];
  const one = (look: PolyhedronLook) =>
    buildScene(structure("perovskite-SrTiO3_COD-9006864.cif"), {
      ...DEFAULT_SPEC,
      range: range([-0.01, -0.01, -0.01], [0.01, 0.01, 0.01]),
      bonds: [rule("Ti", "O", 2.3, { polyhedronLook: look })],
      showLegend: false,
      showAxes: false,
      showCell: false,
    });
  const polygons = (svg: string): number => (svg.match(/<polygon/g) ?? []).length;

  it("glass: the 4 faces turned away come before the Ti atom, the 4 facing the viewer after it", () => {
    const scene = one("glass");
    expect(scene.spheres).toHaveLength(7);
    const drawn = layoutAll(scene, down111, DEFAULT_CANVAS);
    const ti = drawn.findIndex((d) => d.kind === "sphere" && d.style === "Ti");
    const parts = drawn.map((d, i) => ({ d, i })).filter(({ d }) => d.kind === "polyhedron");
    const before = parts.filter(({ i }) => i < ti).map(({ d }) => (d.kind === "polyhedron" ? d.svg : "")).join("");
    const after = parts.filter(({ i }) => i > ti).map(({ d }) => (d.kind === "polyhedron" ? d.svg : "")).join("");
    expect(polygons(before)).toBe(4);
    expect(polygons(after)).toBe(4);
    // A corner nearer the viewer than the centre is drawn over the polyhedron, a farther one under it.
    const oxygens = drawn.map((d, i) => ({ d, i })).filter(({ d }) => d.kind === "sphere" && d.style === "O");
    const first = parts[0]!.i;
    const last = parts[parts.length - 1]!.i;
    for (const { d, i } of oxygens) {
      if (d.depth > 0) expect(i).toBeGreaterThan(last);
      else expect(i).toBeLessThan(first);
    }
    expect(oxygens.filter(({ d }) => d.depth > 0)).toHaveLength(3);
  });

  it("solid: only the 4 front faces, and no Ti atom drawn inside", () => {
    const drawn = layoutAll(one("solid"), down111, DEFAULT_CANVAS);
    expect(drawn.some((d) => d.kind === "sphere" && d.style === "Ti")).toBe(false);
    expect(polygons(drawn.map((d) => (d.kind === "polyhedron" ? d.svg : "")).join(""))).toBe(4);
  });

  it("line art: 4 white front faces, the 3 edges between back faces dashed, the other 9 solid", () => {
    const svg = renderSvg(one("line"), down111, DEFAULT_CANVAS);
    expect((svg.match(/<polygon class="polyhedron-face"[^>]*fill="#ffffff"/g) ?? []).length).toBe(4);
    const edges = svg.match(/<line class="polyhedron-edge"[^>]*>/g) ?? [];
    expect(edges.filter((e) => e.includes("stroke-dasharray"))).toHaveLength(3);
    expect(edges.filter((e) => !e.includes("stroke-dasharray"))).toHaveLength(9);
  });
});
