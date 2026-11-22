// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  between, directAxes, directionVector, fromBehind, lowIndexDirections, nearestDirection, numbersFromView, readView, rolled, snapTo,
  towardsViewer, viewAlong, viewFromNumbers, writeDirection, writeView, type Axis,
} from "../src/render/camera";
import { DEFAULT_VIEW, determinant, dragView, viewWithAxisUp, type View } from "../src/render/view";
import { fractionalToCartesian, mulVec } from "../src/structure/cell";
import { readCif } from "../src/structure/readCif";
import type { Vec3 } from "../src/structure/types";

const cell = (file: string) => readCif(readFileSync(`examples/${file}`, "utf8")).cell;
const quartz = cell("quartz_COD-9009666.cif"); // hexagonal
const mono = { a: 9.35, b: 5.71, c: 4.93, alpha: 90, beta: 105, gamma: 90 }; // a monoclinic cell
const same = (p: View, q: View, digits = 9): void => {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(p[i]![j]).toBeCloseTo(q[i]![j]!, digits);
};
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a: Vec3, b: Vec3): number => (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (Math.hypot(...a) * Math.hypot(...b))))) * 180) / Math.PI;

describe("the view as four numbers", () => {
  it("with roll 0 it is the earlier 'axis up, turn, tilt' view; the default is c up, turn 18, tilt 12", () => {
    for (const c of [quartz, mono]) {
      const axes = directAxes(c);
      for (const up of [0, 1, 2] as Axis[]) same(viewFromNumbers(axes, { up, turn: 37, tilt: -22, roll: 0 }), viewWithAxisUp(axes, up, 37, -22));
    }
    const n = numbersFromView(directAxes(cell("halite-NaCl_COD-9008678.cif")), DEFAULT_VIEW, 2);
    expect([n.turn, n.tilt, n.roll].map((x) => +x.toFixed(6))).toEqual([18, 12, 0]);
  });

  it("every view has numbers, and the numbers give the view back: any up axis, any cell, after any drag", () => {
    for (const c of [quartz, mono]) {
      const axes = directAxes(c);
      let view = DEFAULT_VIEW;
      for (let k = 0; k < 40; k++) {
        view = dragView(view, 0.7 + 0.13 * k, -0.4 + 0.07 * k);
        for (const up of [0, 1, 2] as Axis[]) {
          const n = numbersFromView(axes, view, up);
          expect(Math.abs(n.tilt)).toBeLessThanOrEqual(90);
          same(viewFromNumbers(axes, n), view);
        }
      }
    }
  });

  it("the meaning of the numbers: roll 0 keeps the up axis vertical; turn brings the front to the right; tilt looks from above; roll is anticlockwise", () => {
    const axes = directAxes(quartz);
    const c = axes[2];
    const flat = viewFromNumbers(axes, { up: 2, turn: 40, tilt: 25, roll: 0 });
    expect(mulVec(flat, c)[0]).toBeCloseTo(0, 12); // c has no sideways part on screen
    expect(mulVec(flat, c)[1]).toBeGreaterThan(0);
    expect(mulVec(flat, c)[2]).toBeGreaterThan(0); // tilt > 0: the up axis leans towards the viewer
    // A point at the front of the structure moves right when turn grows.
    const front = towardsViewer(viewFromNumbers(axes, { up: 2, turn: 0, tilt: 0, roll: 0 }));
    expect(mulVec(viewFromNumbers(axes, { up: 2, turn: 10, tilt: 0, roll: 0 }), front)[0]).toBeGreaterThan(0);
    // Roll 30: the up axis, vertical before, now points up and to the left (anticlockwise by 30 degrees).
    const r = mulVec(viewFromNumbers(axes, { up: 2, turn: 40, tilt: 0, roll: 30 }), c);
    expect((Math.atan2(r[1], r[0]) * 180) / Math.PI).toBeCloseTo(120, 9);
  });

  it("looking exactly along the up axis is reported as tilt 90 with all the rotation in turn", () => {
    const axes = directAxes(quartz);
    const view = viewFromNumbers(axes, { up: 2, turn: 25, tilt: 90, roll: 40 });
    const n = numbersFromView(axes, view, 2);
    expect(n.tilt).toBe(90);
    expect(n.roll).toBe(0);
    same(viewFromNumbers(axes, n), view);
  });

  it("is written and read back as one line", () => {
    const n = { up: 1 as Axis, turn: 23.4, tilt: -11, roll: 5.5 };
    expect(writeView(n)).toBe("b up · turn 23.4° · tilt -11.0° · roll 5.5°");
    expect(readView(writeView(n))).toEqual(n);
    expect(readView("c up, turn 10, tilt 5")).toEqual({ up: 2, turn: 10, tilt: 5, roll: 0 });
    expect(readView("turn 10 tilt 5")).toBeNull(); // no up axis
    expect(readView("c up turn 10 tilt 120")).toBeNull(); // tilt out of range
  });
});

describe("views along crystal directions", () => {
  it("[u v w] is the lattice vector u a + v b + w c; the normal to (h k l) is perpendicular to the lattice vectors lying in that plane", () => {
    for (const c of [quartz, mono]) {
      const v = directionVector(c, { kind: "uvw", indices: [1, 2, -1] });
      const lattice = fractionalToCartesian(c, [1, 2, -1]);
      expect(angle(v, lattice)).toBeCloseTo(0, 6);
      // (1 2 -1) holds the lattice vectors [2 -1 0] and [1 0 1] (h u + k v + l w = 0).
      const n = directionVector(c, { kind: "hkl", indices: [1, 2, -1] });
      expect(dot(n, fractionalToCartesian(c, [2, -1, 0]))).toBeCloseTo(0, 9);
      expect(dot(n, fractionalToCartesian(c, [1, 0, 1]))).toBeCloseTo(0, 9);
      expect(dot(n, fractionalToCartesian(c, [1, 0, 0]))).toBeGreaterThan(0); // on the +a side for h > 0
    }
  });

  it("hexagonal cell: a* is 30 degrees from a, and the normal to (1 0 0) is parallel to [2 1 0]", () => {
    const a = directionVector(quartz, { kind: "uvw", indices: [1, 0, 0] });
    const aStar = directionVector(quartz, { kind: "hkl", indices: [1, 0, 0] });
    expect(angle(a, aStar)).toBeCloseTo(30, 9);
    expect(angle(aStar, directionVector(quartz, { kind: "uvw", indices: [2, 1, 0] }))).toBeCloseTo(0, 5); // acos is blunt near 0
  });

  it("viewAlong: the direction points straight at the viewer, the up hint is vertical, and the view is a proper rotation", () => {
    for (const c of [quartz, mono]) {
      const towards = directionVector(c, { kind: "uvw", indices: [1, 1, 0] });
      const up = directionVector(c, { kind: "uvw", indices: [0, 0, 1] });
      const view = viewAlong(towards, up)!;
      const t = mulVec(view, towards);
      expect([t[0], t[1], t[2]].map((x) => +x.toFixed(9) + 0)).toEqual([0, 0, 1]);
      const u = mulVec(view, up);
      expect(u[0]).toBeCloseTo(0, 9);
      expect(u[1]).toBeGreaterThan(0);
      expect(determinant(view)).toBeCloseTo(1, 12);
      // Every lattice point along that direction lands on one screen point: columns of atoms superimpose.
      const [p, q] = [mulVec(view, fractionalToCartesian(c, [0.3, 0.1, 0.2])), mulVec(view, fractionalToCartesian(c, [1.3, 1.1, 0.2]))];
      expect(p[0]).toBeCloseTo(q[0], 9);
      expect(p[1]).toBeCloseTo(q[1], 9);
    }
    expect(viewAlong([0, 0, 1], [0, 0, 2])).toBeNull(); // an up hint along the line of sight says nothing
  });

  it("names the nearest low-index direction and how far off the view is", () => {
    const axes = directAxes(quartz);
    const along = viewAlong(directionVector(quartz, { kind: "uvw", indices: [0, 0, 1] }), axes[0])!;
    const exact = nearestDirection(quartz, along);
    expect(writeDirection(exact.direction)).toBe("[001]");
    expect(exact.angle).toBeCloseTo(0, 6);
    const off = nearestDirection(quartz, viewFromNumbers(axes, { up: 2, turn: 0, tilt: 87, roll: 0 }));
    expect(writeDirection(off.direction)).toBe("[001]");
    expect(off.angle).toBeCloseTo(3, 6);
    // From the other side it is the opposite direction.
    expect(writeDirection(nearestDirection(quartz, fromBehind(along)).direction)).toBe("[0 0 -1]");
    // The simplest name is used when a lattice vector and a plane normal coincide (c and c* in a hexagonal cell).
    expect(lowIndexDirections()[0]!.kind).toBe("uvw");
  });
});

describe("snapping, turning between views", () => {
  it("snapping brings the direction exactly onto the line of sight by the smallest turn", () => {
    const axes = directAxes(mono);
    const target = directionVector(mono, { kind: "uvw", indices: [1, 0, 1] });
    const near = dragView(viewAlong(target, axes[1])!, 0.04, -0.03); // a couple of degrees off
    const before = angle(towardsViewer(near), target);
    expect(before).toBeGreaterThan(1);
    const snapped = snapTo(near, target);
    expect(angle(towardsViewer(snapped), target)).toBeCloseTo(0, 6);
    expect(determinant(snapped)).toBeCloseTo(1, 12);
    // The whole view turned by just that angle: no extra roll.
    const r = mulVec(snapped, [0, 0, 0]);
    expect(r).toEqual([0, 0, 0]);
    const trace = [0, 1, 2].reduce((s, i) => s + [0, 1, 2].reduce((t, k) => t + snapped[i]![k]! * near[i]![k]!, 0), 0);
    expect((Math.acos((trace - 1) / 2) * 180) / Math.PI).toBeCloseTo(before, 6);
  });

  it("the turn between two views starts at one, ends at the other, and passes through proper rotations at an even rate", () => {
    const from = DEFAULT_VIEW;
    const to = dragView(dragView(DEFAULT_VIEW, 1.9, 0.6), -0.3, 1.1);
    same(between(from, to, 0), from);
    same(between(from, to, 1), to);
    const half = between(from, to, 0.5);
    expect(determinant(half)).toBeCloseTo(1, 12);
    same(between(half, to, 1), to);
    same(between(from, half, 1), between(half, to, 0)); // half way from either end
    same(between(from, fromBehind(from), 1), fromBehind(from), 7); // a half turn works too
    same(rolled(rolled(from, 90), -90), from);
  });
});
