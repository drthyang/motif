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

type AtomLine = { kind: "atom"; element: string; frac: [number, number, number] } | { kind: "nonFinite" } | { kind: "invalid" };

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
  if (data.length === 7) {
    const ints = data.slice(3).map((t) => (INTEGER_RE.test(t) ? Number(t) : null));
    if (ints[0] === null || ints[0]! < 1) return invalid;
    for (let axis = 0; axis < 3; axis++) {
      const c = ints[axis + 1];
      if (c === null || c === undefined || c < 0 || (supercell && c >= supercell[axis]!)) return invalid;
    }
  }
  if (!coords.every((v) => Number.isFinite(v))) return { kind: "nonFinite" };
  return { kind: "atom", element, frac: coords as [number, number, number] };
}

/** Read an RMCProfile configuration. `fileName` names the structure when the file's title is blank. */
export function readRmc6f(text: string, fileName = "configuration"): Structure {
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
      continue;
    }
    const element = elementFromLetters(parsed.element);
    if (element === undefined || element.length !== parsed.element.length) throw new Error(`"${parsed.element}" (atom ${parts[0]}) is not an element symbol.`);
    sites.push({ label: `${element}${parts[0]}`, element, frac: parsed.frac, occupancy: 1 });
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
  return {
    name,
    cell,
    spaceGroupName: `P1 (RMC configuration, ${supercell.join(" × ")} cells${vacancies ? `, ${vacancies} vacanc${vacancies > 1 ? "ies" : "y"} left out` : ""})`,
    operations: [parseSymmetryOperation("x,y,z")],
    sites,
    magnetic: false,
  };
}
