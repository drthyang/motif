// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { describe, expect, it } from "vitest";
import { axisLabels, type AxisLabel } from "../src/ui/AnglePlot";

// The plot's axis: 300 units wide, 8 at each side.
const axis = (lo: number, hi: number) => (d: number) => 8 + ((d - lo) / (hi - lo)) * 284;
const width = (l: AxisLabel) => l.text.length * 9.5 * 0.58;
const span = (l: AxisLabel): [number, number] =>
  l.anchor === "start" ? [l.x, l.x + width(l)] : l.anchor === "end" ? [l.x - width(l), l.x] : [l.x - width(l) / 2, l.x + width(l) / 2];

function noOverlap(labels: AxisLabel[]) {
  const spans = labels.map(span).sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < spans.length; k++) expect(spans[k]![0], JSON.stringify(labels)).toBeGreaterThanOrEqual(spans[k - 1]![1]);
}

describe("angle plot axis labels", () => {
  it("bars a degree apart (O–Si–O in quartz) share one range label, and nothing overlaps", () => {
    const labels = axisLabels(94, 125, [108.2, 108.8, 109.2, 110.4], axis(94, 125), 292);
    noOverlap(labels);
    expect(labels.map((l) => l.text)).toEqual(["94°", "108.2–110.4°", "125°"]);
  });

  it("well-spaced bars keep their own labels, with the ends", () => {
    const labels = axisLabels(80, 180, [100, 125, 150], axis(80, 180), 292);
    noOverlap(labels);
    expect(labels.map((l) => l.text)).toEqual(["80°", "100°", "125°", "150°", "180°"]);
  });

  it("an end label gives way to a bar's label near it", () => {
    const labels = axisLabels(84, 115, [84.5, 109.5], axis(84, 115), 292);
    noOverlap(labels);
    expect(labels.map((l) => l.text)).toContain("84.5°");
    expect(labels.map((l) => l.text)).not.toContain("84°");
  });

  it("a crowded axis falls back to one range for all bars", () => {
    const labels = axisLabels(80, 111, [90, 91.3, 92.1, 93.4, 95, 96.2, 97.5, 99, 100.1], axis(80, 111), 292);
    noOverlap(labels);
    expect(labels.filter((l) => l.text.includes("–")).length).toBeLessThanOrEqual(2);
  });
});
