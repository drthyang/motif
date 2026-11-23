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

describe("folding an RMC configuration into one cell", () => {
  /**
   * A 2 x 2 x 1 supercell (a = 8 A, c = 4 A) of a two-site cell: site 1 at the corner (0, 0, 0), site 2 at
   * (1/2, 1/2, 1/2). Each copy of site 1 is moved by +-0.01 of the small cell along x and y, so some copies sit
   * just below 1 (that is, near 0 from the other side); the copies of site 2 move by +-0.02 along z. Site 2 holds
   * Na in three copies and K in one.
   */
  function folded(withSites = true): string {
    const lines: string[] = [];
    let n = 0;
    const shifts = [[0.01, 0.01, 0], [-0.01, 0.01, 0], [0.01, -0.01, 0], [-0.01, -0.01, 0]];
    let k = 0;
    for (const i of [0, 1]) for (const j of [0, 1]) {
      const s = shifts[k]!;
      const corner = [(i + s[0]! + 1) % 2, (j + s[1]! + 1) % 2, 0].map((x, axis) => (axis < 2 ? x / 2 : x));
      n += 1;
      lines.push(`${n} Cl [1] ${corner.map((x) => x.toFixed(6)).join(" ")}${withSites ? ` 1 ${i} ${j} 0` : ""}`);
      const element = k === 3 ? "K" : "Na";
      const centre = [(i + 0.5) / 2, (j + 0.5) / 2, 0.5 + (k % 2 ? 0.02 : -0.02)];
      n += 1;
      lines.push(`${n} ${element} [2] ${centre.map((x) => x.toFixed(6)).join(" ")}${withSites ? ` 2 ${i} ${j} 0` : ""}`);
      k += 1;
    }
    return ["(Version 6f format configuration file)", `Number of atoms: ${n}`, "Supercell dimensions: 2 2 1", "Lattice vectors (Ang):", " 8 0 0", " 0 8 0", " 0 0 4", "Atoms:", ...lines].join("\n");
  }

  it("each site is the average of its copies, a corner site lands at 0 (not 1/2), and shares become occupancies", () => {
    const s = readRmc6f(folded(), "f.rmc6f", { fold: true });
    expect([s.cell.a, s.cell.b, s.cell.c]).toEqual([4, 4, 4]);
    expect(s.rmc).toMatchObject({ folded: true, grouping: "site numbers", supercell: [2, 2, 1] });
    const cl = s.sites.find((x) => x.element === "Cl")!;
    // The +-0.01 shifts cancel: the corner, whichever side of 0 its copies sit.
    for (const v of cl.frac) expect(Math.min(v, 1 - v)).toBeCloseTo(0, 9);
    expect(cl.occupancy).toBe(1);
    const na = s.sites.find((x) => x.element === "Na")!;
    const kk = s.sites.find((x) => x.element === "K")!;
    expect(na.frac.map((v) => +v.toFixed(9))).toEqual([0.5, 0.5, 0.5]);
    expect(kk.frac).toEqual(na.frac);
    expect([na.occupancy, kk.occupancy]).toEqual([0.75, 0.25]);
    // The shared site is one atom with two components (a pie sphere).
    const atoms = expandToUnitCell(s).atoms;
    expect(atoms.length).toBe(2);
    expect(atoms.find((a) => a.components.length === 2)!.species).toBe("Na/K");
    // Spread: the corner copies are 0.01 x 4 x sqrt(2) = 0.0566 A from the average, the others 0.02 x 4 = 0.08 A.
    expect(s.rmc!.largestSpread).toBeCloseTo(0.08, 6);
  });

  it("without site numbers the copies are grouped by distance, with the same result", () => {
    const bySite = readRmc6f(folded(true), "f.rmc6f", { fold: true });
    const byDistance = readRmc6f(folded(false), "f.rmc6f", { fold: true });
    expect(byDistance.rmc!.grouping).toBe("distance");
    const key = (s: Structure) => s.sites.map((x) => `${x.element} ${x.frac.map((v) => Math.min(v, 1 - v).toFixed(6)).join(",")} ${x.occupancy}`).sort();
    expect(key(byDistance)).toEqual(key(bySite));
  });

  it("the whole supercell is still read as P1 when not folded", () => {
    const s = readRmc6f(folded(), "f.rmc6f");
    expect(s.sites.length).toBe(8);
    expect(s.rmc).toMatchObject({ folded: false });
  });
});
