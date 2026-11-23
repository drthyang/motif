// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { describe, expect, it } from "vitest";
import { expandToUnitCell } from "../src/structure/expand";
import { fractionalToCartesian } from "../src/structure/cell";
import { isRmc6f, readRmc6f } from "../src/structure/readRmc6f";
import type { Structure } from "../src/structure/types";

/**
 * A hand-written RMCProfile configuration: rock salt (textbook, a = 5.64 A), a 2 x 1 x 1 supercell of the
 * conventional cell, 16 atoms. `vectors` are the lattice vector rows; `extra` is appended to the atom list.
 */
function rockSalt(vectors = ["11.28 0 0", "0 5.64 0", "0 0 5.64"], extra: string[] = [], declared = 16): string {
  const base: [number, number, number][] = [[0, 0, 0], [0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]];
  const lines: string[] = [];
  let n = 0;
  for (const [element, shift] of [["Na", [0, 0, 0]], ["Cl", [0.5, 0, 0]]] as const) {
    for (let cell = 0; cell < 2; cell++) {
      for (const [k, p] of base.entries()) {
        const f = [((p[0] + shift[0]) % 1 + cell) / 2, (p[1] + shift[1]) % 1, (p[2] + shift[2]) % 1];
        n += 1;
        lines.push(`${String(n).padStart(6)}   ${element} [${k + 1}]  ${f.map((x) => x.toFixed(6)).join("  ")}   ${k + 1} ${cell} 0 0`);
      }
    }
  }
  return [
    "(Version 6f format configuration file)",
    "Metadata title:      rock salt test",
    "Number of types of atoms:   2",
    "Atom types present:         Na Cl",
    `Number of atoms:            ${declared}`,
    "Supercell dimensions:       2 1 1",
    "Cell (Ang/deg):    11.28 5.64 5.64 90 90 90",
    "Lattice vectors (Ang):",
    ...vectors.map((v) => `   ${v}`),
    "Atoms:",
    ...lines,
    ...extra,
  ].join("\n");
}

const distances = (s: Structure): number[] => {
  const atoms = expandToUnitCell(s).atoms;
  const out: number[] = [];
  for (const a of atoms) {
    const ca = fractionalToCartesian(s.cell, a.frac);
    for (const b of atoms) {
      if (a === b) continue;
      // Nearest image in the supercell.
      const d = a.frac.map((x, i) => {
        const t = b.frac[i]! - x;
        return t - Math.round(t);
      }) as [number, number, number];
      const cd = fractionalToCartesian(s.cell, d);
      out.push(Math.hypot(...cd));
      void ca;
    }
  }
  return out.sort((p, q) => p - q);
};

describe("RMCProfile configuration (.rmc6f), read as P1", () => {
  it("is recognised by name or by its first line", () => {
    expect(isRmc6f("", "run.rmc6f")).toBe(true);
    expect(isRmc6f("(Version 6f format configuration file)\n...", "x")).toBe(true);
    expect(isRmc6f("data_x\n_cell_length_a 1", "x.cif")).toBe(false);
  });

  it("every atom is its own site, the identity is the only operation, and the cell comes from the lattice vectors", () => {
    const s = readRmc6f(rockSalt(), "rs.rmc6f");
    expect(s.name).toBe("rock salt test");
    expect(s.operations.map((o) => o.xyz)).toEqual(["x,y,z"]);
    expect(s.sites.length).toBe(16);
    expect(expandToUnitCell(s).atoms.length).toBe(16);
    expect([s.cell.a, s.cell.b, s.cell.c, s.cell.alpha, s.cell.beta, s.cell.gamma]).toEqual([11.28, 5.64, 5.64, 90, 90, 90]);
    // Rock salt by hand: the nearest neighbours are a/2 = 2.82 A apart and always Na-Cl. In this cell, one
    // conventional cell long along b and c, the neighbours at +-a/2 along b (and c) are the same atom, so each
    // ion has 4 distinct nearest neighbours: 2 along a, 1 along b, 1 along c.
    const d = distances(s);
    expect(d[0]).toBeCloseTo(2.82, 6);
    expect(d.filter((x) => Math.abs(x - 2.82) < 1e-6).length).toBe(16 * 4);
    const atoms = expandToUnitCell(s).atoms;
    for (const a of atoms) for (const b of atoms) {
      const t = a.frac.map((x, i) => { const u = b.frac[i]! - x; return u - Math.round(u); }) as [number, number, number];
      if (a !== b && Math.abs(Math.hypot(...fractionalToCartesian(s.cell, t)) - 2.82) < 1e-6) expect(a.species).not.toBe(b.species);
    }
  });

  it("lattice vectors in another orientation give the same crystal (a rigid turn): the same cell and distances", () => {
    // The same lattice turned 30 degrees about z, as RMCProfile writes hexagonal cells (a not along x).
    const c30 = Math.cos(Math.PI / 6);
    const s30 = Math.sin(Math.PI / 6);
    const turned = readRmc6f(rockSalt([`${11.28 * c30} ${-11.28 * s30} 0`, `${5.64 * s30} ${5.64 * c30} 0`, "0 0 5.64"]), "t.rmc6f");
    const plain = readRmc6f(rockSalt(), "p.rmc6f");
    for (const k of ["a", "b", "c", "alpha", "beta", "gamma"] as const) expect(turned.cell[k]).toBeCloseTo(plain.cell[k], 9);
    expect(distances(turned).slice(0, 40)).toEqual(distances(plain).slice(0, 40).map((x) => expect.closeTo(x, 9)));
  });

  it("refuses left-handed lattice vectors (they would be drawn mirrored), damaged atom lines and a wrong atom count", () => {
    expect(() => readRmc6f(rockSalt(["11.28 0 0", "0 5.64 0", "0 0 -5.64"]))).toThrow(/left-handed/);
    expect(() => readRmc6f(rockSalt(undefined, ["    17   Na [1]  0.1  0.2  ****   1 0 0 0"], 17))).toThrow(/could not be read/);
    expect(() => readRmc6f(rockSalt(undefined, ["    17   Na [1]  0.1  0.2  0.3   1 0 0 0  9"], 17))).toThrow(/could not be read/);
    expect(() => readRmc6f(rockSalt(undefined, [], 20))).toThrow(/declares 20 atoms/);
    expect(() => readRmc6f(rockSalt().replace("Cell (Ang/deg):    11.28", "Cell (Ang/deg):    12.28"))).toThrow(/does not agree/);
  });

  it("leaves vacancies out and says how many", () => {
    const s = readRmc6f(rockSalt(undefined, ["    17   Va [1]  0.25  0.25  0.25   1 0 0 0"], 17));
    expect(s.sites.length).toBe(16);
    expect(s.spaceGroupName).toMatch(/1 vacancy left out/);
  });
});
