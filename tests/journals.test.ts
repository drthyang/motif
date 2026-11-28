// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { describe, expect, it } from "vitest";
import { JOURNALS, PARTS, PUBLISHERS, describeJournal, journalsOf, matchJournal, partWidth, journalSize, journalTextPt } from "../src/ui/journals";

const pt = (s: { width: number; unit: "cm" | "in" }) => (s.unit === "in" ? s.width * 72 : (s.width / 2.54) * 72);

describe("journal templates", () => {
  it("widths are those the journals give", () => {
    // Nature: 89, 120 (of 120 to 136) and 183 mm. Science: 5.7, 12.1, 18.4 cm. Physical Review: 8.6 cm. ACS: 240 pt
    // at most for one column, 300 to 504 pt for two.
    expect(journalSize("nature-1")!.width).toBe(8.9);
    expect(journalSize("nature-2")!.width).toBe(18.3);
    const n15 = journalSize("nature-1.5")!.width;
    expect(n15).toBeGreaterThanOrEqual(12);
    expect(n15).toBeLessThanOrEqual(13.6);
    expect(["science-1", "science-2", "science-3"].map((id) => journalSize(id)!.width)).toEqual([5.7, 12.1, 18.4]);
    expect(journalSize("aps-1")!.width).toBe(8.6);
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
    expect(PARTS.map((p) => p.id)).toEqual(["1", "1/2", "1/3", "1/4"]);
    expect(partWidth(8.9, "1/4")).toBe(2.23);
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

  it("templates found from everyday words, as the assistant or a person says them", () => {
    expect(matchJournal({ publisher: "APS", column: "one column", width: "half" }, "1")).toEqual({ id: "aps-1", part: "1/2" });
    expect(matchJournal({ journal: "Physical Review", column: "1 column", width: "1/2" }, "1")).toEqual({ id: "aps-1", part: "1/2" });
    expect(matchJournal({ journal: "Nature", column: "double" }, "1")).toEqual({ id: "nature-2", part: "1" });
    expect(matchJournal({ journal: "Nature", column: "1.5 columns" }, "1")).toEqual({ id: "nature-1.5", part: "1" });
    expect(matchJournal({ journal: "Nature Physics", width: "quarter" }, "1")).toEqual({ id: "ncomms-1", part: "1/4" });
    expect(matchJournal({ publisher: "ACS", column: "single" }, "1/3")).toEqual({ id: "acs-1", part: "1/3" });
    expect(matchJournal({ journal: "Physical Review", column: "three columns" }, "1")).toMatch(/no column/);
    expect(matchJournal({ journal: "Journal of Nothing" }, "1")).toMatch(/No journal template matches/);
    expect(matchJournal({ journal: "Science", width: "two thirds" }, "1")).toMatch(/width must be/);
    // A share put where the column goes is the width (a model did this); "1/2" is never "1 column".
    expect(matchJournal({ publisher: "APS", journal: "Physical Review", column: "1/2", width: "full" }, "1")).toEqual({ id: "aps-1", part: "1/2" });
    expect(matchJournal({ journal: "Nature", column: "half" }, "1")).toEqual({ id: "nature-1", part: "1/2" });
    expect(matchJournal({ journal: "Physical Review", column: "2/3" }, "1")).toMatch(/no column/);
    // The journal's name given as the publisher (a small model did this).
    expect(matchJournal({ publisher: "Physical Review", column: "one column", width: "half" }, "1")).toEqual({ id: "aps-1", part: "1/2" });
    expect(describeJournal("aps-1", "1/2")).toMatch(/^Physical Review Letters, .*Physical Review Research, 1 column, 8\.6 cm, 1\/2 width = 4\.3 cm$/);
    expect(describeJournal("nature-2", "1")).toBe("Nature, double column, 183 mm, full width");
  });

  it("finds a journal from abbreviations and words that start its name (Nat. Phys., nature phys)", () => {
    for (const journal of ["Nature Physics", "Nat. Phys.", "nature phys", "Nature Phys."]) {
      const found = matchJournal({ journal }, "1");
      expect(typeof found === "string" ? found : describeJournal(found.id, found.part), journal).toMatch(/^Nature Communications, Nature Materials, Nature Physics/);
    }
    for (const publisher of ["Nature Publishing Group", "NPG", "Nature Portfolio"]) {
      const found = matchJournal({ publisher, journal: "Nature Physics" }, "1");
      expect(typeof found === "string" ? found : describeJournal(found.id, found.part), publisher).toMatch(/Nature Physics/);
    }
    const nature = matchJournal({ publisher: "Springer Nature", journal: "Nature" }, "1");
    expect(typeof nature === "string" ? nature : describeJournal(nature.id, nature.part)).toMatch(/^Nature,/);
  });

  it("the Science family shares Science's sizes and text (the user's choice, 2026-11-28)", () => {
    for (const journal of ["Science", "Science Advances", "Sci. Adv.", "Science Translational Medicine", "Science Immunology", "Science Robotics", "Science Signaling"]) {
      const found = matchJournal({ publisher: "AAAS", journal, column: "1 column" }, "1");
      expect(typeof found === "string" ? found : found.id, journal).toBe("science-1");
    }
    const two = matchJournal({ journal: "Science Advances", column: "2 columns" }, "1");
    expect(typeof two === "string" ? two : describeJournal(two.id, two.part)).toMatch(/2 columns, 12\.1 cm, full width$/);
    expect(journalSize("science-1")!.of.note).toMatch(/7 pt.*not smaller than 5 pt.*avoid wide variation in type size/);
  });

  it("every Physical Review journal finds the APS template, 8.6 cm a column as APS states (the user, 2026-11-28)", () => {
    for (const journal of ["Physical Review", "Physical Review Letters", "PRL", "Phys. Rev. Lett.", "Physical Review X", "PRX Quantum", "Physical Review B", "Phys. Rev. B", "Physical Review Materials", "Physical Review Applied", "Physical Review Research", "Physical Review E"]) {
      const found = matchJournal({ journal, column: "1 column" }, "1");
      expect(typeof found === "string" ? found : found.id, journal).toBe("aps-1");
    }
    expect(journalSize("aps-2")!.width).toBe(17.8);
    expect(journalSize("aps-1")!.of.note).toMatch(/2 mm.*0\.18 mm \(0\.5 pt\).*600 dpi/);
  });
});
