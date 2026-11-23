// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CANVAS, fillOutline, layoutAll, renderSvg } from "../src/render/svg";
import { DEFAULT_VIEW, viewFromAngles } from "../src/render/view";
import { atomsAndBonds, type BondRule } from "../src/scene/bonds";
import { connectedGroups, triangles } from "../src/scene/highlight";
import { BAND_COLOUR, buildScene, DEFAULT_SPEC, DEFAULT_STICK } from "../src/scene/scene";
import type { Range } from "../src/scene/select";
import { readCif } from "../src/structure/readCif";

const structure = (file: string) => readCif(readFileSync(`examples/${file}`, "utf8"));
const kagome = structure("CoSn-type-kagome_handwritten.cif");
const mnf2 = structure("MnF2-antiferromagnet_handwritten.mcif");
const rule = (species: string, max: number, more: Partial<BondRule> = {}): BondRule => ({ centre: species, neighbour: species, max, complete: false, ...more });
const range = (from: [number, number, number], to: [number, number, number]): Range => ({ from, to, boundary: "both" });

interface Case {
  example: string;
  from: [number, number, number];
  to: [number, number, number];
  element: string;
  max: number;
  atoms: number;
  bonds: number;
  triangles: number;
  groups: number[];
}

describe("chains and triangles, against a brute-force count (scripts/brute_highlights.py)", () => {
  for (const c of JSON.parse(readFileSync("tests/reference/highlights.json", "utf8")) as Case[]) {
    it(`${c.example} ${c.element}-${c.element} up to ${c.max} A in ${c.from} to ${c.to}: ${c.bonds} bonds, ${c.triangles} triangles, groups of ${c.groups}`, () => {
      const { atoms, bonds } = atomsAndBonds(structure(c.example), range(c.from, c.to), [rule(c.element, c.max)]);
      expect(atoms.filter((a) => a.species === c.element).length).toBe(c.atoms);
      expect(bonds.length).toBe(c.bonds);
      expect(triangles(bonds).length).toBe(c.triangles);
      expect(connectedGroups(atoms, bonds).map((g) => g.length).sort((p, q) => p - q)).toEqual(c.groups);
    });
  }
});

describe("by hand", () => {
  it("rock salt: the 14 Na of one cell (an fcc cube) have 36 nearest-neighbour bonds and 32 triangles", () => {
    // Each corner with its three face centres is a tetrahedron (4 faces) x 8 corners.
    const { bonds } = atomsAndBonds(structure("halite-NaCl_COD-9008678.cif"), range([0, 0, 0], [1, 1, 1]), [rule("Na", 4)]);
    expect(bonds.length).toBe(36);
    expect(triangles(bonds).length).toBe(32);
  });

  it("kagome net: two triangles per cell, every triangle equilateral with side a/2", () => {
    const { atoms, bonds } = atomsAndBonds(kagome, range([0, 0, 0], [2, 2, 0]), [rule("Co", 2.7)]);
    const found = triangles(bonds);
    expect(found.length).toBe(2 * 4);
    for (const t of found) {
      for (const [p, q] of [[0, 1], [1, 2], [0, 2]] as const) {
        const [a, b] = [atoms[t[p]]!.cart, atoms[t[q]]!.cart];
        expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeCloseTo(kagome.cell.a / 2, 9);
      }
    }
  });

  it("MnF2: Mn-Mn bonds along c make five separate chains in a 1 x 1 x 3 block, numbered the same in any view", () => {
    const { atoms, bonds } = atomsAndBonds(mnf2, range([0, 0, 0], [1, 1, 3]), [rule("Mn", 3.4)]);
    const groups = connectedGroups(atoms, bonds);
    expect(groups.length).toBe(5);
    for (const g of groups) {
      // A chain along c: all its atoms share a and b.
      for (const x of g) {
        expect(atoms[x]!.frac[0]).toBeCloseTo(atoms[g[0]!]!.frac[0], 9);
        expect(atoms[x]!.frac[1]).toBeCloseTo(atoms[g[0]!]!.frac[1], 9);
      }
    }
    // Ordered by a, then b: (0,0), (0,1), (1/2,1/2), (1,0), (1,1).
    expect(groups.map((g) => [atoms[g[0]!]!.frac[0], atoms[g[0]!]!.frac[1]])).toEqual([[0, 0], [0, 1], [0.5, 0.5], [1, 0], [1, 1]]);
  });
});

describe("drawing highlights", () => {
  const block = range([0, 0, 0], [1, 1, 3]);

  it("band on all chains: one band per chain, nothing pale", () => {
    const scene = buildScene(mnf2, { ...DEFAULT_SPEC, range: block, bonds: [rule("Mn", 3.4, { band: true })] });
    expect(scene.ruleInfo).toEqual([{ groups: 5, triangles: 0 }]);
    expect(scene.bands.length).toBe(5);
    expect(scene.bands.reduce((n, b) => n + b.segments.length, 0)).toBe(14);
    expect(scene.bands[0]!.colour).toBe(BAND_COLOUR);
    expect(scene.sticks.some((s) => s.pale)).toBe(false);
    expect(Object.keys(scene.styles).some((k) => k.endsWith("~pale"))).toBe(false);
  });

  it("band on one chain: that chain keeps its colour, the other Mn and their bonds are pale, F is untouched", () => {
    const scene = buildScene(mnf2, { ...DEFAULT_SPEC, range: block, bonds: [rule("Mn", 3.4, { band: true, chain: 2 })] });
    expect(scene.bands.length).toBe(1);
    const full = scene.spheres.filter((s) => s.style === "Mn");
    expect(full.length).toBe(3); // the body-centre chain: z = 1/2, 3/2, 5/2
    for (const s of full) expect([s.frac![0], s.frac![1]]).toEqual([0.5, 0.5]);
    expect(scene.spheres.filter((s) => s.style === "Mn~pale").length).toBe(16);
    expect(scene.spheres.filter((s) => s.species === "F").every((s) => s.style === "F")).toBe(true);
    expect(scene.sticks.filter((s) => !s.pale).length).toBe(2);
    expect(scene.sticks.filter((s) => s.pale).length).toBe(12);
    expect(scene.legend.find((e) => e.name === "Mn")!.style).toBe("Mn"); // the legend shows the full colour
    // Paling moves nothing and removes nothing.
    const plain = buildScene(mnf2, { ...DEFAULT_SPEC, range: block, bonds: [rule("Mn", 3.4)] });
    expect(scene.spheres.map((s) => s.centre)).toEqual(plain.spheres.map((s) => s.centre));
  });

  it("the band is drawn as one translucent group behind its chain and in front of what lies further back", () => {
    const scene = buildScene(mnf2, { ...DEFAULT_SPEC, range: block, bonds: [rule("Mn", 3.4, { band: true, chain: 2 })], showCell: false, showMoments: false });
    const view = viewFromAngles(0, 0); // looking along +b: larger b is further away
    const order = layoutAll(scene, view, DEFAULT_CANVAS);
    const band = order.findIndex((d) => d.kind === "band");
    const chainAtoms = order.map((d, i) => ({ d, i })).filter(({ d }) => d.kind === "sphere" && d.style === "Mn");
    for (const { i } of chainAtoms) expect(i).toBeGreaterThan(band);
    const behind = order.map((d, i) => ({ d, i })).filter(({ d }) => d.kind === "sphere" && d.style === "Mn~pale" && d.depth < -1.5);
    expect(behind.length).toBeGreaterThan(0);
    for (const { i } of behind) expect(i).toBeLessThan(band);
    const svg = renderSvg(scene, view);
    expect(svg.match(/<g class="band"/g)?.length).toBe(1);
    expect(svg).toContain(`<g class="band" opacity="0.5" stroke="${BAND_COLOUR}"`);
  });

  it("filled triangles: one polygon per triangle, drawn before its own atoms", () => {
    const scene = buildScene(kagome, { ...DEFAULT_SPEC, range: range([0, 0, 0], [2, 2, 0]), bonds: [rule("Co", 2.7, { fill: true })], showCell: false });
    expect(scene.polygons.length).toBe(8);
    const order = layoutAll(scene, DEFAULT_VIEW, DEFAULT_CANVAS);
    expect(order.filter((d) => d.kind === "polygon").length).toBe(8);
    expect(renderSvg(scene, DEFAULT_VIEW).match(/class="fill"/g)?.length).toBe(8);
    // Seen from above, every polygon comes before every Co atom (they are in one plane; the fill lies just behind).
    const above = layoutAll(scene, viewFromAngles(0, 90), DEFAULT_CANVAS);
    const lastFill = Math.max(...above.map((d, i) => (d.kind === "polygon" ? i : -1)));
    const firstCo = above.findIndex((d) => d.kind === "sphere" && d.style === "Co");
    expect(lastFill).toBeLessThan(firstCo);
  });

  it("the colour of filled triangles can be chosen; without a choice it is the usual tint, reported beside the rule", () => {
    const at = (extra: object) => buildScene(kagome, { ...DEFAULT_SPEC, range: range([0, 0, 0], [2, 2, 0]), bonds: [rule("Co", 2.7, { fill: true, ...extra })], showCell: false });
    const usual = at({});
    const tint = usual.polygons[0]!.colour;
    expect(usual.ruleInfo[0]!.fillColour).toBe(tint);
    const chosen = at({ fillColour: "#3366cc" });
    expect(chosen.polygons.every((p) => p.colour === "#3366cc")).toBe(true);
    expect(chosen.ruleInfo[0]!.fillColour).toBe("#3366cc");
    expect(renderSvg(chosen, DEFAULT_VIEW)).toContain('fill="#3366cc"');
    expect(at({ fill: false }).ruleInfo[0]!.fillColour).toBeUndefined();
  });

  it("bond colour and thickness per rule", () => {
    const scene = buildScene(kagome, { ...DEFAULT_SPEC, range: range([0, 0, 0], [1, 1, 0]), bonds: [rule("Co", 2.7, { colour: "#a3242d", width: 0.46 }), { centre: "Co", neighbour: "Sn", max: 2.7, complete: false }] });
    expect(scene.stickStyles).toEqual([{ colour: "#a3242d", width: 0.46 }, DEFAULT_STICK]);
    const svg = renderSvg(scene, DEFAULT_VIEW);
    expect(svg).toContain('<stop offset="0" stop-color="#a3242d"/>'); // the shading of those rods starts from their colour
    expect(svg).toContain(`<stop offset="0" stop-color="${DEFAULT_STICK.colour}"/>`);
  });
});

describe("leaving atoms out by a bond rule", () => {
  it("hide unbonded: exactly the oxygens with no Si within reach disappear; nothing else changes", () => {
    const quartz = structure("quartz_COD-9009666.cif");
    const slab = range([0, 0, 0], [0.45, 1, 1]);
    const siO = (more: Partial<BondRule>): BondRule => ({ centre: "Si", neighbour: "O", max: 1.8, complete: false, ...more });
    const all = buildScene(quartz, { ...DEFAULT_SPEC, range: slab, bonds: [siO({})] });
    const pruned = buildScene(quartz, { ...DEFAULT_SPEC, range: slab, bonds: [siO({ hideUnbonded: true })] });
    // By brute force on the full scene: which O have a Si within 1.8 A.
    const si = all.spheres.filter((s) => s.species === "Si");
    const lonely = all.spheres.filter((s) => s.species === "O" && !si.some((m) => Math.hypot(m.centre[0] - s.centre[0], m.centre[1] - s.centre[1], m.centre[2] - s.centre[2]) <= 1.8));
    expect(lonely.length).toBeGreaterThan(0);
    expect(pruned.spheres.length).toBe(all.spheres.length - lonely.length);
    expect(pruned.spheres.filter((s) => s.species === "Si").length).toBe(si.length);
    expect(pruned.sticks.length).toBe(all.sticks.length);
    // Every bond still joins the same two places.
    const ends = (sc: typeof all) => sc.sticks.map((b) => [sc.spheres[b.i]!.centre, sc.spheres[b.j]!.centre].map((c) => c.map((x) => x.toFixed(4)).join(",")).sort().join(" - ")).sort();
    expect(ends(pruned)).toEqual(ends(all));
  });

  it("only triangles: a ragged kagome patch keeps its triangles and loses the loose atoms and bonds", () => {
    const ragged = range([0, 0, 0], [2.6, 2.6, 0]);
    const all = buildScene(kagome, { ...DEFAULT_SPEC, range: ragged, bonds: [rule("Co", 2.7, { fill: true })], looks: { Sn: { hidden: true } } });
    const tidy = buildScene(kagome, { ...DEFAULT_SPEC, range: ragged, bonds: [rule("Co", 2.7, { fill: true, onlyTriangles: true })], looks: { Sn: { hidden: true } } });
    expect(tidy.polygons.length).toBe(all.polygons.length);
    expect(tidy.spheres.length).toBeLessThan(all.spheres.length);
    expect(tidy.sticks.length).toBeLessThan(all.sticks.length);
    const corners = new Set(tidy.polygons.flatMap((p) => p.corners));
    expect(corners.size).toBe(tidy.spheres.length); // every atom left is the corner of a triangle
    const sides = new Set(tidy.polygons.flatMap((p) => [[0, 1], [1, 2], [0, 2]].map(([a, b]) => [p.corners[a!]!, p.corners[b!]!].sort((x, y) => x - y).join("-"))));
    expect(tidy.sticks.length).toBe(sides.size); // every bond left is the side of a triangle
    // The triangles are at the same places as before.
    const places = (sc: typeof all) => sc.polygons.map((p) => p.corners.map((c) => sc.spheres[c]!.centre.map((x) => x.toFixed(4)).join(",")).sort().join(" ")).sort();
    expect(places(tidy)).toEqual(places(all));
  });
});

describe("filled triangles meet their atoms and bonds without covering them", () => {
  /** The path's points: the start, each straight side's end, each arc's end (not the arc radii). */
  const pathPoints = (d: string): [number, number][] =>
    [...d.matchAll(/([MLA])([^MLAZ]*)/g)].map((m) => {
      const numbers = m[2]!.trim().split(/[\s,]+/).map(Number);
      return [numbers[numbers.length - 2]!, numbers[numbers.length - 1]!];
    });

  it("each side runs half a bond width inside the bond line and each corner follows the atom's outline (equilateral triangle, by hand)", () => {
    // Corners of an equilateral triangle of side 300 px, atoms of radius 40 px, bonds 12 px wide (half 6).
    const [r, h] = [40, 6];
    const corners = [
      { x: 0, y: 0, r },
      { x: 300, y: 0, r },
      { x: 150, y: 150 * Math.sqrt(3), r },
    ];
    const d = fillOutline(corners, h)!;
    // Three straight sides and three arcs of the atom's radius.
    expect(d.match(/L/g)?.length).toBe(3);
    expect([...d.matchAll(/A([\d.]+),([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])).toEqual([[r, r], [r, r], [r, r]]);
    const points = pathPoints(d);
    expect(points.length).toBe(7); // start, then side end and arc end three times (the last arc returns to the start)
    const distanceToLine = (p: [number, number], a: { x: number; y: number }, b: { x: number; y: number }): number =>
      Math.abs((b.x - a.x) * (a.y - p[1]) - (a.x - p[0]) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);
    for (const p of points) {
      // On an atom's outline (to the 0.1 px the SVG is written with) ...
      expect(Math.min(...corners.map((c) => Math.abs(Math.hypot(p[0] - c.x, p[1] - c.y) - r)))).toBeLessThan(0.11);
      // ... and h from the nearest bond line, on the inside.
      const lines = corners.map((c, k) => distanceToLine(p, c, corners[(k + 1) % 3]!));
      expect(Math.abs(Math.min(...lines) - h)).toBeLessThan(0.11);
    }
    // The first side lies along the bond y = 0: it starts sqrt(r^2 - h^2) from the first atom, h inside.
    expect(points[0]![0]).toBeCloseTo(Math.sqrt(r * r - h * h), 1);
    expect(points[0]![1]).toBeCloseTo(h, 1);
  });

  it("gives nothing when the atoms cover a whole side, or the triangle is seen edge on", () => {
    expect(fillOutline([{ x: 0, y: 0, r: 60 }, { x: 100, y: 0, r: 60 }, { x: 50, y: 80, r: 60 }], 6)).toBeNull();
    expect(fillOutline([{ x: 0, y: 0, r: 10 }, { x: 100, y: 0, r: 10 }, { x: 200, y: 0, r: 10 }], 6)).toBeNull();
  });
});
