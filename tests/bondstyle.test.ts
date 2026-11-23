// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bondPieces, renderSvg } from "../src/render/svg";
import { DEFAULT_VIEW } from "../src/render/view";
import { buildScene, DEFAULT_SPEC, elementColour } from "../src/scene/scene";
import type { BondRule } from "../src/scene/bonds";
import { readCif } from "../src/structure/readCif";

const halite = readCif(readFileSync("examples/halite-NaCl_COD-9008678.cif", "utf8"));
const rule = (extra: Partial<BondRule>): BondRule[] => [{ centre: "Na", neighbour: "Cl", max: 3, complete: false, ...extra }];
const svgOf = (extra: Partial<BondRule>, spec = {}) => renderSvg(buildScene(halite, { ...DEFAULT_SPEC, ...spec, bonds: rule(extra) }), DEFAULT_VIEW);

describe("bond styles", () => {
  it("dashes and dots fill the visible length exactly, symmetric about the middle", () => {
    for (const line of ["dashed", "dotted"] as const) {
      const p = bondPieces(line, 0.2, 0.8, 2.82, 0.12);
      expect(p[0]![0]).toBeCloseTo(0.2, 12);
      expect(p[p.length - 1]![1]).toBeCloseTo(0.8, 12);
      // Symmetric: the pattern seen from b is the pattern seen from a.
      p.forEach(([s, e], k) => {
        const [s2, e2] = p[p.length - 1 - k]!;
        expect(s).toBeCloseTo(1 - e2, 12);
        expect(e).toBeCloseTo(1 - s2, 12);
      });
    }
    // Dashes 2.5 rod widths with gaps of 1.5: 0.6 x 2.82 A = 1.692 A holds 1.692 / 0.48 = 3.5 -> round((1.692 + 0.18) / 0.48) = 4 dashes.
    expect(bondPieces("dashed", 0.2, 0.8, 2.82, 0.12).length).toBe(4);
    expect(bondPieces("solid", 0.2, 0.8, 2.82, 0.12)).toEqual([]);
  });

  it("atom colours: each half has its own shading, from its own atom's colour; one colour has a single shading", () => {
    const svg = svgOf({ colouring: "atoms" });
    const gradient = (id: string) => new RegExp(`<linearGradient id="${id}"[^>]*>(.*?)</linearGradient>`).exec(svg)?.[1];
    const [a, b] = [gradient("bond-0a"), gradient("bond-0b")];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
    // The Na half carries Na's colour family and the Cl half Cl's: the middle stop is the colour itself.
    const has = (stops: string, colour: string) => stops.toLowerCase().includes(colour.toLowerCase());
    const [na, cl] = [elementColour("Na", {}), elementColour("Cl", {})];
    expect([has(a!, na) && has(b!, cl), has(a!, cl) && has(b!, na)]).toContain(true);
    const single = svgOf({});
    expect(single).not.toMatch(/id="bond-0a"/);
    expect(single).toMatch(/id="bond-0"/);
  });

  it("dashed bonds are drawn as several pieces, dotted as round dots, solid as two halves", () => {
    const count = (svg: string, re: RegExp) => (svg.match(re) ?? []).length;
    const solid = count(svgOf({}), /<polygon class="bond"/g);
    const dashed = count(svgOf({ line: "dashed" }), /<polygon class="bond"/g);
    expect(dashed).toBeGreaterThan(solid);
    expect(count(svgOf({ line: "dotted" }), /<circle class="bond"/g)).toBeGreaterThan(0);
  });

  it("with more bonds than rods are drawn for, the plain strokes carry the dash pattern", () => {
    const scene = buildScene(halite, { ...DEFAULT_SPEC, bonds: rule({ line: "dashed" }), range: { ...DEFAULT_SPEC.range, to: [6, 6, 6] } });
    const svg = renderSvg(scene, DEFAULT_VIEW);
    expect(scene.sticks.length).toBeGreaterThan(1500);
    expect(svg).toMatch(/<line class="bond"[^>]*stroke-dasharray="/);
  });
});
