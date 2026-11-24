// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { describe, expect, it } from "vitest";
import { LABEL_GAP, MIN_GAP, rulerTicks, sizeLabel } from "../src/ui/ruler";

describe("rulers beside the figure", () => {
  it("cm: mm ticks when there is room, a label every cm, both ends marked", () => {
    const ticks = rulerTicks(8.9, "cm", 60); // 60 screen px per cm: 6 px per mm
    expect(ticks[0]).toEqual({ at: 0, major: true, label: "0" });
    expect(ticks.filter((t) => t.major).map((t) => t.label)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8"]);
    expect(ticks.length).toBe(90); // 0, 0.1, ... 8.9
    expect(ticks[ticks.length - 1]!.at).toBe(8.9);
  });

  it("the end of an odd length is marked without a label", () => {
    const ticks = rulerTicks(6.675, "cm", 60);
    expect(ticks[ticks.length - 1]).toEqual({ at: 6.675, major: false });
  });

  it("less room: coarser ticks and labels, never closer than the gaps allow", () => {
    for (const [total, unit, k] of [[18.3, "cm", 20], [3.33, "in", 50], [1440, "px", 0.6], [1440, "px", 0.25], [7, "in", 400]] as const) {
      const ticks = rulerTicks(total, unit, k).filter((t, i, all) => i < all.length - 1 || Number.isInteger(Number((t.at * 1000).toFixed(3))));
      const gaps = ticks.slice(1).map((t, i) => (t.at - ticks[i]!.at) * k);
      expect(Math.min(...gaps.slice(0, -1))).toBeGreaterThanOrEqual(MIN_GAP - 1e-9);
      const labels = ticks.filter((t) => t.major);
      const labelGaps = labels.slice(1).map((t, i) => (t.at - labels[i]!.at) * k);
      if (labelGaps.length) expect(Math.min(...labelGaps)).toBeGreaterThanOrEqual(LABEL_GAP - 1e-9);
    }
  });

  it("inches: eighths with room, labels on whole inches", () => {
    const ticks = rulerTicks(3.33, "in", 100);
    expect(ticks[1]!.at).toBe(0.125);
    expect(ticks.filter((t) => t.major).map((t) => t.label)).toEqual(["0", "1", "2", "3"]);
  });

  it("the size where the rulers meet", () => {
    expect(sizeLabel(8.9, 6.675, "cm")).toBe("8.9 × 6.68 cm");
    expect(sizeLabel(1440, 1100, "px")).toBe("1440 × 1100 px");
  });

  it("nothing for an empty ruler", () => {
    expect(rulerTicks(0, "cm", 50)).toEqual([]);
    expect(rulerTicks(5, "cm", 0)).toEqual([]);
  });
});
