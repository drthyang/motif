// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildScene, DEFAULT_ORBITAL_COLOURS, DEFAULT_SPEC } from "../src/scene/scene";
import { orbitalById } from "../src/scene/orbitals";
import { expandToUnitCell } from "../src/structure/expand";
import { readCif } from "../src/structure/readCif";
import { isRmc6f, readRmc6f } from "../src/structure/readRmc6f";
import { readFeatures } from "../src/ui/examples";

const files = readdirSync("examples");
const features = readFeatures(readFileSync("examples/features.json", "utf8"), files);
const open = (file: string, fold = false) => {
  const text = readFileSync(`examples/${file}`, "utf8");
  return isRmc6f(text, file) ? readRmc6f(text, file, { fold }) : readCif(text);
};

describe("feature examples", () => {
  it("each opens, and shows its feature", () => {
    expect(features.map((f) => f.title)).toEqual(["Atomic structure", "Magnetic structure", "Distortion mode", "Orbital order", "RMC configuration"]);
    for (const f of features) {
      const s = open(f.file, f.fold);
      const orbitals = (f.orbitals ?? []).map((o) => {
        for (const id of o.orbitals) expect(orbitalById(id), id).toBeDefined();
        return { species: o.species, orbitals: [...o.orbitals], size: 1.6, colours: DEFAULT_ORBITAL_COLOURS, opacity: 0.6, ...(o.zFrom ? { zFrom: o.zFrom } : {}) };
      });
      const scene = buildScene(s, { ...DEFAULT_SPEC, ...(orbitals.length ? { orbitals } : {}) });
      expect(scene.spheres.length, f.title).toBeGreaterThan(0);
      if (f.title === "Magnetic structure") expect(scene.arrows.length).toBeGreaterThan(0);
      if (f.title === "Distortion mode") {
        // In its own cells: one TiO2 layer, every O2 with an arrow, none on Ti.
        const [c0, c1, c2, c3, c4, c5] = f.cells!;
        const range = { from: [c0, c1, c2] as const, to: [c3, c4, c5] as const, boundary: "both" as const };
        const layer = buildScene(s, { ...DEFAULT_SPEC, range });
        const o = layer.spheres.filter((x) => x.species === "O").length;
        expect(o).toBeGreaterThan(0);
        expect(layer.spheres.filter((x) => x.species === "Sr").length).toBe(0);
        expect(layer.arrows.length).toBe(o);
      }
      // Orbitals are drawn on every atom of the species named.
      if (orbitals.length) expect(scene.orbitals!.length).toBe(orbitals.reduce((n, o) => n + scene.spheres.filter((x) => x.species === o.species).length * o.orbitals.length, 0));
    }
  });

  it("the RMC example opens as its whole supercell, and folds into the five sites of cubic SrTiO3, each averaged to within 0.02 A of the published site", () => {
    const f = features.find((x) => x.file.endsWith(".rmc6f"))!;
    expect(f.fold).toBeUndefined(); // opens as the supercell (the user's choice, 2026-11-23); "Fold" averages it
    const whole = open(f.file, false);
    expect(whole.sites.length).toBe(1080);
    const folded = open(f.file, true);
    expect(folded.rmc!.folded).toBe(true);
    expect(folded.sites.length).toBe(5);
    const a = folded.cell.a;
    expect(a).toBeCloseTo(3.90528, 4);
    const ideal: Record<string, number[][]> = { Sr: [[0.5, 0.5, 0.5]], Ti: [[0, 0, 0]], O: [[0.5, 0, 0], [0, 0.5, 0], [0, 0, 0.5]] };
    for (const site of folded.sites) {
      const near = Math.min(...ideal[site.element]!.map((p) => Math.hypot(...p.map((x, i) => ((site.frac[i]! - x + 1.5) % 1) - 0.5)) * a));
      expect(near, site.element).toBeLessThan(0.02);
    }
    expect(expandToUnitCell(folded).atoms.length).toBe(5);
  });
});
