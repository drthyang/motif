// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Ticks of the rulers beside the figure on the page. They measure the figure itself: in cm or in when it has a
 * size on paper, otherwise in px of the figure. They are a guide on the page only and never part of a saved figure.
 *
 * The spacing follows the space on screen: minor ticks at least MIN_GAP screen px apart, labelled ticks at least
 * LABEL_GAP apart, on the usual divisions of each unit (mm and cm; eighths, quarters, halves and whole inches;
 * round numbers of px).
 */

export type RulerUnit = "cm" | "in" | "px";

export interface Tick {
  /** Position along the ruler, in the ruler's unit, from 0. */
  readonly at: number;
  /** A labelled tick (longer, with its value). */
  readonly major: boolean;
  readonly label?: string;
}

/** Smallest gap between ticks, and between labels, in screen px. */
export const MIN_GAP = 5;
export const LABEL_GAP = 34;

/** The divisions each unit offers, smallest first. */
const STEPS: Record<RulerUnit, readonly number[]> = {
  cm: [0.1, 0.5, 1, 2, 5, 10, 20, 50],
  in: [0.125, 0.25, 0.5, 1, 2, 5, 10],
  px: [10, 20, 50, 100, 200, 500, 1000, 2000, 5000],
};

/** The labelled divisions: whole cm and whole inches, round numbers of px. */
const MAJORS: Record<RulerUnit, readonly number[]> = {
  cm: [1, 2, 5, 10, 20, 50],
  in: [1, 2, 5, 10],
  px: [50, 100, 200, 500, 1000, 2000, 5000],
};

const label = (value: number): string => String(Number(value.toFixed(3)));

/**
 * The ticks along a ruler `total` units long (the figure's width or height), drawn `screenPerUnit` screen px per
 * unit. Every tick sits on a whole number of minor steps; a tick on a whole number of major steps is labelled.
 * The two ends (0 and `total`) are always among the ticks; the end is labelled only when it is a whole major step.
 */
export function rulerTicks(total: number, unit: RulerUnit, screenPerUnit: number): Tick[] {
  if (!(total > 0) || !(screenPerUnit > 0)) return [];
  const steps = STEPS[unit];
  const minor = steps.find((s) => s * screenPerUnit >= MIN_GAP) ?? steps[steps.length - 1]!;
  const majors = MAJORS[unit];
  const major = majors.find((s) => s >= minor * 2 && s * screenPerUnit >= LABEL_GAP && Number.isInteger(Number((s / minor).toFixed(6)))) ?? majors[majors.length - 1]!;
  const ticks: Tick[] = [];
  const n = Math.floor(total / minor + 1e-9);
  const perMajor = Math.round(major / minor);
  for (let i = 0; i <= n; i++) {
    const at = Number((i * minor).toFixed(6));
    const isMajor = i % perMajor === 0;
    ticks.push(isMajor ? { at, major: true, label: label(at) } : { at, major: false });
  }
  if (Math.abs(ticks[ticks.length - 1]!.at - total) > 1e-6) ticks.push({ at: total, major: false });
  return ticks;
}

/** "8.9 × 6.68 cm", "1440 × 1100 px": the figure's size, as shown where the rulers meet. */
export function sizeLabel(width: number, height: number, unit: RulerUnit): string {
  const n = (v: number) => (unit === "px" ? String(Math.round(v)) : label(Math.round((v + 1e-9) * 100) / 100));
  return `${n(width)} × ${n(height)} ${unit}`;
}
