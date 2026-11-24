// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * SHELX .res / .ins -> Structure, with the file's symmetry.
 *
 * CELL (wavelength, then a b c alpha beta gamma); LATT n: |n| the lattice centring (1 P, 2 I, 3 R obverse, 4 F,
 * 5 A, 6 B, 7 C), positive when the structure is centrosymmetric (the inversion is then added to every
 * operation); SYMM: the operations besides the identity, as written; SFAC: the elements, in the order the atom
 * lines number them; FVAR: the free variables. An atom line is "name sfac x y z sof ...". A coordinate or sof
 * written as 10 + v is v held fixed; a sof of 10m + p (|m| >= 2) is p x fv(m), and -(10m + p) is p x (1 - fv(m)).
 * Lines ending in "=" continue on the next. Residual peaks (Q1, Q2, ...) and everything after HKLF or END are
 * left out. The operations are the products of SYMM (and the identity), the inversion when centric, and the
 * centring translations; they must close into a group, as for a CIF.
 */

import { elementOf, LINES, words } from "./lattice";
import { composeOperations, operationKey, parseSymmetryOperation } from "./symmetry";
import type { Cell, Site, Structure, SymmetryOperation } from "./types";

export const isShelx = (fileName: string): boolean => /\.(res|ins)$/i.test(fileName);

const CENTRING: Record<number, string[]> = {
  1: [],
  2: ["x+1/2,y+1/2,z+1/2"],
  3: ["x+2/3,y+1/3,z+1/3", "x+1/3,y+2/3,z+2/3"],
  4: ["x,y+1/2,z+1/2", "x+1/2,y,z+1/2", "x+1/2,y+1/2,z"],
  5: ["x,y+1/2,z+1/2"],
  6: ["x+1/2,y,z+1/2"],
  7: ["x+1/2,y+1/2,z"],
};

/** Instructions that are not atoms (the first four letters of the line). */
const COMMANDS = new Set(
  ("TITL CELL ZERR LATT SYMM SFAC DISP UNIT LIST L.S. CGLS PLAN ACTA BOND CONF FMAP WGHT FVAR HKLF END REM MORE TEMP SIZE OMIT EQIV HTAB DFIX DANG " +
    "SADI SIMU DELU RIGU ISOR AFIX PART RESI SAME FLAT CHIV EADP EXYZ HFIX MPLA CONN BIND FREE SHEL BASF TWIN EXTI SWAT SUMP ANIS BUMP DAMP STIR " +
    "MOVE SPEC LAUE ABIN ANSC ANSR NCSY WPDB TIME GRID FRAG FEND DEFS BLOC NEUT ESEL MERG FLAT HOPE BEDE LONE NOTE PRIG XNPD DFIX").split(" "),
);

/** v as a coordinate: 10 + v is v held fixed. */
const coordinate = (v: number): number => (v > 5 ? v - 10 : v < -5 ? v + 10 : v);

export function readShelx(text: string, fileName = "structure.res"): Structure {
  // Join continuation lines (ending in "=").
  const raw = text.split(LINES);
  const lines: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i]!;
    while (/=\s*$/.test(line) && i + 1 < raw.length) line = line.replace(/=\s*$/, " ") + raw[++i]!;
    lines.push(line);
  }
  let title = "";
  let cell: Cell | null = null;
  let latt = 1;
  const symm: string[] = [];
  const sfac: string[] = [];
  // FVAR: the overall scale, then free variables 2, 3, ...; fv(m) is the m-th value.
  const fvar: number[] = [];
  const sites: Site[] = [];
  for (const line of lines) {
    const w = words(line);
    if (w.length === 0) continue;
    const key = w[0]!.toUpperCase().slice(0, 4);
    if (key === "HKLF" || key === "END") break;
    if (key === "TITL") title = line.trim().slice(4).trim();
    else if (key === "CELL") {
      const v = w.slice(1).map(Number);
      if (v.length < 7 || !v.every(Number.isFinite)) throw new Error("CELL must give the wavelength and six cell parameters.");
      cell = { a: v[1]!, b: v[2]!, c: v[3]!, alpha: v[4]!, beta: v[5]!, gamma: v[6]! };
    } else if (key === "LATT") latt = Number(w[1]);
    else if (key === "SYMM") symm.push(line.trim().slice(4).trim());
    else if (key === "SFAC") {
      // Short form: element symbols. Long form: one element followed by its scattering-factor numbers.
      const named = w.slice(1).filter((t) => !/^[-+.\d]/.test(t));
      if (w.length > 2 && named.length === 1 && w.slice(2).every((t) => /^[-+.\d]/.test(t))) sfac.push(named[0]!);
      else sfac.push(...named);
    } else if (key === "FVAR") fvar.push(...w.slice(1).map(Number));
    else if (!COMMANDS.has(key) && !/^Q\d+$/i.test(w[0]!) && w.length >= 5 && /^\d+$/.test(w[1]!)) {
      const v = w.slice(2, 6).map(Number);
      if (v.slice(0, 3).some((x) => !Number.isFinite(x))) continue;
      const index = Number(w[1]);
      const symbol = sfac[index - 1];
      if (!symbol) throw new Error(`Atom ${w[0]} uses SFAC number ${index}, but SFAC names only ${sfac.length} elements.`);
      const element = elementOf(symbol);
      if (!element) throw new Error(`SFAC entry "${symbol}" is not an element symbol.`);
      sites.push({ label: w[0]!, element, frac: [coordinate(v[0]!), coordinate(v[1]!), coordinate(v[2]!)], occupancy: occupancy(Number.isFinite(v[3]) ? v[3]! : 11, fvar, w[0]!) });
    }
  }
  if (!cell) throw new Error("The SHELX file has no CELL line.");
  if (sites.length === 0) throw new Error("The SHELX file holds no atoms.");
  const centring = CENTRING[Math.abs(latt)];
  if (!centring) throw new Error(`LATT ${latt} is not a SHELX lattice type (1 to 7, positive or negative).`);
  const operations = group([...symm, ...(latt > 0 ? ["-x,-y,-z"] : []), ...centring]);
  return {
    name: title || fileName.replace(/\.(res|ins)$/i, ""),
    cell,
    spaceGroupName: `${operations.length} operations from the SHELX file (LATT ${latt})`,
    operations,
    sites,
    magnetic: false,
  };
}

function occupancy(sof: number, fvar: readonly number[], atom: string): number {
  const m = Math.trunc(Math.abs(sof) / 10);
  const p = Math.abs(sof) - 10 * m;
  if (m === 0) return sof; // refined freely
  if (m === 1) return sof > 0 ? p : -p; // 10 + p: p held fixed
  const fv = fvar[m - 1];
  if (fv === undefined) throw new Error(`Atom ${atom} refers to free variable ${m}, which FVAR does not give.`);
  return sof > 0 ? p * fv : p * (1 - fv);
}

/** The group the generators make (identity included), checked to close within a size a space group can have. */
function group(generators: readonly string[]): SymmetryOperation[] {
  const gens = generators.map((g) => {
    try {
      return parseSymmetryOperation(g.replace(/\s+/g, ""));
    } catch {
      throw new Error(`"${g}" is not a symmetry operation.`);
    }
  });
  const all = new Map<string, SymmetryOperation>();
  const identity = parseSymmetryOperation("x,y,z");
  all.set(operationKey(identity), identity);
  let frontier = [identity];
  while (frontier.length) {
    const next: SymmetryOperation[] = [];
    for (const a of frontier)
      for (const g of gens) {
        const c = composeOperations(g, a);
        const key = operationKey(c);
        if (!all.has(key)) {
          all.set(key, c);
          next.push(c);
          if (all.size > 192) throw new Error("The SYMM and LATT lines do not make a space group (more than 192 operations).");
        }
      }
    frontier = next;
  }
  return [...all.values()];
}
