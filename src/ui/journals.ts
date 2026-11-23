// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Figure sizes asked for by a few major journals, from their own author pages (read 2026-11-23):
 *
 * - Nature: 89 mm (single column), 120 to 136 mm (one and a half), 183 mm (double); text 5 to 7 pt; lines 0.25
 *   to 1 pt; height at most 170 mm. nature.com, Final submission and the Research figure guide.
 * - Science: 5.7 cm (1 column), 12.1 cm (2), 18.4 cm (3); lettering about 7 pt after reduction, not smaller
 *   than 5 pt, sans serif. science.org, Instructions for preparing an initial manuscript (the user's choice of
 *   2026-11-23, where another Science page gives 3.5, 5.0 and 7.3 in).
 * - Physical Review (APS): a single column 8.5 cm (3 3/8 in), or 1.5 or 2 columns; smallest capitals and numerals
 *   at least 2 mm high; lines at least 0.5 pt. journals.aps.org, Style Basics. APS gives no number for 2 columns:
 *   17.8 cm (7 in) is the REVTeX two-column page width.
 * - ACS journals: single column up to 240 pt (3.33 in), double 300 to 504 pt (4.17 to 7 in); lettering at least
 *   4.5 pt; lines at least 0.5 pt; height at most 660 pt (9.17 in) with the caption. ACS author guidelines (JACS).
 */
export interface JournalSize {
  readonly id: string;
  readonly journal: string;
  readonly label: string;
  /** Width on paper, in `unit`. */
  readonly width: number;
  readonly unit: "cm" | "in";
}

export interface Journal {
  readonly name: string;
  readonly sizes: readonly Omit<JournalSize, "journal">[];
  /** The text size the template sets, in pt, or how to find it from the font. */
  readonly text: { readonly pt: number } | { readonly capitalsMm: number };
  /** What the journal asks of a figure, in a few words, shown with the template. */
  readonly note: string;
}

export const JOURNALS: readonly Journal[] = [
  {
    name: "Nature",
    sizes: [
      { id: "nature-1", label: "single column, 89 mm", width: 8.9, unit: "cm" },
      { id: "nature-1.5", label: "1.5 columns, 120 mm", width: 12, unit: "cm" },
      { id: "nature-2", label: "double column, 183 mm", width: 18.3, unit: "cm" },
    ],
    text: { pt: 7 },
    note: "Nature: text 5 to 7 pt, lines 0.25 to 1 pt, height at most 17 cm.",
  },
  {
    name: "Science",
    sizes: [
      { id: "science-1", label: "1 column, 5.7 cm", width: 5.7, unit: "cm" },
      { id: "science-2", label: "2 columns, 12.1 cm", width: 12.1, unit: "cm" },
      { id: "science-3", label: "3 columns, 18.4 cm", width: 18.4, unit: "cm" },
    ],
    text: { pt: 7 },
    note: "Science: lettering about 7 pt, not smaller than 5 pt, sans serif.",
  },
  {
    name: "Physical Review",
    sizes: [
      { id: "aps-1", label: "1 column, 8.5 cm", width: 8.5, unit: "cm" },
      { id: "aps-2", label: "2 columns, 17.8 cm", width: 17.8, unit: "cm" },
    ],
    text: { capitalsMm: 2 },
    note: "Physical Review: capitals and numerals at least 2 mm high, lines at least 0.5 pt.",
  },
  {
    name: "ACS journals",
    sizes: [
      { id: "acs-1", label: "single column, 3.33 in", width: 3.33, unit: "in" },
      { id: "acs-2", label: "double column, 7 in", width: 7, unit: "in" },
    ],
    text: { pt: 7 },
    note: "ACS: lettering at least 4.5 pt, lines at least 0.5 pt, height at most 9.17 in with the caption.",
  },
];

export const journalSize = (id: string): (JournalSize & { readonly of: Journal }) | undefined => {
  for (const j of JOURNALS) {
    const s = j.sizes.find((x) => x.id === id);
    if (s) return { ...s, journal: j.name, of: j };
  }
  return undefined;
};

/** Points in a millimetre. */
const PT_PER_MM = 72 / 25.4;

/**
 * The text size (pt) a journal's template sets. Where the journal asks for capitals of a given height, the size is
 * that height over the font's cap height (as a fraction of the font size), rounded up to half a point.
 */
export function journalTextPt(journal: Journal, capHeight: number): number {
  if ("pt" in journal.text) return journal.text.pt;
  return Math.ceil(((journal.text.capitalsMm * PT_PER_MM) / capHeight) * 2) / 2;
}
