// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * RMCProfile configuration (.rmc6f, "Version 6f format") -> Structure.
 * The atom-line grammar and header checks are adapted from RMCProfile Workbench (rmc-toolkits,
 * web_app/frontend/src/rmc6f.js), by the same author.
 *
 * An RMC configuration is a supercell with every atom listed, so it is read as P1: the identity is the only
 * symmetry operation and each atom is its own site. Fractional coordinates are along the file's lattice
 * vectors; MOTIF rebuilds the cell from their lengths and angles (its own axes: a along x, b in the xy plane),
 * which is the same crystal turned rigidly. Lattice vectors that form a left-handed set are refused, because
 * that rebuild would draw the configuration mirrored. A file that does not read cleanly (an atom line that fits
 * no layout, a non-finite coordinate, fewer atoms than the header declares) is refused rather than drawn with
 * atoms missing. Vacancies (element "Va") are left out and counted.
 */

import { elementFromLetters } from "./elements";
import { orthogonalizationMatrix } from "./cell";
import { parseSymmetryOperation } from "./symmetry";
import type { Cell, Site, Structure } from "./types";

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/;
const NON_FINITE_RE = /^(?:[+-]?(?:nan|inf|infinity)|\*+)$/i;
const INTEGER_RE = /^[+-]?\d+$/;
const LINE_BREAK = /\r\n|\r|\n/;
/** A lattice whose volume is below this fraction of |a||b||c| is singular (as in RMCProfile Workbench). */
const SINGULAR_CELL_RATIO = 1e-8;
/** The header's "Cell" line and the lattice vectors must agree to this (angstrom, degrees). */
const CELL_TOLERANCE = 1e-3;

/** A number token, Fortran-aware (0.2D+02 is 20); NaN for an explicit non-finite token; null otherwise. */
function fortranNumber(token: string): number | null {
  if (NUMBER_RE.test(token)) return Number(token.replace(/[dD]/, "e"));
  if (NON_FINITE_RE.test(token)) return NaN;
  return null;
}

/** True for text that looks like an RMCProfile configuration (by its first line or its sections). */
export function isRmc6f(text: string, fileName = ""): boolean {
  return /\.rmc6f$/i.test(fileName) || /\(Version 6f format configuration file\)/i.test(text.slice(0, 200));
}

type AtomLine =
  | { kind: "atom"; element: string; frac: [number, number, number]; site: number | null; cellIndex: [number, number, number] | null }
  | { kind: "nonFinite" }
  | { kind: "invalid" };

/** One atom line: `id element [label] x y z [ref i j k]` (the grammar of RMCProfile Workbench). */
function atomLine(parts: string[], supercell: readonly number[] | null): AtomLine {
  const invalid: AtomLine = { kind: "invalid" };
  if (parts.length < 5 || !INTEGER_RE.test(parts[0]!) || Number(parts[0]) < 0 || !/^[A-Za-z]/.test(parts[1]!)) return invalid;
  const element = parts[1]!.charAt(0).toUpperCase() + parts[1]!.slice(1).toLowerCase();
  let index = 2;
  if (parts[index]!.startsWith("[")) {
    let closed = false;
    while (index < parts.length) {
      const token = parts[index++]!;
      if (token.endsWith("]")) {
        closed = true;
        break;
      }
    }
    if (!closed) return invalid;
  } else if (fortranNumber(parts[index]!) === null) {
    index += 1; // a one-word label
  }
  const data = parts.slice(index);
  if (data.length !== 3 && data.length !== 7) return invalid;
  const coords = data.slice(0, 3).map(fortranNumber);
  if (coords.some((v) => v === null)) return invalid;
  let site: number | null = null;
  let cellIndex: [number, number, number] | null = null;
  if (data.length === 7) {
    const ints = data.slice(3).map((t) => (INTEGER_RE.test(t) ? Number(t) : null));
    site = ints[0] ?? null;
    cellIndex = [ints[1]!, ints[2]!, ints[3]!].map(Number) as [number, number, number];
    if (ints[0] === null || ints[0]! < 1) return invalid;
    for (let axis = 0; axis < 3; axis++) {
      const c = ints[axis + 1];
      if (c === null || c === undefined || c < 0 || (supercell && c >= supercell[axis]!)) return invalid;
    }
  }
  if (!coords.every((v) => Number.isFinite(v))) return { kind: "nonFinite" };
  return { kind: "atom", element, frac: coords as [number, number, number], site, cellIndex };
}

/** Copies of one site closer than this (angstrom, in the folded cell) are grouped when the file gives no site numbers. */
export const FOLD_DISTANCE = 0.5;

/**
 * Read an RMCProfile configuration. `fileName` names the structure when the file's title is blank. With `fold`,
 * the supercell is folded into one cell and each site is the average of its copies (see foldSites).
 */
export function readRmc6f(text: string, fileName = "configuration", options: { fold?: boolean } = {}): Structure {
  const lines = text.split(LINE_BREAK);
  let declared: number | null = null;
  let supercell: number[] | null = null;
  let cellLine: number[] | null = null;
  let latticeRows: string[] | null = null;
  let title = "";
  let atomsAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*atoms\b/i.test(line)) {
      atomsAt = i;
      break;
    }
    const parts = line.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const declaredMatch = /^\s*Number of atoms\s*:\s*(\d+)/i.exec(line);
    if (declaredMatch) declared = Number(declaredMatch[1]);
    else if (parts[0] === "Supercell") supercell = parts.slice(-3).map((t) => fortranNumber(t) ?? NaN);
    else if (parts[0] === "Lattice") latticeRows = [lines[i + 1] ?? "", lines[i + 2] ?? "", lines[i + 3] ?? ""];
    else if (parts[0] === "Cell") cellLine = parts.slice(-6).map((t) => fortranNumber(t) ?? NaN);
    // Titles are often padded with NUL characters; control characters are dropped.
    // eslint-disable-next-line no-control-regex
    else if (/^\s*Metadata title\s*:/i.test(line)) title = line.replace(/^\s*Metadata title\s*:/i, "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  }
  if (atomsAt < 0) throw new Error("This RMCProfile file has no atom list (no line starting with \"Atoms:\").");
  if (!supercell || supercell.length !== 3 || !supercell.every((v) => Number.isInteger(v) && v >= 1)) {
    throw new Error("The supercell dimensions must be three positive integers (the \"Supercell dimensions\" line).");
  }
  if (!latticeRows) throw new Error("The file gives no lattice vectors (the \"Lattice vectors (Ang):\" block).");
  const vectors = latticeRows.map((row, k) => {
    const v = row.trim().split(/\s+/).map((t) => fortranNumber(t));
    if (v.length !== 3 || !v.every((x) => x !== null && Number.isFinite(x))) throw new Error(`Lattice vector ${k + 1} must be three finite numbers, got "${row.trim()}".`);
    return v as [number, number, number];
  });
  const [a, b, c] = vectors as [[number, number, number], [number, number, number], [number, number, number]];
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  const norms = Math.hypot(...a) * Math.hypot(...b) * Math.hypot(...c);
  if (!(Math.abs(det) > SINGULAR_CELL_RATIO * norms)) throw new Error("The lattice vectors are singular (zero cell volume).");
  if (det < 0) {
    throw new Error("The lattice vectors form a left-handed set. MOTIF draws only right-handed axes, so this configuration would be drawn mirrored; it is not read.");
  }
  const length = (v: number[]): number => Math.hypot(v[0]!, v[1]!, v[2]!);
  const angle = (u: number[], v: number[]): number => (Math.acos((u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!) / (length(u) * length(v))) * 180) / Math.PI;
  let cell: Cell = { a: length(a), b: length(b), c: length(c), alpha: angle(b, c), beta: angle(a, c), gamma: angle(a, b) };
  if (cellLine && cellLine.length === 6 && cellLine.every(Number.isFinite)) {
    const fromVectors = [cell.a, cell.b, cell.c, cell.alpha, cell.beta, cell.gamma];
    const worst = Math.max(...fromVectors.map((v, k) => Math.abs(v - cellLine![k]!)));
    if (worst > CELL_TOLERANCE * Math.max(1, ...cellLine.map(Math.abs)) && worst > 0.01) {
      throw new Error(`The "Cell" line (${cellLine.join(", ")}) does not agree with the lattice vectors (${fromVectors.map((v) => v.toFixed(4)).join(", ")}).`);
    }
    // They agree: the file's own numbers, free of the rounding in the written vectors.
    const [la, lb, lc, al, be, ga] = cellLine as [number, number, number, number, number, number];
    cell = { a: la, b: lb, c: lc, alpha: al, beta: be, gamma: ga };
  }

  const sites: Site[] = [];
  const parsedAtoms: { element: string; frac: [number, number, number]; site: number | null; cellIndex: [number, number, number] | null }[] = [];
  let vacancies = 0;
  let invalid = 0;
  let nonFinite = 0;
  let firstBad = "";
  for (let i = atomsAt + 1; i < lines.length; i++) {
    const parts = lines[i]!.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const parsed = atomLine(parts, supercell);
    if (parsed.kind !== "atom") {
      if (parsed.kind === "invalid") invalid++;
      else nonFinite++;
      firstBad ||= lines[i]!.trim();
      continue;
    }
    if (parsed.element === "Va") {
      vacancies++;
      parsedAtoms.push({ element: "Va", frac: parsed.frac, site: parsed.site, cellIndex: parsed.cellIndex });
      continue;
    }
    const element = elementFromLetters(parsed.element);
    if (element === undefined || element.length !== parsed.element.length) throw new Error(`"${parsed.element}" (atom ${parts[0]}) is not an element symbol.`);
    sites.push({ label: `${element}${parts[0]}`, element, frac: parsed.frac, occupancy: 1 });
    parsedAtoms.push({ element, frac: parsed.frac, site: parsed.site, cellIndex: parsed.cellIndex });
  }
  if (invalid > 0 || nonFinite > 0) {
    throw new Error(
      `${invalid + nonFinite} atom line${invalid + nonFinite > 1 ? "s" : ""} could not be read${nonFinite ? ` (${nonFinite} with a non-finite coordinate)` : ""}; the first is "${firstBad}". The configuration is not drawn with atoms missing.`,
    );
  }
  if (declared !== null && sites.length + vacancies !== declared) {
    throw new Error(`The header declares ${declared} atoms, but the atom list holds ${sites.length + vacancies}.`);
  }
  if (sites.length === 0) throw new Error("The configuration holds no atoms.");
  const name = title || fileName.replace(/\.rmc6f$/i, "");
  const n = supercell as [number, number, number];
  if (options.fold) {
    // One cell: the supercell's edges divided by its dimensions (rounded to 10 figures, so 52.6983 / 10 reads 5.26983).
    const tidy = (x: number): number => Number(x.toPrecision(10));
    const unit: Cell = { ...cell, a: tidy(cell.a / n[0]), b: tidy(cell.b / n[1]), c: tidy(cell.c / n[2]) };
    const folded = foldSites(parsedAtoms, n, unit);
    return {
      name,
      cell: unit,
      spaceGroupName: `P1 (RMC configuration folded from ${n.join(" × ")} cells, the average of each site)`,
      operations: [parseSymmetryOperation("x,y,z")],
      sites: folded.sites,
      magnetic: false,
      rmc: { supercell: n, folded: true, grouping: folded.grouping, largestSpread: folded.largestSpread },
    };
  }
  return {
    name,
    cell,
    spaceGroupName: `P1 (RMC configuration, ${supercell.join(" × ")} cells${vacancies ? `, ${vacancies} vacanc${vacancies > 1 ? "ies" : "y"} left out` : ""})`,
    operations: [parseSymmetryOperation("x,y,z")],
    sites,
    magnetic: false,
    rmc: { supercell: n, folded: false },
  };
}

/**
 * The supercell folded into one cell. The copies of a site are the atoms with the same site number in the file
 * (the crystallographic site of the unit cell; in a file without site numbers, the atoms within FOLD_DISTANCE of
 * one another in the folded cell).
 *
 * Where the file gives each atom's unit-cell indices (i, j, k), as RMCProfile writes them, an atom's position in
 * its own cell is (supercell fraction x N) - (i, j, k): an atom just below a corner reads -0.002, not 0.998, so the
 * site is simply the plain average of its copies (the user's choice, 2026-11-23). An atom whose cell lies across
 * the supercell's own boundary (cell 0 with x N = 9.98 in a supercell of 10) is taken back by one supercell length.
 * Without cell indices the copies are averaged as RMCProfile Workbench does: the circular mean per axis as a centre,
 * plus the mean offset of the copies from it.
 *
 * Each element at a site gets the share of the copies it holds as its occupancy; vacancies (Va) count in the
 * total, so they leave a vacant share.
 */
export function foldSites(
  atoms: readonly { element: string; frac: readonly number[]; site: number | null; cellIndex?: readonly number[] | null }[],
  supercell: readonly [number, number, number],
  unit: Cell,
): { sites: Site[]; grouping: "site numbers" | "distance"; largestSpread: number } {
  const inCell = (f: readonly number[]): [number, number, number] =>
    [0, 1, 2].map((i) => (((f[i]! * supercell[i]!) % 1) + 1) % 1) as [number, number, number];
  // Position in the atom's own cell, from its cell indices: plain, not wrapped (may lie just outside 0..1, or a
  // whole supercell away when the atom's cell lies across the supercell's boundary; see the average below).
  const inOwnCell = (f: readonly number[], c: readonly number[]): [number, number, number] =>
    [0, 1, 2].map((i) => f[i]! * supercell[i]! - c[i]!) as [number, number, number];
  const m = orthogonalizationMatrix(unit);
  const toCart = (d: readonly number[]): [number, number, number] => [0, 1, 2].map((r) => m[r]![0]! * d[0]! + m[r]![1]! * d[1]! + m[r]![2]! * d[2]!) as [number, number, number];
  const wrapped = (d: number): number => d - Math.round(d);
  const bySiteNumber = atoms.every((a) => a.site !== null);
  const plain = atoms.every((a) => a.cellIndex);
  const groups = new Map<number, { members: [number, number, number][]; elements: Map<string, number> }>();
  const add = (key: number, element: string, f: [number, number, number]): void => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { members: [], elements: new Map() }));
    g.members.push(f);
    g.elements.set(element, (g.elements.get(element) ?? 0) + 1);
  };
  const position = (a: (typeof atoms)[number]): [number, number, number] => (plain ? inOwnCell(a.frac, a.cellIndex!) : inCell(a.frac));
  if (bySiteNumber) {
    for (const a of atoms) add(a.site!, a.element, position(a));
  } else {
    // No site numbers: a copy joins the first group whose first member is within FOLD_DISTANCE (nearest image).
    const firsts: [number, number, number][] = [];
    for (const a of atoms) {
      const f = inCell(a.frac);
      let key = firsts.findIndex((p) => Math.hypot(...toCart([wrapped(f[0] - p[0]), wrapped(f[1] - p[1]), wrapped(f[2] - p[2])])) < FOLD_DISTANCE);
      if (key < 0) {
        key = firsts.length;
        firsts.push(f);
      }
      add(key, a.element, f);
    }
  }
  const sites: Site[] = [];
  let largestSpread = 0;
  for (const [key, g] of [...groups.entries()].sort(([p], [q]) => p - q)) {
    let average: number[];
    let deviations: number[][];
    if (plain && bySiteNumber) {
      // The plain average of the copies' positions in their own cells, each first taken by whole supercell
      // lengths to the image nearest the site's first copy (only an atom across the supercell's boundary moves).
      const first = g.members[0]!;
      const near = g.members.map((f) => f.map((x, i) => x - supercell[i]! * Math.round((x - first[i]!) / supercell[i]!)));
      average = [0, 1, 2].map((i) => near.reduce((sum, f) => sum + f[i]!, 0) / near.length);
      deviations = near.map((f) => f.map((x, i) => x - average[i]!));
    } else {
      const centre = [0, 1, 2].map((i) => {
        const [c, s] = g.members.reduce(([c, s], f) => [c + Math.cos(2 * Math.PI * f[i]!), s + Math.sin(2 * Math.PI * f[i]!)], [0, 0]);
        return Math.atan2(s, c) / (2 * Math.PI);
      });
      const offsets = g.members.map((f) => [0, 1, 2].map((i) => wrapped(f[i]! - centre[i]!)));
      const meanOffset = [0, 1, 2].map((i) => offsets.reduce((sum, d) => sum + d[i]!, 0) / offsets.length);
      average = centre.map((c, i) => c + meanOffset[i]!);
      deviations = offsets.map((d) => d.map((x, i) => x - meanOffset[i]!));
    }
    const mean = average.map((x) => x - Math.floor(x)) as [number, number, number];
    // rms distance of the copies from their average, in angstrom.
    const spread = Math.sqrt(deviations.reduce((sum, d) => sum + Math.hypot(...toCart(d)) ** 2, 0) / deviations.length);
    largestSpread = Math.max(largestSpread, spread);
    const total = g.members.length;
    for (const [element, count] of [...g.elements.entries()].sort(([, p], [, q]) => q - p)) {
      if (element === "Va") continue;
      sites.push({ label: `${element}${bySiteNumber ? key : key + 1}`, element, frac: mean, occupancy: count / total });
    }
  }
  if (sites.length === 0) throw new Error("The folded configuration holds no atoms.");
  return { sites, grouping: bySiteNumber ? "site numbers" : "distance", largestSpread };
}
