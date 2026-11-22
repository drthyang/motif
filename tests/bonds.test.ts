// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOND_START, DEFAULT_CANVAS, layoutAll, pxPerAngstrom, renderSvg } from "../src/render/svg";
import { DEFAULT_VIEW, viewFromAngles } from "../src/render/view";
import { atomsAndBonds, pairDistances, type BondRule } from "../src/scene/bonds";
import { buildScene, cellEdgesInRange, DEFAULT_SPEC, type Scene } from "../src/scene/scene";
import { ONE_CELL, type Range } from "../src/scene/select";
import { readCif } from "../src/structure/readCif";

const structure = (name: string) => readCif(readFileSync(`examples/${name}.cif`, "utf8"));
const rule = (centre: string, neighbour: string, max: number, complete = false): BondRule => ({ centre, neighbour, max, complete });

interface Case {
  example: string;
  from: [number, number, number];
  to: [number, number, number];
  centre: string;
  neighbour: string;
  max: number;
  complete: boolean;
  bonds: [number, number, number, number][];
  added: number;
}

describe("bonds, against gemmi with every pair tried (scripts/gemmi_bonds.py)", () => {
  const cases = JSON.parse(readFileSync("tests/reference/bonds.json", "utf8")) as Case[];
  for (const c of cases) {
    it(`${c.example}: ${c.centre}-${c.neighbour} up to ${c.max} A, ${c.from} to ${c.to}${c.complete ? ", neighbours added" : ""}: ${c.bonds.length} bonds`, () => {
      const range: Range = { from: c.from, to: c.to, boundary: "both" };
      const { atoms, bonds } = atomsAndBonds(structure(c.example), range, [rule(c.centre, c.neighbour, c.max, c.complete)]);
      expect(bonds.length).toBe(c.bonds.length);
      expect(atoms.filter((a) => a.added).length).toBe(c.added);
      const unmatched = [...c.bonds];
      for (const b of bonds) {
        const [p, q] = [atoms[b.i]!.cart, atoms[b.j]!.cart];
        const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
        // Same place (midpoint, in angstrom) and same length. Lengths to 1e-4 A: quartz writes z = 0.33333 for 1/3,
        // and the two programs keep images of that site that differ by 4e-5 A.
        const k = unmatched.findIndex((r) => Math.hypot(r[0] - mid[0]!, r[1] - mid[1]!, r[2] - mid[2]!) < 1e-3 && Math.abs(r[3] - b.length) < 1e-4);
        expect(k, `bond at ${mid.join(", ")} of ${b.length} A is not in the reference`).toBeGreaterThanOrEqual(0);
        unmatched.splice(k, 1);
      }
      expect(unmatched).toEqual([]);
    });
  }
});

describe("bonds, by hand", () => {
  it("rock salt, one complete cell: the 54 edges of a 3 x 3 x 3 grid, each a/2 long", () => {
    const s = structure("halite-NaCl_COD-9008678");
    const { bonds } = atomsAndBonds(s, ONE_CELL, [rule("Na", "Cl", 3)]);
    expect(bonds.length).toBe(54);
    for (const b of bonds) expect(b.length).toBeCloseTo(s.cell.a / 2, 9);
  });

  it("silicon, one complete cell: 16 bonds (4 inner atoms x 4)", () => {
    expect(atomsAndBonds(structure("silicon_COD-9008565"), ONE_CELL, [rule("Si", "Si", 2.5)]).bonds.length).toBe(16);
  });

  it("with neighbours added, every centre in the range has its full coordination", () => {
    const cases: [string, string, string, number, number][] = [
      ["perovskite-SrTiO3_COD-9006864", "Ti", "O", 2.1, 6],
      ["perovskite-SrTiO3_COD-9006864", "Sr", "O", 2.9, 12],
      ["quartz_COD-9009666", "Si", "O", 1.8, 4],
      ["quartz_COD-9009666", "O", "Si", 1.8, 2],
      ["silicon_COD-9008565", "Si", "Si", 2.5, 4],
      ["halite-NaCl_COD-9008678", "Na", "Cl", 3, 6],
    ];
    for (const [name, centre, neighbour, max, coordination] of cases) {
      const range: Range = { from: [0.1, -0.4, 0], to: [1.3, 1, 0.8], boundary: "both" };
      const { atoms, bonds } = atomsAndBonds(structure(name), range, [rule(centre, neighbour, max, true)]);
      atoms.forEach((a, index) => {
        if (a.species !== centre || a.added) return;
        expect(bonds.filter((b) => b.i === index || b.j === index).length, `${name} ${a.label}`).toBe(coordination);
      });
      // Nothing is added twice, and nothing added is inside the range.
      const places = atoms.map((a) => a.cart.map((x) => x.toFixed(4)).join(","));
      expect(new Set(places).size).toBe(atoms.length);
    }
  });

  it("without neighbours added, no atom outside the range appears", () => {
    const { atoms } = atomsAndBonds(structure("quartz_COD-9009666"), ONE_CELL, [rule("Si", "O", 1.8)]);
    expect(atoms.some((a) => a.added)).toBe(false);
  });

  it("lists the distances between two elements, shortest first", () => {
    const a = structure("halite-NaCl_COD-9008678").cell.a;
    const d = pairDistances(structure("halite-NaCl_COD-9008678"), "Na", "Cl");
    expect(d[0]).toBeCloseTo(a / 2, 2);
    expect(d[1]).toBeCloseTo((a * Math.sqrt(3)) / 2, 2);
    expect(pairDistances(structure("silicon_COD-9008565"), "Si", "Si")[0]).toBeCloseTo((5.4307 * Math.sqrt(3)) / 4, 2);
  });

  it("refuses a bond distance that is not a sensible number", () => {
    expect(() => atomsAndBonds(structure("silicon_COD-9008565"), ONE_CELL, [rule("Si", "Si", NaN)])).toThrow();
    expect(() => atomsAndBonds(structure("silicon_COD-9008565"), ONE_CELL, [rule("Si", "Si", 50)])).toThrow();
  });
});

describe("unit cell outline", () => {
  const quartz = structure("quartz_COD-9009666");
  it("one cell has 12 edges; two cells side by side share 4 and have 20", () => {
    expect(cellEdgesInRange(quartz, ONE_CELL).length).toBe(12);
    expect(cellEdgesInRange(quartz, { from: [0, 0, 0], to: [2, 1, 1], boundary: "both" }).length).toBe(20);
  });

  it("edge lengths are a, b, c (four of each)", () => {
    const lengths = cellEdgesInRange(quartz, ONE_CELL).map(([p, q]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]).toFixed(4)).sort();
    const { a, c } = quartz.cell;
    expect(lengths).toEqual([...Array<string>(8).fill(a.toFixed(4)), ...Array<string>(4).fill(c.toFixed(4))].sort());
  });

  it("a slab holds no whole cell, so no outline; a range past one cell draws only whole cells", () => {
    expect(cellEdgesInRange(quartz, { from: [0, 0, 0.2], to: [3, 3, 0.7], boundary: "both" }).length).toBe(0);
    expect(cellEdgesInRange(quartz, { from: [-0.2, 0, 0], to: [1.5, 1, 1], boundary: "both" }).length).toBe(12);
  });
});

describe("bonds as rods", () => {
  // Two atoms 3 A apart along x, radius 0.5, bond 0.2 thick.
  const pair = (material?: "soft"): Scene => ({
    spheres: [{ style: "X", label: "p", centre: [0, 0, 0] }, { style: "X", label: "q", centre: [3, 0, 0] }],
    sticks: [{ i: 0, j: 1, rule: 0, length: 3 }],
    cellEdges: [],
    stickStyles: [{ colour: "#b4bbc1", width: 0.2 }],
    ruleInfo: [],
    bands: [],
    polygons: [],
    sectors: [],
    angleKinds: [],
    styles: { X: { colour: "#808080", radius: 0.5 } },
    centre: [1.5, 0, 0],
    extent: 3,
    arrows: [],
    arrowColour: "#000000",
    letterWeight: 800,
    legend: [],
    axes: [],
    warnings: [],
    ...(material ? { bondMaterial: material, bondOutline: true } : {}),
  });
  const names = (order: ReturnType<typeof layoutAll>): string[] => order.map((d) => (d.kind === "sphere" ? d.label : d.kind));

  it("in the screen plane: two halves from the atoms' centres to the middle, both drawn before the atoms, which cut them with their outlines", () => {
    const scene = pair("soft");
    const view = viewFromAngles(0, 0);
    const order = layoutAll(scene, view, DEFAULT_CANVAS);
    expect(names(order)).toEqual(["bond", "bond", "p", "q"]);
    const scale = pxPerAngstrom(scene, view, DEFAULT_CANVAS);
    const [p, q] = [order.find((d) => d.kind === "sphere" && d.label === "p")!, order.find((d) => d.kind === "sphere" && d.label === "q")!];
    if (p.kind !== "sphere" || q.kind !== "sphere") throw new Error();
    const halves = order.filter((d) => d.kind === "bond");
    for (const h of halves) {
      if (h.kind !== "bond") continue;
      const own = Math.abs(h.x1 - p.x) < 1e-6 ? p : q;
      expect(h.x1).toBeCloseTo(own.x, 6); // starts at its atom's centre
      expect(Math.abs(h.x2 - (p.x + q.x) / 2) / scale).toBeLessThan(0.05); // ends at the middle (a hair past it)
      expect(h.width / scale).toBeCloseTo(0.2, 9);
      expect(h.svg).toContain("bond-edge"); // outlined along its sides
    }
  });

  it("pointing at the viewer: the near atom's half comes from behind it, the far atom's half comes out of its face with a rounded foot", () => {
    const scene = pair("soft");
    const order = layoutAll(scene, viewFromAngles(-60, 0), DEFAULT_CANVAS); // q is the nearer atom
    expect(names(order)).toEqual(["p", "bond", "bond", "q"]);
    const [fromP, fromQ] = order.filter((d) => d.kind === "bond");
    if (fromP?.kind !== "bond" || fromQ?.kind !== "bond") throw new Error();
    const corners = (svg: string): number => /class="bond" points="([^"]+)"/.exec(svg)![1]!.split(" ").length;
    expect(corners(fromP.svg!)).toBe(4 + 7); // out of p's face: four corners and the rounded foot
    expect(corners(fromQ.svg!)).toBe(4); // from behind q: a plain quad, cut by q's outline
    // The foot is on p's face, inside its disc.
    const p = order.find((d) => d.kind === "sphere" && d.label === "p")!;
    if (p.kind !== "sphere") throw new Error();
    expect(Math.hypot(fromP.x1 - p.x, fromP.y1 - p.y)).toBeLessThan(p.r);
    expect(Math.hypot(fromP.x1 - p.x, fromP.y1 - p.y)).toBeGreaterThan(0.2 * p.r);
  });

  it("without a surface, or above the limit, a bond is one plain stroke as before", () => {
    const order = layoutAll(pair(), viewFromAngles(0, 0), DEFAULT_CANVAS);
    expect(order.filter((d) => d.kind === "bond").length).toBe(1);
    expect(renderSvg(pair(), viewFromAngles(0, 0))).toContain('<line class="bond"');
  });
});

describe("drawing bonds and the cell", () => {
  it("draws each bond and cell edge once", () => {
    const scene = buildScene(structure("halite-NaCl_COD-9008678"), { ...DEFAULT_SPEC, bonds: [rule("Na", "Cl", 3)], showLegend: false, showAxes: false });
    const svg = renderSvg(scene, DEFAULT_VIEW);
    expect(scene.sticks.length).toBe(54);
    expect(svg.match(/<polygon class="bond"/g)?.length).toBe(54 * 2); // a rod in two halves, one from each atom
    expect(svg.match(/<linearGradient id="bond-\d+"/g)?.length).toBe(54); // one shading per bond, shared by its halves
    expect(scene.cellEdges.length).toBe(12);
    // Each edge (5.64 A) is drawn in 12 pieces of at most 0.5 A, with continuous dashes.
    expect(svg.match(/class="cell"/g)?.length).toBe(12 * 12);
    expect(svg.match(/<circle /g)?.length).toBe(27);
  });

  it("a bond runs between the two surfaces, and the nearer atom is drawn over it", () => {
    // Two atoms 3 A apart along x, seen from the side, then end on.
    const scene: Scene = {
      spheres: [{ style: "X", label: "p", centre: [0, 0, 0] }, { style: "X", label: "q", centre: [3, 0, 0] }],
      sticks: [{ i: 0, j: 1, rule: 0, length: 3 }],
      cellEdges: [],
      stickStyles: [],
      ruleInfo: [],
      bands: [],
      polygons: [],
      sectors: [],
      angleKinds: [],
      styles: { X: { colour: "#808080", radius: 0.5 } },
      centre: [1.5, 0, 0],
      extent: 3,
      arrows: [],
      arrowColour: "#000000",
      letterWeight: 800,
      legend: [],
      axes: [],
      warnings: [],
    };
    const scale = pxPerAngstrom(scene, viewFromAngles(0, 0), DEFAULT_CANVAS);
    const side = layoutAll(scene, viewFromAngles(0, 0), DEFAULT_CANVAS);
    const bond = side.find((d) => d.kind === "bond")!;
    if (bond.kind !== "bond") throw new Error();
    expect(Math.abs(bond.x2 - bond.x1) / scale).toBeCloseTo(3 - 2 * 0.5 * BOND_START, 9);
    // Turn so that q is nearer the viewer: order must be p, bond, q.
    const endOn = layoutAll(scene, viewFromAngles(-60, 0), DEFAULT_CANVAS);
    expect(endOn.map((d) => (d.kind === "sphere" ? d.label : d.kind))).toEqual(["p", "bond", "q"]);
  });
});
