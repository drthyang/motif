// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildScene, DEFAULT_SPEC } from "../src/scene/scene";
import { atomsInRange, ONE_CELL, type Range } from "../src/scene/select";
import { fractionalToCartesian } from "../src/structure/cell";
import { readCif } from "../src/structure/readCif";

const structure = (name: string) => readCif(readFileSync(`examples/${name}.cif`, "utf8"));
const count = (name: string, range: Range): Record<string, number> => {
  const n: Record<string, number> = {};
  for (const a of atomsInRange(structure(name), range).atoms) n[a.species] = (n[a.species] ?? 0) + 1;
  return n;
};

describe("range, by hand", () => {
  it("rock salt, one cell with boundary atoms repeated: the 3 x 3 x 3 cube, 14 + 13", () => {
    const n = count("halite-NaCl_COD-9008678", ONE_CELL);
    expect(Object.values(n).sort()).toEqual([13, 14]);
  });

  it("rock salt, each atom once: 4 + 4", () => {
    expect(count("halite-NaCl_COD-9008678", { ...ONE_CELL, boundary: "once" })).toEqual({ Na: 4, Cl: 4 });
  });

  it("silicon, one cell with boundary atoms repeated: 8 corners + 6 faces + 4 inside", () => {
    expect(count("silicon_COD-9008565", ONE_CELL)).toEqual({ Si: 18 });
  });

  it("cubic perovskite, one cell with boundary atoms repeated: 8 corners + 12 edge centres + 1 body centre", () => {
    expect(count("perovskite-SrTiO3_COD-9006864", ONE_CELL)).toEqual({ Sr: 1, Ti: 8, O: 12 });
  });

  it("each atom once: n cells hold n times the cell content, wherever the range starts", () => {
    for (const from of [0, 0.37, -1.2]) {
      const n = count("quartz_COD-9009666", { from: [from, from, from], to: [from + 2, from + 1, from + 3], boundary: "once" });
      expect(n).toEqual({ Si: 18, O: 36 });
    }
  });

  it("a slab keeps only atoms between its limits", () => {
    const s = structure("quartz_COD-9009666");
    const { atoms } = atomsInRange(s, { from: [0, 0, 0.2], to: [2, 2, 0.5], boundary: "both" });
    expect(atoms.length).toBeGreaterThan(0);
    for (const a of atoms) expect(a.frac[2] >= 0.2 - 1e-3 && a.frac[2] <= 0.5 + 1e-3).toBe(true);
  });

  it("refuses a reversed or non-numeric range, and one that is far too large", () => {
    const s = structure("silicon_COD-9008565");
    expect(() => atomsInRange(s, { from: [0, 0, 0], to: [1, -1, 1], boundary: "both" })).toThrow(/below/);
    expect(() => atomsInRange(s, { from: [0, NaN, 0], to: [1, 1, 1], boundary: "both" })).toThrow(/number/);
    expect(() => atomsInRange(s, { from: [0, 0, 0], to: [30, 30, 30], boundary: "both" })).toThrow(/more than/);
  });
});

interface Case extends Range {
  atoms: { element: string; frac: number[]; cart: number[] }[];
}

describe("range, against gemmi (scripts/gemmi_ranges.py)", () => {
  const reference = JSON.parse(readFileSync("tests/reference/ranges.json", "utf8")) as Record<string, Case[]>;
  for (const [name, cases] of Object.entries(reference)) {
    const s = structure(name);
    for (const c of cases) {
      it(`${name}: ${c.from.join(",")} to ${c.to.join(",")} (${c.boundary}): same ${c.atoms.length} atoms at the same places`, () => {
        const scene = buildScene(s, { ...DEFAULT_SPEC, range: { from: c.from, to: c.to, boundary: c.boundary }, showCell: false });
        expect(scene.spheres.length).toBe(c.atoms.length);
        const unmatched = [...c.atoms];
        for (const sphere of scene.spheres) {
          // Positions compared in angstrom, not modulo the lattice: the atom must be in the same cell too.
          const i = unmatched.findIndex(
            (r) => r.element === sphere.style && Math.hypot(r.cart[0]! - sphere.centre[0], r.cart[1]! - sphere.centre[1], r.cart[2]! - sphere.centre[2]) < 1e-4,
          );
          expect(i, `${sphere.label} at ${sphere.frac?.join(", ")} is not in the gemmi list`).toBeGreaterThanOrEqual(0);
          unmatched.splice(i, 1);
        }
        expect(unmatched).toEqual([]);
      });
    }
  }

  it("positions are the fractional coordinates turned into angstrom", () => {
    const s = structure("quartz_COD-9009666");
    for (const sphere of buildScene(s).spheres) expect(sphere.centre).toEqual(fractionalToCartesian(s.cell, sphere.frac!));
  });
});
