// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Bonds suggested for a structure when it is opened, so that a new figure does not start as bare atoms.
 * This is a drawing aid, not chemistry: it joins nearest neighbours by simple rules, says what it did,
 * and every bond it adds can be changed or removed.
 *
 * The rules:
 *  - If the structure has anions (O, F, Cl, S, N and their like) and other atoms, each kind of other atom is
 *    bonded to each kind of anion: cation-anion bonds only.
 *  - If it is a single element, that element is bonded to itself.
 *  - Otherwise (an intermetallic, say) nothing is suggested: "which atoms are bonded" has no obvious answer.
 *  - A pair is bonded only if its shortest distance is no more than 1.3 times the sum of the two (approximate)
 *    covalent radii. The bond's longest distance covers the first shell: every distance within 1.25 times
 *    the shortest.
 *  - A pair that gives an atom more than eight such neighbours is left out (a large cation with twelve
 *    oxygens around it would bury the figure in sticks).
 * The neighbours that lie just outside the range shown are added, so every centre has all its bonds.
 */
import { atomsAndBonds, pairDistances, type BondRule } from "./bonds";
import { coveringRadius } from "./elementStyle";
import { expandToUnitCell } from "../structure/expand";
import type { Structure } from "../structure/types";

const ANIONS = new Set(["O", "F", "Cl", "Br", "I", "S", "Se", "Te", "N"]);
/** No atom is given more than this many suggested bonds of one kind. */
export const MAX_SUGGESTED_NEIGHBOURS = 8;

export function suggestBonds(structure: Structure): BondRule[] {
  const species = new Map<string, string[]>(); // species -> its elements
  for (const atom of expandToUnitCell(structure).atoms) species.set(atom.species, atom.components.map((c) => c.element));
  const isAnion = (s: string): boolean => species.get(s)!.every((e) => ANIONS.has(e));
  const all = [...species.keys()];
  const anions = all.filter(isAnion);
  const others = all.filter((s) => !isAnion(s));
  let pairs: [string, string][];
  if (anions.length > 0 && others.length > 0) pairs = others.flatMap((c) => anions.map((a) => [c, a] as [string, string]));
  else if (all.length === 1) pairs = [[all[0]!, all[0]!]];
  else return [];
  // The largest covalent radius among the elements sharing a site stands for the site.
  const radius = (s: string): number => Math.max(...species.get(s)!.map(coveringRadius));
  const rules: BondRule[] = [];
  for (const [centre, neighbour] of pairs) {
    const distances = pairDistances(structure, centre, neighbour);
    const shortest = distances[0];
    if (shortest === undefined || shortest > 1.3 * (radius(centre) + radius(neighbour))) continue;
    const shell = distances.filter((d) => d <= 1.25 * shortest);
    const max = Math.ceil((shell[shell.length - 1]! + 0.03) * 100) / 100;
    const rule: BondRule = { centre, neighbour, max, complete: true };
    // How many such neighbours does an atom get? Counted in one cell, with the neighbours outside it added.
    const { atoms, bonds } = atomsAndBonds(structure, { from: [0, 0, 0], to: [1, 1, 1], boundary: "once" }, [rule]);
    const count = new Map<number, number>();
    for (const b of bonds) for (const end of [b.i, b.j]) if (!atoms[end]!.added && atoms[end]!.species === centre) count.set(end, (count.get(end) ?? 0) + 1);
    if (Math.max(0, ...count.values()) > MAX_SUGGESTED_NEIGHBOURS) continue;
    rules.push(rule);
  }
  return rules;
}
