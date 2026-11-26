// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Where each element's atoms are in the unit cell, in words, for the assistant (describe_figure): their distinct
 * fractional coordinates along a, b and c, so it can choose the cells or a slab round a feature ("Tb at c 0.3, 0.7").
 */

import { expandToUnitCell } from "./expand";
import type { Structure } from "./types";

export function positionsInWords(structure: Structure, most = 8): string {
  const atoms = expandToUnitCell(structure).atoms;
  const byElement = new Map<string, [Set<string>, Set<string>, Set<string>]>();
  for (const a of atoms) {
    const key = a.species;
    let sets = byElement.get(key);
    if (!sets) byElement.set(key, (sets = [new Set(), new Set(), new Set()]));
    a.frac.forEach((x, i) => sets![i]!.add((Math.round((((x % 1) + 1) % 1) * 100) / 100 % 1).toFixed(2)));
  }
  const axis = (set: Set<string>) => {
    const v = [...set].map(Number).sort((p, q) => p - q);
    return v.length > most ? `${v.length} values from ${v[0]} to ${v[v.length - 1]}` : v.join(", ");
  };
  return [...byElement].map(([el, [a, b, c]]) => `${el}: a ${axis(a)}; b ${axis(b)}; c ${axis(c)}`).join(". ");
}
