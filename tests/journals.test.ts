// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { describe, expect, it } from "vitest";
import { JOURNALS, PARTS, PUBLISHERS, journalsOf, partWidth, journalSize, journalTextPt } from "../src/ui/journals";

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
    // Journals that often print crystal structures.
    expect(["ncomms-1", "ncomms-2"].map((id) => journalSize(id)!.width)).toEqual([8.8, 18]);
    // Nature Communications and Nature Materials share one template (same sizes, same text).
    expect(journalSize("ncomms-1")!.journal).toBe("Nature Communications, Nature Materials, Nature Physics");
    expect(["rsc-1", "rsc-2"].map((id) => journalSize(id)!.width)).toEqual([8.3, 17.1]);
    expect(["elsevier-1", "elsevier-1.5", "elsevier-2"].map((id) => journalSize(id)!.width)).toEqual([9, 14, 19]);
    expect(["jpcm-1", "jpcm-2"].map((id) => journalSize(id)!.width)).toEqual([8.5, 15]);
    // American Mineralogist: 19 and 39 picas (6 picas to the inch).
    expect(pt(journalSize("ammin-1")!) / 12).toBeCloseTo(19, 1);
    expect(pt(journalSize("ammin-2")!) / 12).toBe(39);
    // IUCr: one column, 8.8 cm; capitals 2 mm high, inside the 1.5 to 3 mm asked for.
    expect(journalSize("iucr-1")!.width).toBe(8.8);
    expect(journalTextPt(journalSize("iucr-1")!.of, 0.714)).toBe(8);
    for (const h of [0.65, 0.7, 0.75]) {
      const capitals = ((journalTextPt(journalSize("iucr-1")!.of, h) * h) / 72) * 25.4;
      expect(capitals).toBeGreaterThanOrEqual(1.5);
      expect(capitals).toBeLessThanOrEqual(3);
    }
    // Each template's text is within what its journal allows.
    expect(journalTextPt(journalSize("jpcm-1")!.of, 0.7)).toBeGreaterThanOrEqual(8);
    expect(journalTextPt(journalSize("ammin-1")!.of, 0.7)).toBeGreaterThanOrEqual(8);
    expect(journalTextPt(journalSize("elsevier-1")!.of, 0.7)).toBe(7);
    // Every id is unique, and each size knows its journal.
    const ids = JOURNALS.flatMap((j) => j.sizes.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(journalSize(id)!.of.sizes.some((s) => s.id === id)).toBe(true);
  });

  it("no two templates have the same widths and text: such journals are one template", () => {
    const key = (j: (typeof JOURNALS)[number]) => JSON.stringify([j.sizes.map((s) => [s.width, s.unit]), j.text]);
    const keys = JOURNALS.map(key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("templates are listed by publisher, then journal; every template under exactly one publisher", () => {
    expect(PUBLISHERS[0]).toBe("Springer Nature");
    expect(journalsOf("Springer Nature").map((j) => j.name)).toEqual(["Nature", "Nature Communications, Nature Materials, Nature Physics"]);
    expect(PUBLISHERS.flatMap((p) => journalsOf(p)).length).toBe(JOURNALS.length);
    expect(new Set(PUBLISHERS).size).toBe(PUBLISHERS.length);
  });

  it("a figure can take the whole width, a half or a third", () => {
    expect(PARTS.map((p) => p.id)).toEqual(["1", "1/2", "1/3"]);
    expect(partWidth(8.9, "1")).toBe(8.9);
    expect(partWidth(8.9, "1/2")).toBe(4.45);
    expect(partWidth(18.3, "1/3")).toBe(6.1);
    expect(partWidth(3.33, "1/3")).toBe(1.11);
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
