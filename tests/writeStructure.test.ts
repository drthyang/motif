// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Saving a structure and setting moments by hand. Each saved format is read back with MOTIF's readers (checked
 * against gemmi through the CIF) and must give the same unit cell; the moment directions are checked against hand
 * calculations, in a cubic and a hexagonal cell.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fractionalToCartesian } from "../src/structure/cell";
import { expandToUnitCell } from "../src/structure/expand";
import { cellContents, momentAlong, withHandMoments } from "../src/structure/handMoments";
import { readCif } from "../src/structure/readCif";
import { readStructure } from "../src/structure/readStructure";
import type { Structure } from "../src/structure/types";
import { writeStructure } from "../src/structure/writeStructure";

const quartz = readCif(readFileSync("examples/quartz_COD-9009666.cif", "utf8"));
const halite = readCif(readFileSync("examples/halite-NaCl_COD-9008678.cif", "utf8"));
const olivine = readCif(readFileSync("examples/olivine-FeMg_COD-1541262.cif", "utf8"));

function cellAtoms(s: Structure): string[] {
  const wrap = (x: number) => {
    const v = ((x % 1) + 1) % 1;
    return v > 1 - 5e-5 ? 0 : v;
  };
  return expandToUnitCell(s).atoms.map((a) => `${a.species} ${a.frac.map((x) => wrap(x).toFixed(4)).join(" ")} ${a.occupancy.toFixed(3)}`).sort();
}

describe("saving a structure: every atom of one cell, read back the same", () => {
  for (const [name, s] of [["quartz", quartz], ["halite", halite]] as const) {
    it(`${name}: CIF, POSCAR and extended XYZ give back the same cell and atoms`, () => {
      const ref = cellAtoms(s);
      for (const [format, file] of [["cif", "x.cif"], ["poscar", "POSCAR"], ["extxyz", "x.extxyz"]] as const) {
        const written = writeStructure(s, format, name);
        const back = readStructure(written.text, file);
        for (const k of ["a", "b", "c", "alpha", "beta", "gamma"] as const) expect(back.cell[k], `${format} ${k}`).toBeCloseTo(s.cell[k], 5);
        expect(cellAtoms(back), format).toEqual(ref);
        expect(written.atoms).toBe(ref.length);
      }
    });
  }

  it("plain XYZ keeps the atoms' distances (it has no cell: it reads back as a molecule)", () => {
    const written = writeStructure(quartz, "xyz", "quartz");
    expect(written.notes.join(" ")).toMatch(/no cell/);
    const back = readStructure(written.text, "q.xyz");
    expect(back.molecule).toBe(true);
    const d = (st: Structure, i: number, j: number) => {
      const [p, q] = [st.sites[i]!, st.sites[j]!].map((x) => fractionalToCartesian(st.cell, x.frac));
      return Math.hypot(p![0] - q![0], p![1] - q![1], p![2] - q![2]);
    };
    // Every distance between two atoms, sorted: the same set whatever order the atoms are listed in.
    const all = (st: Structure) => {
      const out: string[] = [];
      for (let i = 0; i < st.sites.length; i++) for (let j = i + 1; j < st.sites.length; j++) out.push(d(st, i, j).toFixed(5));
      return out.sort();
    };
    expect(all(back)).toEqual(all(cellContents(quartz)));
  });

  it("shared sites: kept in CIF with their occupancies, refused by formats without occupancies", () => {
    expect(cellAtoms(readStructure(writeStructure(olivine, "cif").text, "o.cif"))).toEqual(cellAtoms(olivine));
    expect(() => writeStructure(olivine, "poscar")).toThrow(/ask the user whether to save it as CIF/);
    expect(() => writeStructure(olivine, "xyz")).toThrow(/ask the user whether to save it as CIF/);
  });

  it("says that moments are not written", () => {
    const mnf2 = readCif(readFileSync("examples/MnF2-antiferromagnet_handwritten.mcif", "utf8"));
    expect(writeStructure(mnf2, "cif").notes.join(" ")).toMatch(/moments are not written/);
  });
});

describe("moments by hand", () => {
  it("a direction [u v w] becomes components along the unit vectors of a, b, c (hand calculation)", () => {
    const cubic = { a: 5, b: 5, c: 5, alpha: 90, beta: 90, gamma: 90 };
    expect(momentAlong(cubic, [0, 0, 1], 5)).toEqual([0, 0, 5]);
    const r = momentAlong(cubic, [1, 1, 0], 2);
    expect(r[0]).toBeCloseTo(Math.SQRT2, 12);
    expect(r[1]).toBeCloseTo(Math.SQRT2, 12);
    // Hexagonal (gamma = 120): a + b has the length of a, so along [1 1 0] the moment is 1 along each unit vector.
    const hex = { a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 120 };
    const h = momentAlong(hex, [1, 1, 0], 3);
    expect(h[0]).toBeCloseTo(3, 12);
    expect(h[1]).toBeCloseTo(3, 12);
    expect(h[2]).toBeCloseTo(0, 12);
    expect(momentAlong(hex, [1, 0, 0], 3)).toEqual([3, 0, 0]);
  });

  it("set on the atoms named, by element and position, nothing spread by symmetry; later rules win", () => {
    // Halite: Na at z = 0 and z = 1/2 (four Na in the cell, two in each layer).
    const { structure, counts } = withHandMoments(halite, [
      { element: "Na", along: [0, 0, 1], size: 4 },
      { element: "Na", where: { axis: "c", at: 0.5 }, along: [0, 0, -1], size: 4 },
    ]);
    expect(structure.momentsByHand).toBe(true);
    expect(counts).toEqual([4, 2]);
    const na = expandToUnitCell(structure).atoms.filter((a) => a.species === "Na");
    expect(na.length).toBe(4);
    for (const a of na) expect(a.moment).toEqual(Math.abs(a.frac[2] - 0.5) < 1e-6 ? [0, 0, -4] : [0, 0, 4]);
    expect(expandToUnitCell(structure).atoms.filter((a) => a.species === "Cl").every((a) => a.moment === undefined)).toBe(true);
  });

  it("refuses what it cannot do, saying why", () => {
    expect(() => withHandMoments(halite, [{ element: "Mn", along: [0, 0, 1], size: 4 }])).toThrow(/no Mn/);
    expect(() => withHandMoments(halite, [{ element: "Na", where: { axis: "c", at: 0.25 }, along: [0, 0, 1], size: 4 }])).toThrow(/matches no atom/);
    expect(() => withHandMoments(halite, [{ element: "Na", along: [0, 0, 0], size: 4 }])).toThrow(/direction/);
    expect(() => withHandMoments(halite, [{ element: "Na", along: [0, 0, 1], size: 40 }])).toThrow(/0 to 15/);
  });
});
