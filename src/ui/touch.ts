// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Two-finger and tap gestures for phones and tablets, as plain arithmetic on screen points (px, y down).
 *
 * Two fingers do three things at once, as in a map app: the change of their distance zooms about their middle,
 * the move of their middle moves the structure, and the turn of the line between them rolls the picture in the
 * screen plane. A pinch always turns the fingers a little, so the roll starts only once the fingers have turned
 * by ROLL_START degrees in one gesture; from then on it follows them exactly.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Degrees the two fingers must turn in one gesture before the picture rolls with them. */
export const ROLL_START = 12;

export interface TwoFingerStep {
  /** Factor of the zoom: the new distance between the fingers over the old (1 when the distance is 0). */
  readonly scale: number;
  /** Screen point the zoom is about: the middle of the fingers before the step. */
  readonly about: Point;
  /** Move of the middle of the fingers, px. */
  readonly dx: number;
  readonly dy: number;
  /** Turn of the line between the fingers, degrees, clockwise on screen positive; in (-180, 180]. */
  readonly turn: number;
}

/** One step of a two-finger gesture in which one finger moved from `before` to `now` and the other stayed at `other`. */
export function twoFingerStep(before: Point, now: Point, other: Point): TwoFingerStep {
  const was = Math.hypot(before.x - other.x, before.y - other.y);
  const is = Math.hypot(now.x - other.x, now.y - other.y);
  let turn = ((Math.atan2(now.y - other.y, now.x - other.x) - Math.atan2(before.y - other.y, before.x - other.x)) * 180) / Math.PI;
  if (turn > 180) turn -= 360;
  if (turn <= -180) turn += 360;
  return {
    scale: was > 0 && is > 0 ? is / was : 1,
    about: { x: (before.x + other.x) / 2, y: (before.y + other.y) / 2 },
    dx: (now.x - before.x) / 2,
    dy: (now.y - before.y) / 2,
    turn,
  };
}

/**
 * The roll to apply for a step, given the turn gathered so far in this gesture (before the step). Below
 * ROLL_START nothing rolls; the step that crosses it rolls by the whole turn gathered, so the picture catches up
 * with the fingers; after that every step rolls by its own turn.
 */
export function rollFor(gathered: number, turn: number): number {
  const total = gathered + turn;
  if (Math.abs(gathered) >= ROLL_START) return turn;
  return Math.abs(total) >= ROLL_START ? total : 0;
}

/** Longest press, ms, and largest move, px, that still count as a tap; longest gap, ms, between the taps of a double tap. */
export const TAP_MS = 300;
export const TAP_MOVE = 10;
export const DOUBLE_TAP_MS = 320;

/** A finished touch: where it went down and came up, and when. */
export interface Touch {
  readonly down: Point;
  readonly up: Point;
  readonly downAt: number;
  readonly upAt: number;
}

export const isTap = (t: Touch): boolean => t.upAt - t.downAt <= TAP_MS && Math.hypot(t.up.x - t.down.x, t.up.y - t.down.y) <= TAP_MOVE;

/** Two touches make a double tap: both taps, the second soon after the first and near it. */
export function isDoubleTap(first: Touch | null, second: Touch): boolean {
  if (!first || !isTap(first) || !isTap(second)) return false;
  return second.downAt - first.upAt <= DOUBLE_TAP_MS && Math.hypot(second.down.x - first.down.x, second.down.y - first.down.y) <= 4 * TAP_MOVE;
}
