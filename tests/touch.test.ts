// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { describe, expect, it } from "vitest";
import { isDoubleTap, isTap, ROLL_START, rollFor, twoFingerStep } from "../src/ui/touch";

describe("two-finger gestures", () => {
  const other = { x: 0, y: 0 };

  it("spreading the fingers zooms in, about their middle", () => {
    const s = twoFingerStep({ x: 100, y: 0 }, { x: 200, y: 0 }, other);
    expect(s.scale).toBeCloseTo(2, 12);
    expect(s.about).toEqual({ x: 50, y: 0 });
    expect(s.turn).toBeCloseTo(0, 12);
  });

  it("moving one finger moves the middle by half as much", () => {
    const s = twoFingerStep({ x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 });
    expect([s.dx, s.dy]).toEqual([0, 20]);
  });

  it("turning the fingers clockwise on screen (y down) is a positive turn", () => {
    // From pointing right to pointing down: a quarter turn clockwise as seen on the screen.
    const s = twoFingerStep({ x: 100, y: 0 }, { x: 0, y: 100 }, other);
    expect(s.turn).toBeCloseTo(90, 12);
    expect(s.scale).toBeCloseTo(1, 12);
    // Across the ±180° line the turn stays small.
    const across = twoFingerStep({ x: -100, y: -1 }, { x: -100, y: 1 }, other);
    expect(Math.abs(across.turn)).toBeLessThan(2);
  });

  it("the roll waits for a clear turn, then catches up and follows the fingers", () => {
    expect(rollFor(0, 5)).toBe(0);
    expect(rollFor(5, 5)).toBe(0);
    expect(rollFor(10, 5)).toBe(15); // crosses ROLL_START: the whole turn so far
    expect(rollFor(15, 2)).toBe(2);
    expect(rollFor(-10, -5)).toBe(-15);
    expect(ROLL_START).toBeGreaterThan(5);
  });
});

describe("taps", () => {
  const touch = (x: number, downAt: number, upAt: number, moved = 0) => ({ down: { x, y: 0 }, up: { x: x + moved, y: 0 }, downAt, upAt });

  it("a short, still touch is a tap; a long or moving one is not", () => {
    expect(isTap(touch(0, 0, 120))).toBe(true);
    expect(isTap(touch(0, 0, 600))).toBe(false);
    expect(isTap(touch(0, 0, 120, 30))).toBe(false);
  });

  it("two taps close in time and place are a double tap", () => {
    expect(isDoubleTap(touch(0, 0, 100), touch(5, 250, 330))).toBe(true);
    expect(isDoubleTap(touch(0, 0, 100), touch(5, 900, 980))).toBe(false);
    expect(isDoubleTap(touch(0, 0, 100), touch(300, 250, 330))).toBe(false);
    expect(isDoubleTap(null, touch(0, 0, 100))).toBe(false);
  });
});
