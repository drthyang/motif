// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * A magnetic file's propagation vector and the cell drawn (MATERIA's task, the user's yes 2026-11-25). The fixtures
 * in tests/fixtures/materia-k are a synthetic P1 Fe helix (one Fe atom, a 4 x 4.6 x 5 Å cell, no data), written by
 * MATERIA's own mCIF exporter (web-refinement origin/main 0578a85, with #185) at four k.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCifBlocks } from "../src/structure/cifSyntax";
import { parseChildAxes, parseK, represents } from "../src/structure/propagation";
import { readCif } from "../src/structure/readCif";
import { buildScene } from "../src/scene/scene";

const read = (name: string) => readCif(readFileSync(`tests/fixtures/materia-k/${name}`, "utf8"));
const warned = (name: string) => buildScene(read(name)).warnings.filter((w) => /propagation vector/.test(w));

describe("the propagation vector and the cell drawn", () => {
  it("an incommensurate k in the parent cell: a warning that names k", () => {
    const s = read("helix-incommensurate.mcif");
    expect(s.propagation?.vectors).toEqual([[0, 0, 0.2317]]);
    expect(warned("helix-incommensurate.mcif")).toEqual([
      "The propagation vector k = (0, 0, 0.2317) is not represented by the cell drawn: the moments shown are the amplitudes in the file at one phase, not the modulated structure.",
    ]);
  });

  it("k with one incommensurate component: a warning too", () => {
    expect(warned("helix-mixed.mcif")[0]).toMatch(/k = \(0\.214, 0\.5, 0\.457\)/);
  });

  it("a commensurate k in its magnetic supercell (a,b,4c for k = 1/4): represented, no warning", () => {
    const s = read("helix-quarter.mcif");
    expect(s.propagation?.vectors).toEqual([[0, 0, 0.25]]);
    expect(s.propagation?.unrepresented).toEqual([]);
    expect(warned("helix-quarter.mcif")).toEqual([]);
  });

  it("k = 0: no propagation vector, no warning", () => {
    expect(read("ferro-k0.mcif").propagation).toBeUndefined();
    expect(warned("ferro-k0.mcif")).toEqual([]);
  });

  it("a CIF 2 list such as [0 0 1/4] is one value: the loop's rows stay aligned", () => {
    const { loops } = parseCifBlocks(readFileSync("tests/fixtures/materia-k/helix-quarter.mcif", "utf8"));
    const loop = loops.find((l) => l.headers.includes("_parent_propagation_vector.kxkykz"))!;
    expect(loop.rows).toEqual([["k1", "[0 0 1/4]"]]);
  });

  it("k and the magnetic cell's axes, in the forms files write them", () => {
    expect(parseK("[0 0 0.2317]")).toEqual([0, 0, 0.2317]);
    expect(parseK("(1/2, 0, -1/3)")).toEqual([0.5, 0, -1 / 3]);
    expect(parseK("[0 0]")).toBeNull();
    expect(parseChildAxes("a,b,4c;0,0,0")).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 4]]);
    expect(parseChildAxes("a-b,a+b,2c")).toEqual([[1, -1, 0], [1, 1, 0], [0, 0, 2]]);
    expect(parseChildAxes("1/2a+1/2b,-1/2a+1/2b,c;0,0,0")).toEqual([[0.5, 0.5, 0], [-0.5, 0.5, 0], [0, 0, 1]]);
    // k = (1/2 1/2 0) is represented by the cell (a-b, a+b, c), not by the parent cell; 0.3333 for 1/3 still counts.
    expect(represents([0.5, 0.5, 0], [[1, -1, 0], [1, 1, 0], [0, 0, 1]])).toBe(true);
    expect(represents([0.5, 0.5, 0], [[1, 0, 0], [0, 1, 0], [0, 0, 1]])).toBe(false);
    expect(represents([0, 0, 0.3333], [[1, 0, 0], [0, 1, 0], [0, 0, 3]])).toBe(true);
  });

  it("files with no propagation vector are read as before (the hand-written MnF2, every example)", () => {
    expect(readCif(readFileSync("examples/MnF2-antiferromagnet_handwritten.mcif", "utf8")).propagation).toBeUndefined();
  });
});
