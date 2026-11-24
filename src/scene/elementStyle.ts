// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Default look of each element. These are drawing defaults, not physics:
 * the radius is roughly the covalent radius (angstrom) and is scaled down for
 * the drawing; the colours are a muted palette. Both become editable in step 4.
 */
import { ELEMENT_SYMBOLS } from "../structure/elements";

// Indexed by atomic number - 1, H to Cm. Approximate covalent radii in angstrom.
const RADII: readonly number[] = [
  0.31, 0.28, 1.28, 0.96, 0.84, 0.76, 0.71, 0.66, 0.57, 0.58, 1.66, 1.41, 1.21, 1.11, 1.07, 1.05, 1.02, 1.06,
  2.03, 1.76, 1.7, 1.6, 1.53, 1.39, 1.39, 1.32, 1.26, 1.24, 1.32, 1.22, 1.22, 1.2, 1.19, 1.2, 1.2, 1.16,
  2.2, 1.95, 1.9, 1.75, 1.64, 1.54, 1.47, 1.46, 1.42, 1.39, 1.45, 1.44, 1.42, 1.39, 1.39, 1.38, 1.39, 1.4,
  2.44, 2.15, 2.07, 2.04, 2.03, 2.01, 1.99, 1.98, 1.98, 1.96, 1.94, 1.92, 1.92, 1.89, 1.9, 1.87, 1.87,
  1.75, 1.7, 1.62, 1.51, 1.44, 1.41, 1.36, 1.36, 1.32, 1.45, 1.46, 1.48, 1.4, 1.5, 1.5,
  2.6, 2.21, 2.15, 2.06, 2.0, 1.96, 1.9, 1.87, 1.8, 1.69,
];

const COLOURS: Readonly<Record<string, string>> = {
  H: "#dfe3e6", D: "#dfe3e6", C: "#6b7379", N: "#6f8fc9", O: "#f1cfcc", F: "#9fcf9a", Na: "#b99ad6", Mg: "#9cc79a",
  Al: "#b8a9c4", Si: "#c9b68f", P: "#d49a5c", S: "#d9c25a", Se: "#e08a3c", Cl: "#8fc48b", K: "#9a7fc0", Ca: "#8fb8a0",
  Ti: "#5f89b8", V: "#7f9a9e", Cr: "#7a8fb5", Mn: "#8e6bb0", Fe: "#c77b3b", Co: "#3d6fb3", Ni: "#4d9a68",
  Cu: "#b5533c", Zn: "#8b98a6", Ga: "#a8899b", Sr: "#6fae8f", Y: "#7fbfc0", Zr: "#86b8b0", Ba: "#5a9a7a", La: "#7fb3d1",
  Tb: "#c2343c", W: "#b3bac1", Pb: "#7b848c", Bi: "#c5cad0",
};

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const v = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Mix a "#rrggbb" colour towards another by `t` (0 = unchanged, 1 = the other). */
export function mixHex(hex: string, other: string, t: number): string {
  const ch = (h: string, i: number): number => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `#${[0, 1, 2].map((i) => Math.round(ch(hex, i) + (ch(other, i) - ch(hex, i)) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Default colour of an element: from the table, else a muted hue set by the atomic number. */
export function defaultColour(element: string): string {
  const listed = COLOURS[element];
  if (listed !== undefined) return listed;
  const z = ELEMENT_SYMBOLS.indexOf(element) + 1;
  return hslToHex((z * 47) % 360, 0.38, 0.6);
}

/** The approximate covalent radius of an element in angstrom (1.5 when it is not in the table). */
export function coveringRadius(element: string): number {
  const z = ELEMENT_SYMBOLS.indexOf(element === "D" ? "H" : element);
  return RADII[z] ?? 1.5;
}

/** Default sphere radius in angstrom: 0.4 x the approximate covalent radius. */
export function defaultRadius(element: string): number {
  const z = ELEMENT_SYMBOLS.indexOf(element === "D" ? "H" : element);
  return 0.4 * (RADII[z] ?? 1.5);
}
