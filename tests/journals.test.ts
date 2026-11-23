// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { describe, expect, it } from "vitest";
import { JOURNALS, journalSize, journalTextPt } from "../src/ui/journals";

const pt = (s: { width: number; unit: "cm" | "in" }) => (s.unit === "in" ? s.width * 72 : (s.width / 2.54) * 72);

describe("journal templates", () => {
  it("widths are those the journals give", () => {
    // Nature: 89, 120 (of 120 to 136) and 183 mm. Science: 5.7, 12.1, 18.4 cm. Physical Review: 8.5 cm. ACS: 240 pt
    // at most for one column, 300 to 504 pt for two.
    expect(journalSize("nature-1")!.width).toBe(8.9);
    expect(journalSize("nature-2")!.width).toBe(18.3);
    const n15 = journalSize("nature-1.5")!.width;
    expect(n15).toBeGreaterThanOrEqual(12);
    expect(n15).toBeLessThanOrEqual(13.6);
    expect(["science-1", "science-2", "science-3"].map((id) => journalSize(id)!.width)).toEqual([5.7, 12.1, 18.4]);
    expect(journalSize("aps-1")!.width).toBe(8.5);
    expect(pt(journalSize("acs-1")!)).toBeLessThanOrEqual(240);
    expect(pt(journalSize("acs-2")!)).toBeGreaterThanOrEqual(300);
    expect(pt(journalSize("acs-2")!)).toBeLessThanOrEqual(504);
    // Every id is unique, and each size knows its journal.
    const ids = JOURNALS.flatMap((j) => j.sizes.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(journalSize(id)!.of.sizes.some((s) => s.id === id)).toBe(true);
  });

  it("text: a size in pt where the journal gives one; capitals 2 mm high in Physical Review, from the font's cap height", () => {
    expect(journalTextPt(journalSize("nature-1")!.of, 0.7)).toBe(7);
    expect(journalTextPt(journalSize("science-1")!.of, 0.7)).toBe(7);
    // 2 mm = 5.669 pt. Cap height 0.714 of the size (Open Sans): 5.669 / 0.714 = 7.94, so 8 pt.
    // Cap height 0.698 (IBM Plex Sans): 8.12, rounded up to half a point, 8.5 pt.
    const aps = journalSize("aps-1")!.of;
    expect(journalTextPt(aps, 0.714)).toBe(8);
    expect(journalTextPt(aps, 0.698)).toBe(8.5);
    // Whatever the font, the capitals are at least 2 mm high.
    for (const h of [0.65, 0.7, 0.72, 0.75]) expect(((journalTextPt(aps, h) * h) / 72) * 25.4).toBeGreaterThanOrEqual(2);
  });
});
