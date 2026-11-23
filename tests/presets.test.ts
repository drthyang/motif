// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { directAxes, openingNumbers, presetView, VIEW_PRESETS, viewFromNumbers } from "../src/render/camera";
import { determinant, type View } from "../src/render/view";
import { mulVec } from "../src/structure/cell";
import { readCif } from "../src/structure/readCif";
import type { Cell, Vec3 } from "../src/structure/types";

const cube: Cell = { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 };
const quartz = readCif(readFileSync("examples/quartz_COD-9009666.cif", "utf8")).cell;
/** Each axis as drawn: screen x (right), y (up), z (towards the viewer). */
const drawn = (cell: Cell, view: View): Vec3[] => directAxes(cell).map((v) => mulVec(view, v));

describe("preset views (hand-worked for a cube, a = x, b = y, c = z)", () => {
  it("every preset is a proper rotation with c straight up the screen, in a cube and in hexagonal quartz", () => {
    for (const cell of [cube, quartz]) {
      for (const p of VIEW_PRESETS) {
        const view = presetView(cell, p.id);
        expect(determinant(view)).toBeCloseTo(1, 12); // never a mirror image
        const c = drawn(cell, view)[2]!;
        expect(c[0]).toBeCloseTo(0, 12);
        expect(c[1]).toBeGreaterThan(0);
      }
    }
  });

  it("standard is the opening view", () => {
    expect(presetView(cube, "standard")).toEqual(viewFromNumbers(directAxes(cube), openingNumbers(directAxes(cube))));
  });

  it("isometric: a, b, c drawn equally long, sqrt(2/3), and 120 degrees apart", () => {
    const [a, b, c] = drawn(cube, presetView(cube, "isometric"));
    for (const v of [a!, b!, c!]) expect(Math.hypot(v[0], v[1])).toBeCloseTo(Math.sqrt(2 / 3), 12);
    const angle = (p: Vec3, q: Vec3): number => (Math.acos((p[0] * q[0] + p[1] * q[1]) / (Math.hypot(p[0], p[1]) * Math.hypot(q[0], q[1]))) * 180) / Math.PI;
    expect(angle(a!, b!)).toBeCloseTo(120, 9);
    expect(angle(b!, c!)).toBeCloseTo(120, 9);
    expect(a![0]).toBeLessThan(0); // a on the left
    expect(b![0]).toBeGreaterThan(0); // b on the right
  });

  it("clinographic: the viewer is at (3 cos e, cos e, sqrt(10) sin e)/sqrt(10) with tan e = 1/6, so c is drawn cos e long, a short and to the left, b long and to the right", () => {
    const e = Math.atan(1 / 6);
    const towards: Vec3 = [(3 * Math.cos(e)) / Math.sqrt(10), Math.cos(e) / Math.sqrt(10), Math.sin(e)];
    const view = presetView(cube, "clinographic");
    for (let i = 0; i < 3; i++) expect(view[2][i]).toBeCloseTo(towards[i]!, 12);
    const [a, b, c] = drawn(cube, view);
    expect(c![1]).toBeCloseTo(Math.cos(e), 12); // 6/sqrt(37)
    expect(a![0]).toBeCloseTo(-1 / Math.sqrt(10), 12);
    expect(b![0]).toBeCloseTo(3 / Math.sqrt(10), 12);
  });

  it("along [110] and [1-10]: that direction points at the viewer, the other lies across the screen", () => {
    const s = Math.SQRT1_2;
    expect(presetView(cube, "110")[2].map((x) => +x.toFixed(12))).toEqual([s, s, 0].map((x) => +x.toFixed(12)));
    expect(presetView(cube, "1-10")[2].map((x) => +x.toFixed(12))).toEqual([s, -s, 0].map((x) => +x.toFixed(12)));
  });
});
