// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/** Bonds by distance: a rule names two elements and a longest distance; every such pair of shown atoms is joined. */
import { fractionalToCartesian, planeSpacings } from "../structure/cell";
import type { CellAtom, Structure, Vec3 } from "../structure/types";
import { atomsInRange, type Range } from "./select";

export interface BondRule {
  /** Species at the centre, e.g. the metal of an octahedron: an element symbol, or "Fe/Mg" for a shared site. */
  readonly centre: string;
  /** Species bonded to it. May be the same one. */
  readonly neighbour: string;
  /** Longest centre-to-centre distance that counts as a bond, in angstrom. */
  readonly max: number;
  /**
   * Also show the `neighbour` atoms that lie outside the chosen range but within `max` of a `centre`
   * atom inside it, so that every centre shown has all its neighbours.
   */
  readonly complete: boolean;
  /** Look of the sticks: colour "#rrggbb" and thickness in angstrom. Defaults: pale grey, 0.12 A. */
  readonly colour?: string;
  readonly width?: number;
  /** Lay a soft highlight band behind the bonded atoms (a chain, a net). */
  readonly band?: boolean;
  /**
   * With `band`: which connected group to highlight, counted from 0 in the order of
   * connectedGroups(); null or absent highlights all of them. Atoms and bonds of the rule that
   * are not in the highlighted group are then drawn pale.
   */
  readonly chain?: number | null;
  /** Fill every triangle of three mutually bonded atoms with a translucent colour (a kagome net). */
  readonly fill?: boolean;
  /** Leave out the `neighbour` atoms that this rule bonds to nothing (for example oxygens with no metal shown). */
  readonly hideUnbonded?: boolean;
  /**
   * For a rule between atoms of one species: leave out its atoms that are in no triangle, and its
   * bonds that are not the side of a triangle (the ragged edge of a kagome net).
   */
  readonly onlyTriangles?: boolean;
}

/** An atom with its position in angstrom. */
export interface PlacedAtom extends CellAtom {
  readonly cart: Vec3;
  /** True for an atom outside the chosen range, shown only because a bond rule asked for it. */
  readonly added?: boolean;
}

export interface Bond {
  /** Indices into the atom list. */
  readonly i: number;
  readonly j: number;
  /** Index of the rule that made it. */
  readonly rule: number;
  /** Centre-to-centre distance in angstrom. */
  readonly length: number;
}

/** Two atoms closer than this are the same place (elements sharing one site), never a bond. */
const MIN_BOND = 0.1;

const distance = (p: Vec3, q: Vec3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** Atoms sorted into cubic boxes of side `size`, so that neighbours within `size` are found without trying every pair. */
class Boxes {
  private readonly boxes = new Map<string, number[]>();
  constructor(private readonly atoms: readonly PlacedAtom[], private readonly size: number, keep: (a: PlacedAtom) => boolean) {
    atoms.forEach((a, index) => {
      if (!keep(a)) return;
      const key = this.key(a.cart, 0, 0, 0);
      const list = this.boxes.get(key);
      if (list) list.push(index);
      else this.boxes.set(key, [index]);
    });
  }
  private key(p: Vec3, i: number, j: number, k: number): string {
    return `${Math.floor(p[0] / this.size) + i},${Math.floor(p[1] / this.size) + j},${Math.floor(p[2] / this.size) + k}`;
  }
  /** Indices of the kept atoms within `max` (<= size) of `p`, excluding any at the same place. */
  near(p: Vec3, max: number): { index: number; d: number }[] {
    const out: { index: number; d: number }[] = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      for (const index of this.boxes.get(this.key(p, i, j, k)) ?? []) {
        const d = distance(p, this.atoms[index]!.cart);
        if (d <= max && d > MIN_BOND) out.push({ index, d });
      }
    }
    return out;
  }
}

const place = (structure: Structure, atoms: readonly CellAtom[]): PlacedAtom[] =>
  atoms.map((a) => ({ ...a, cart: fractionalToCartesian(structure.cell, a.frac) }));

/** The range widened on every side by enough cells to hold everything within `reach` angstrom of it. */
function widened(structure: Structure, range: Range, reach: number): Range {
  const d = planeSpacings(structure.cell);
  const pad = [reach / d[0], reach / d[1], reach / d[2]];
  return {
    from: [range.from[0] - pad[0]!, range.from[1] - pad[1]!, range.from[2] - pad[2]!],
    to: [range.to[0] + pad[0]!, range.to[1] + pad[1]!, range.to[2] + pad[2]!],
    boundary: "both",
  };
}

const sameAtomKey = (a: CellAtom): string => `${a.siteIndex}|${a.frac.map((x) => Math.round(x * 1e6)).join(",")}`;

export function checkRule(rule: BondRule): void {
  if (!(rule.max > MIN_BOND) || !Number.isFinite(rule.max)) throw new Error(`A bond's longest distance must be a number above ${MIN_BOND} A.`);
  if (rule.max > 10) throw new Error("A bond's longest distance cannot exceed 10 A.");
}

export interface Bonded {
  /** The atoms in the range, followed by any atoms added by "complete" rules. */
  readonly atoms: readonly PlacedAtom[];
  readonly bonds: readonly Bond[];
  readonly warnings: readonly string[];
}

export function atomsAndBonds(structure: Structure, range: Range, rules: readonly BondRule[], hidden: ReadonlySet<string> = new Set()): Bonded {
  rules.forEach(checkRule);
  const selection = atomsInRange(structure, range);
  // A hidden species is left out altogether: no spheres, no bonds to it, no neighbours added for it.
  const atoms: PlacedAtom[] = place(structure, selection.atoms).filter((a) => !hidden.has(a.species));
  const inRange = atoms.length;

  // 1. Add the neighbours outside the range that "complete" rules ask for. Only atoms inside the range
  //    are centres, so the figure grows by one shell of neighbours and no further.
  const completing = rules.filter((r) => r.complete);
  if (completing.length > 0 && inRange > 0) {
    const reach = Math.max(...completing.map((r) => r.max));
    const around = place(structure, atomsInRange(structure, widened(structure, range, reach), Infinity).atoms).filter((a) => !hidden.has(a.species));
    const shown = new Set(atoms.map(sameAtomKey));
    for (const rule of completing) {
      const boxes = new Boxes(around, rule.max, (a) => a.species === rule.neighbour);
      for (let c = 0; c < inRange; c++) {
        if (atoms[c]!.species !== rule.centre) continue;
        for (const { index } of boxes.near(atoms[c]!.cart, rule.max)) {
          const key = sameAtomKey(around[index]!);
          if (shown.has(key)) continue;
          shown.add(key);
          atoms.push({ ...around[index]!, added: true });
        }
      }
    }
  }

  // 2. Join every centre-neighbour pair within the rule's distance. A bond needs at least one end inside
  //    the range. A pair is joined once, by the first rule that fits it.
  const bonds: Bond[] = [];
  const joined = new Set<string>();
  rules.forEach((rule, ruleIndex) => {
    const boxes = new Boxes(atoms, rule.max, (a) => a.species === rule.neighbour);
    atoms.forEach((centre, c) => {
      if (centre.species !== rule.centre) return;
      for (const { index, d } of boxes.near(centre.cart, rule.max)) {
        if (centre.added && atoms[index]!.added) continue;
        const [i, j] = c < index ? [c, index] : [index, c];
        const key = `${i}-${j}`;
        if (i === j || joined.has(key)) continue;
        joined.add(key);
        bonds.push({ i, j, rule: ruleIndex, length: d });
      }
    });
  });
  return { atoms, bonds, warnings: selection.warnings };
}

/**
 * The distinct distances (to 0.01 A) between atoms of two elements in the crystal, shortest first,
 * up to `reach` angstrom. Shown to the user as a guide for choosing a bond's longest distance.
 */
export function pairDistances(structure: Structure, a: string, b: string, reach = 6): number[] {
  const once: Range = { from: [0, 0, 0], to: [1, 1, 1], boundary: "once" };
  const cell = place(structure, atomsInRange(structure, once).atoms).filter((x) => x.species === a);
  const around = place(structure, atomsInRange(structure, widened(structure, once, reach), Infinity).atoms);
  const boxes = new Boxes(around, reach, (x) => x.species === b);
  const found = new Set<number>();
  for (const atom of cell) for (const { d } of boxes.near(atom.cart, reach)) found.add(Math.round(d * 100) / 100);
  return [...found].sort((p, q) => p - q);
}
