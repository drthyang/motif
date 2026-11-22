// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { suggestBonds } from "../src/scene/autoBonds";
import { atomsAndBonds } from "../src/scene/bonds";
import { readCif } from "../src/structure/readCif";

const structure = (file: string) => readCif(readFileSync(`examples/${file}`, "utf8"));
const names = (file: string): string[] => suggestBonds(structure(file)).map((r) => `${r.centre}-${r.neighbour}`);

describe("bonds suggested when a file is opened", () => {
  it("cation to anion, first shell only, for the oxide and halide examples", () => {
    expect(names("halite-NaCl_COD-9008678.cif")).toEqual(["Na-Cl"]);
    expect(names("quartz_COD-9009666.cif")).toEqual(["Si-O"]);
    expect(names("MnF2-antiferromagnet_handwritten.mcif")).toEqual(["Mn-F"]);
    expect(names("olivine-FeMg_COD-1541262.cif").sort()).toEqual(["Fe/Mg-O", "Si-O"]);
  });

  it("perovskite: Ti-O is suggested; Sr-O is not, because Sr has twelve oxygens around it", () => {
    expect(names("perovskite-SrTiO3_COD-9006864.cif")).toEqual(["Ti-O"]);
  });

  it("a single element is bonded to itself; an intermetallic gets no suggestion", () => {
    expect(names("silicon_COD-9008565.cif")).toEqual(["Si-Si"]);
    expect(names("CoSn-type-kagome_handwritten.cif")).toEqual([]);
  });

  it("the distance covers the first shell and no more, and neighbours outside the range are added", () => {
    const expected: [string, number, number][] = [
      // file, coordination of the centre, the next distance that must stay outside
      ["halite-NaCl_COD-9008678.cif", 6, 4.8],
      ["quartz_COD-9009666.cif", 4, 3.0],
      ["perovskite-SrTiO3_COD-9006864.cif", 6, 4.3],
      ["silicon_COD-9008565.cif", 4, 3.8],
      ["MnF2-antiferromagnet_handwritten.mcif", 6, 3.3],
    ];
    for (const [file, coordination, next] of expected) {
      const s = structure(file);
      const [rule] = suggestBonds(s);
      expect(rule!.complete).toBe(true);
      expect(rule!.max).toBeLessThan(next);
      const { atoms, bonds } = atomsAndBonds(s, { from: [0, 0, 0], to: [1, 1, 1], boundary: "once" }, [rule!]);
      atoms.forEach((a, i) => {
        if (a.species === rule!.centre && !a.added) expect(bonds.filter((b) => b.i === i || b.j === i).length, `${file} ${a.label}`).toBe(coordination);
      });
    }
  });
});
