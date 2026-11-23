// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CANVAS, renderSvg } from "../src/render/svg";
import { DEFAULT_VIEW } from "../src/render/view";
import { buildScene, DEFAULT_SPEC, displacementToCartesian, largestDisplacement } from "../src/scene/scene";
import { formulaTerms, readBasis, transformedCell, withDisplacements } from "../src/structure/distortion";
import { expandToUnitCell } from "../src/structure/expand";
import { readCif } from "../src/structure/readCif";
import type { Structure, Vec3 } from "../src/structure/types";

const bto = readCif(readFileSync("examples/BaTiO3-ferroelectric-distortion_COD-2100858.cif", "utf8"));
const cart = (s: Structure, label: string): Vec3[] =>
  expandToUnitCell(s)
    .atoms.filter((a) => a.label === label)
    .map((a) => (a.displacement ? displacementToCartesian(s, a.displacement) : [0, 0, 0]));

describe("ISODISTORT file: BaTiO3, cubic Pm-3m to tetragonal P4mm (COD 2100858, ISODISTORT 6.12.2)", () => {
  it("reads the four displacive modes of GM4-, the undistorted cell, and says the strain modes are not drawn", () => {
    const d = bto.distortion!;
    expect(d.modes.map((m) => m.amplitude)).toEqual([0, -0.07211, 0.0641, 0.08498]);
    expect(d.modes.every((m) => m.label.includes("GM4-"))).toBe(true);
    expect(d.undistortedCell.a).toBeCloseTo(4.006, 9);
    expect(d.undistortedCell.c).toBeCloseTo(4.006, 9);
    expect(d.notDrawn).toEqual(["2 strain modes"]);
  });

  it("displacements agree with a hand calculation from the published coordinates: (distorted - cubic) x 4.006 A along c", () => {
    // Published P4mm coordinates (Buttner & Maslen 1992): Ti z = 0.4820, O1 z = 0.016, O2 z = 0.515; Ba fixed at z = 0.
    // Cubic positions in the same origin: Ti 1/2, O1 0, O2 1/2. The file's 5 decimals allow 2e-4 A.
    const expectAlongC = (label: string, dz: number, count: number): void => {
      const all = cart(bto, label);
      expect(all.length).toBe(count);
      for (const v of all) {
        expect(v[0]).toBeCloseTo(0, 9);
        expect(v[1]).toBeCloseTo(0, 9);
        expect(Math.abs(v[2] - dz * 4.006)).toBeLessThan(2e-4);
      }
    };
    expectAlongC("Ti", 0.482 - 0.5, 1);
    expectAlongC("O1", 0.016 - 0, 1);
    expectAlongC("O2", 0.515 - 0.5, 2);
    expect(cart(bto, "Ba")).toEqual([[0, 0, 0]]);
    expect(largestDisplacement(bto)).toBeCloseTo(0.0721, 3);
  });

  it("a mode switched off adds nothing: with only the Ti mode, only Ti moves, by its amplitude", () => {
    const tiOnly = withDisplacements(bto, [false, true, false, false]);
    expect(cart(tiOnly, "Ti")[0]![2]).toBeCloseTo(-0.07211, 4);
    for (const label of ["Ba", "O1", "O2"]) for (const v of cart(tiOnly, label)) expect(Math.hypot(...v)).toBe(0);
  });

  it("the arrows start at the atom's centre, the largest has the chosen length, and Ti's points along -c", () => {
    const scene = buildScene(bto, { ...DEFAULT_SPEC, displacementLength: 1.5 });
    const ti = scene.spheres.findIndex((s) => s.label === "Ti");
    const arrow = scene.arrows.find((a) => a.sphere === ti)!;
    expect(arrow.start).toBe("centre");
    expect(Math.hypot(...arrow.vector)).toBeCloseTo(1.5, 9);
    expect(arrow.vector[2]).toBeLessThan(0);
    expect(scene.arrows.some((a) => scene.spheres[a.sphere]!.label === "Ba")).toBe(false);
    // The drawing has the arrow heads (their direction on the page is checked by eye in the browser).
    const svg = renderSvg(scene, DEFAULT_VIEW, DEFAULT_CANVAS);
    expect(svg).toContain('class="arrow-head"');
    const off = buildScene(bto, { ...DEFAULT_SPEC, showDisplacements: false });
    expect(off.arrows.length).toBe(0);
  });
});

describe("displacements under symmetry: polar vectors, d' = R d", () => {
  it("each image's displacement equals the image of the displaced site minus the image of the site (quartz, every operation)", () => {
    const quartz = readCif(readFileSync("examples/quartz_COD-9009666.cif", "utf8"));
    const o = quartz.sites.findIndex((s) => s.element === "O");
    const d: Vec3 = [0.013, -0.021, 0.008];
    const shifted: Structure = { ...quartz, sites: quartz.sites.map((s, i) => (i === o ? { ...s, displacement: d } : s)) };
    const moved: Structure = { ...quartz, sites: quartz.sites.map((s, i) => (i === o ? { ...s, frac: [s.frac[0] + d[0], s.frac[1] + d[1], s.frac[2] + d[2]] } : s)) };
    const label = quartz.sites[o]!.label;
    const [base, after, carried] = [expandToUnitCell(quartz), expandToUnitCell(moved), expandToUnitCell(shifted)].map((e) => e.atoms.filter((a) => a.label === label));
    expect(carried!.length).toBe(6);
    carried!.forEach((atom, n) => {
      for (let i = 0; i < 3; i++) {
        const diff = after![n]!.frac[i]! - base![n]!.frac[i]!;
        expect(atom.displacement![i]).toBeCloseTo(diff - Math.round(diff), 9);
      }
    });
  });
});

describe("reading the ISODISTORT tags", () => {
  it("coordinate formulas: the constant is dropped, each shift keeps its coefficient", () => {
    const names = new Set(["Ti_dz", "O_dx", "O_dy"]);
    expect(formulaTerms("1/2 + Ti_dz", names)).toEqual([{ name: "Ti_dz", coefficient: 1 }]);
    expect(formulaTerms("1/4 - 2*O_dx + O_dy", names)).toEqual([
      { name: "O_dx", coefficient: -2 },
      { name: "O_dy", coefficient: 1 },
    ]);
    expect(formulaTerms("0", names)).toEqual([]);
    expect(() => formulaTerms("1/2 + Q_dz", names)).toThrow();
  });

  it("the parent-to-child basis gives the undistorted supercell: a-b, a+b, 2c of a 4 A cube is 5.657 x 5.657 x 8", () => {
    const basis = readBasis("a-b,a+b,2c;0,0,1/2");
    expect(basis).toEqual([[1, -1, 0], [1, 1, 0], [0, 0, 2]]);
    const cell = transformedCell({ a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 }, basis);
    expect(cell.a).toBeCloseTo(4 * Math.SQRT2, 12);
    expect(cell.b).toBeCloseTo(4 * Math.SQRT2, 12);
    expect(cell.c).toBeCloseTo(8, 12);
    expect(cell.gamma).toBeCloseTo(90, 12);
  });

  it("a file whose modes do not rebuild its stated shifts is refused", () => {
    const text = readFileSync("examples/BaTiO3-ferroelectric-distortion_COD-2100858.cif", "utf8").replace("2 Ti_dz  -0.01800", "2 Ti_dz  -0.02800");
    expect(() => readCif(text)).toThrow(/do not agree/);
  });
});
