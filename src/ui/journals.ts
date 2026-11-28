// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Figure sizes asked for by major journals, from their own author pages (read 2026-11-23):
 *
 * - Nature: 89 mm (single column), 120 to 136 mm (one and a half), 183 mm (double); text 5 to 7 pt; lines 0.25
 *   to 1 pt; height at most 170 mm. nature.com, Final submission and the Research figure guide.
 * - Science family (Science, Science Advances, Science Translational Medicine, Science Immunology, Science Robotics,
 *   Science Signaling; one template, the user's choice of 2026-11-28, "Yes, all including Sci. Adv."): 5.7 cm
 *   (1 column), 12.1 cm (2), 18.4 cm (3); lettering about 7 pt (2.5 mm high) after reduction, not smaller than 5 pt;
 *   avoid wide variation in type size within a figure. Source: Science's figure instructions as provided by the user,
 *   2026-11-28 (the same numbers science.org's Instructions for preparing an initial manuscript gave on 2026-11-23,
 *   where another Science page gives 3.5, 5.0 and 7.3 in). A 2026 Science Advances figure guide may state other
 *   widths (about 9 cm and 18.4 cm, seen in a search summary only; its PDF refuses automated access and was not
 *   read): the user chose the family rule for Science Advances too.
 * - Physical Review journals (APS; one template, the user's word of 2026-11-28, "physical reviews are the same"):
 *   "Figures should be planned for the column width (8.6 cm or 3 3/8 in.) of the journal. If the detail shown
 *   requires it, 1.5 or 2 columns may be used." Symbol width and lettering height on the page at least 2 mm; lines at
 *   least 0.18 mm (0.5 pt); output preferably 600 dpi or more. Source: APS's figure instructions as provided by the
 *   user, 2026-11-28 (journals.aps.org refuses automated access). The template uses 8.6 cm, the value APS states
 *   (3 3/8 in is 8.57 cm; until 2026-11-28 the template had 8.5 cm). APS gives no number for 1.5 or 2 columns:
 *   17.8 cm (7 in) is the REVTeX two-column page width, and no 1.5-column size is offered. Reviews of Modern Physics
 *   is not included (not a Physical Review journal, and not covered by that text).
 * - ACS journals: single column up to 240 pt (3.33 in), double 300 to 504 pt (4.17 to 7 in); lettering at least
 *   4.5 pt; lines at least 0.5 pt; height at most 660 pt (9.17 in) with the caption. ACS author guidelines: the same
 *   paragraph on the pages of JACS, Inorganic Chemistry and Chemistry of Materials.
 *
 * Journals that often print crystal structures (read 2026-11-23, each from the publisher's own page):
 * - Nature Communications: 88 mm (single column), 180 mm (double); "a clear, sans-serif typeface", no size given.
 *   nature.com/ncomms, How to submit. The template sets 7 pt, the largest size of the Nature-branded journals' guide.
 * - Nature Materials: at most 180 mm wide; 5 to 7 pt sans serif. nature.com/nmat, formatting guide, and its
 *   "Guide to preparing final artwork" for Nature-branded research journals: 88 mm (1 column), 180 mm (2).
 * - Nature Physics: at most 180 mm wide; 5 to 7 pt sans serif. nature.com/nphys, Submission guidelines, "AIP and
 *   formatting" (read 2026-11-23); a Nature-branded research journal, so 88 mm and 180 mm as in that guide.
 * - RSC journals (Dalton Transactions, CrystEngComm, Journal of Materials Chemistry A and C, one shared text):
 *   8.3 cm (single column), 17.1 cm (double); no longer than 23.3 cm. rsc.org, each journal's author guidelines.
 *   No text size for figures; the template sets 7 pt, the size RSC gives for atom labels in chemical structures.
 * - Elsevier journals (Journal of Solid State Chemistry, Journal of Alloys and Compounds): Elsevier's common
 *   artwork sizes, 90 mm (single column), 140 mm (1.5), 190 mm (double); text 7 pt, subscripts at least 6 pt;
 *   lines 0.25 pt recommended, at least 0.1 pt. elsevier.com, Artwork sizing and Artwork FAQ. The journals' own
 *   guides could not be read (refused to automated access); a journal may have its own rules beyond these.
 * - Journal of Physics: Condensed Matter (IOP): 8.5 cm (single column), 15 cm (double); text 8 to 12 pt at the
 *   final size; Times, Helvetica, Courier or Symbol. publishingsupport.iopscience.iop.org, the journal's page.
 * - American Mineralogist (MSA): 19 picas, "approx. 3 inches" (1 column; 3.17 in), up to 39 picas, 6.5 in (2 columns); the smallest
 *   character at least 8 pt; lines thicker than 0.5 pt; sans serif. ammin.msaweb.org, Manuscript information.
 *
 * - IUCr journals (Acta Crystallographica B, C and E, IUCrJ, Journal of Applied Crystallography; one shared text):
 *   "the greatest width including lettering is less than the width of a column in the journal (8.8 cm)"; lettering
 *   "ideally 1.5-3 mm in height" after reduction to one column; no two-column width given. journals.iucr.org, each
 *   journal's Notes for authors, section 4.3 (read in the browser pane, 2026-11-23). The template sets capitals
 *   2 mm high in the chosen font, within that range (8 pt in Open Sans).
 *
 * Not included, because their pages could not be read (refused to automated access): Wiley's journals (Angewandte
 * Chemie, Advanced Materials, Chemistry - A European Journal).
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
  /** Who publishes the journal(s); the page lists publishers first, then their journals. */
  readonly publisher: string;
  /** The journal, or the journals that share these sizes and text (one template, the user's wish). */
  readonly name: string;
  readonly sizes: readonly Omit<JournalSize, "journal">[];
  /** The text size the template sets, in pt, or how to find it from the font. */
  readonly text: { readonly pt: number } | { readonly capitalsMm: number };
  /** What the journal asks of a figure, in a few words, shown with the template. */
  readonly note: string;
  /** Short names that also find the template ("PRL"), beside its name and words that start its name. */
  readonly aliases?: readonly string[];
}

export const JOURNALS: readonly Journal[] = [
  {
    publisher: "Springer Nature",
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
    publisher: "AAAS",
    // The Science family shares Science's figure rules (the user's choice, 2026-11-28); the ids stay Science's.
    name: "Science, Science Advances, Science Translational Medicine, Science Immunology, Science Robotics, Science Signaling",
    sizes: [
      { id: "science-1", label: "1 column, 5.7 cm", width: 5.7, unit: "cm" },
      { id: "science-2", label: "2 columns, 12.1 cm", width: 12.1, unit: "cm" },
      { id: "science-3", label: "3 columns, 18.4 cm", width: 18.4, unit: "cm" },
    ],
    text: { pt: 7 },
    note: "Science family: lettering about 7 pt (2.5 mm high), not smaller than 5 pt; avoid wide variation in type size within a figure.",
  },
  {
    publisher: "American Physical Society",
    // Every Physical Review journal shares these rules (the user, 2026-11-28); the ids stay as they were.
    name: "Physical Review Letters, Physical Review X, PRX Quantum, Physical Review A, B, C, D, E, Physical Review Applied, Physical Review Materials, Physical Review Research",
    sizes: [
      { id: "aps-1", label: "1 column, 8.6 cm", width: 8.6, unit: "cm" },
      { id: "aps-2", label: "2 columns, 17.8 cm", width: 17.8, unit: "cm" },
    ],
    text: { capitalsMm: 2 },
    aliases: ["PRL", "PRA", "PRB", "PRC", "PRD", "PRE"],
    note: "Physical Review journals: lettering and symbols at least 2 mm high, lines at least 0.18 mm (0.5 pt), 600 dpi or more; 1.5 or 2 columns only if the detail needs it.",
  },
  {
    publisher: "American Chemical Society",
    name: "JACS, Inorg. Chem., Chem. Mater.",
    // JACS, Inorganic Chemistry and Chemistry of Materials give the same rules.
    sizes: [
      { id: "acs-1", label: "single column, 3.33 in", width: 3.33, unit: "in" },
      { id: "acs-2", label: "double column, 7 in", width: 7, unit: "in" },
    ],
    text: { pt: 7 },
    note: "ACS (JACS, Inorg. Chem., Chem. Mater.): lettering at least 4.5 pt, lines at least 0.5 pt, height at most 9.17 in with the caption.",
  },
  {
    // One template for the journals whose figures have the same sizes and text (the user's wish, 2026-11-23).
    publisher: "Springer Nature",
    name: "Nature Communications, Nature Materials, Nature Physics",
    sizes: [
      { id: "ncomms-1", label: "single column, 88 mm", width: 8.8, unit: "cm" },
      { id: "ncomms-2", label: "double column, 180 mm", width: 18, unit: "cm" },
    ],
    text: { pt: 7 },
    note: "Nature Communications, Nature Materials, Nature Physics: text 5 to 7 pt sans serif, the same size in every figure; at most 180 mm wide.",
  },
  {
    publisher: "Royal Society of Chemistry",
    name: "Dalton Trans., CrystEngComm, J. Mater. Chem.",
    sizes: [
      { id: "rsc-1", label: "single column, 8.3 cm", width: 8.3, unit: "cm" },
      { id: "rsc-2", label: "double column, 17.1 cm", width: 17.1, unit: "cm" },
    ],
    text: { pt: 7 },
    note: "RSC (Dalton Trans., CrystEngComm, J. Mater. Chem.): text legible (no size given; 7 pt as for atom labels), at most 23.3 cm long.",
  },
  {
    publisher: "Elsevier",
    name: "J. Solid State Chem., J. Alloys Compd.",
    sizes: [
      { id: "elsevier-1", label: "single column, 90 mm", width: 9, unit: "cm" },
      { id: "elsevier-1.5", label: "1.5 columns, 140 mm", width: 14, unit: "cm" },
      { id: "elsevier-2", label: "double column, 190 mm", width: 19, unit: "cm" },
    ],
    text: { pt: 7 },
    note: "Elsevier (J. Solid State Chem., J. Alloys Compd.): text 7 pt, subscripts at least 6 pt, lines 0.25 pt. Elsevier's common sizes; check the journal's own guide.",
  },
  {
    publisher: "IOP Publishing",
    name: "J. Phys.: Condens. Matter",
    sizes: [
      { id: "jpcm-1", label: "single column, 8.5 cm", width: 8.5, unit: "cm" },
      { id: "jpcm-2", label: "double column, 15 cm", width: 15, unit: "cm" },
    ],
    text: { pt: 8 },
    note: "J. Phys.: Condens. Matter (IOP): text 8 to 12 pt at the final size; Times, Helvetica, Courier or Symbol.",
  },
  {
    publisher: "IUCr",
    name: "Acta Cryst., IUCrJ, J. Appl. Cryst.",
    sizes: [{ id: "iucr-1", label: "1 column, 8.8 cm", width: 8.8, unit: "cm" }],
    text: { capitalsMm: 2 },
    note: "IUCr (Acta Cryst., IUCrJ, J. Appl. Cryst.): narrower than one column with lettering; lettering ideally 1.5 to 3 mm high.",
  },
  {
    publisher: "Mineralogical Society of America",
    name: "American Mineralogist",
    sizes: [
      { id: "ammin-1", label: "1 column, 19 picas (3.17 in)", width: 3.17, unit: "in" },
      { id: "ammin-2", label: "2 columns, 39 picas (6.5 in)", width: 6.5, unit: "in" },
    ],
    text: { pt: 8 },
    note: "American Mineralogist: the smallest character at least 8 pt, lines thicker than 0.5 pt, sans serif.",
  },
];

/** A figure can take the whole width of a template, or a half, a third or a quarter of it (one panel in a row of two, three or four). */
export const PARTS = [
  { id: "1", label: "full width", share: 1 },
  { id: "1/2", label: "1/2 width", share: 1 / 2 },
  { id: "1/3", label: "1/3 width", share: 1 / 3 },
  { id: "1/4", label: "1/4 width", share: 1 / 4 },
] as const;
export type PartId = (typeof PARTS)[number]["id"];

/** The width of a share of a template's width, rounded to 0.01 of its unit (cm or in). */
export function partWidth(width: number, part: PartId): number {
  const share = PARTS.find((p) => p.id === part)!.share;
  return Math.round(width * share * 100) / 100;
}

/** The publishers, in the order of JOURNALS, each once. */
export const PUBLISHERS: readonly string[] = [...new Set(JOURNALS.map((j) => j.publisher))];

/** The templates of one publisher. */
export const journalsOf = (publisher: string): readonly Journal[] => JOURNALS.filter((j) => j.publisher === publisher);

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

/**
 * A template from everyday words (the assistant's, or a person's): publisher by name or initials ("APS"), journal by
 * name, column as "one column", "single", "double", "1.5 columns" ..., width as "full", "1/2", "half", "third" or
 * "quarter". Returns the size and share, or a sentence saying what can be given.
 */
export function matchJournal(req: { publisher?: string; journal?: string; column?: string; width?: string }, currentPart: PartId): { id: string; part: PartId } | string {
  const initials = (t: string) => t.split(/[\s,]+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join("").toLowerCase();
  const fit = (have: string, want?: string) => {
    if (!want) return true;
    const w = want.toLowerCase().trim();
    const letters = w.replace(/[^a-z]/g, "");
    // Every word given starts a word of the name, punctuation aside: "Nat. Phys." and "nature phys" find Nature Physics.
    const haveWords = have.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const wantWords = w.split(/[^a-z0-9]+/).filter(Boolean);
    const prefixes = wantWords.length > 0 && wantWords.every((x) => haveWords.some((h) => h.startsWith(x)));
    return have.toLowerCase().includes(w) || (letters.length >= 2 && initials(have) === letters) || prefixes;
  };
  const words: Record<string, number> = { single: 1, one: 1, double: 2, two: 2, three: 3, "one and a half": 1.5 };
  // A number of columns; never the parts of a fraction ("1/2" is a share of the width, not 1 column).
  const columns = (t: string): number | null => {
    const m = /(?<![\d/.])(\d+(?:\.\d+)?|one and a half|single|double|one|two|three)\b(?!\s*\/)/.exec(t.toLowerCase());
    return m ? (words[m[1]!] ?? Number(m[1])) : null;
  };
  const columnFits = (label: string, want?: string) => !want || fit(label, want) || (columns(want) !== null && columns(want) === columns(label));
  const shares: Record<string, PartId> = { full: "1", "1": "1", whole: "1", "1/2": "1/2", half: "1/2", "1/3": "1/3", third: "1/3", "1/4": "1/4", quarter: "1/4" };
  const shareOf = (t?: string): PartId | undefined => (t ? shares[t.toLowerCase().replace(/\b(width|column|columns|of|the|a)\b/g, "").trim()] : undefined);
  // A share written where the column goes ("column: 1/2", "column: half"), with no other width asked for, is the width.
  if (req.column && shareOf(req.column) && shareOf(req.column) !== "1" && (!req.width || shareOf(req.width) === "1")) {
    req = { ...req, width: req.column };
    delete (req as { column?: string }).column;
  }
  // Other names of a publisher: Nature's journals are Springer Nature's.
  if (req.publisher && /^(nature( publishing group| portfolio| research)?|npg)$/i.test(req.publisher.trim())) req = { ...req, publisher: "Springer Nature" };
  const part = req.width ? shareOf(req.width) : currentPart;
  if (!part) return 'width must be "full", "1/2", "1/3" or "1/4".';
  // A journal's name and its publisher are searched together: "Physical Review" given as the publisher still finds it.
  const names = (j: Journal) => [j.publisher, j.name, `${j.publisher} ${j.name}`, ...(j.aliases ?? [])];
  const templates = JOURNALS.filter((j) => names(j).some((n) => fit(n, req.publisher)) && names(j).some((n) => fit(n, req.journal)));
  if (templates.length === 0) return `No journal template matches. Give publisher and journal as one of: ${JOURNALS.map((j) => `"${j.publisher}" / "${j.name}"`).join("; ")}.`;
  const template = templates[0]!;
  const size = template.sizes.find((s) => columnFits(s.label, req.column)) ?? (req.column ? null : template.sizes[0]!);
  if (!size) return `${template.name} has no column "${req.column}". Give column as one of: ${template.sizes.map((s) => `"${s.label.split(",")[0]}"`).join(", ")}.`;
  return { id: size.id, part };
}

/** What a template gives, in words: "Physical Review, 1 column, 8.5 cm, 1/2 width = 4.25 cm". */
export function describeJournal(id: string, part: PartId): string {
  const size = journalSize(id);
  if (!size) return "";
  const base = `${size.journal}, ${size.label}`;
  return part === "1" ? `${base}, full width` : `${base}, ${part} width = ${partWidth(size.width, part)} ${size.unit}`;
}
