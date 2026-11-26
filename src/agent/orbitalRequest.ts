// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * An orbital request from the assistant (set_orbitals), checked and turned into the rule the page keeps for one
 * species (the same shape the Structure › Orbitals panel edits). Shared by the page (App.tsx) and the MCP server's
 * Figure, so both hold exactly the same rule.
 */

import { DEFAULT_ISO, ORBITALS } from "../scene/orbitals";
import { DEFAULT_ORBITAL_COLOURS, DEFAULT_ORBITAL_OPACITY, DEFAULT_ORBITAL_SIZE, type OrbitalTexture } from "../scene/scene";

/** One species' orbitals as the page keeps them (numbers as typed text where the panel has a box). */
export interface OrbitalRuleState {
  species: string;
  orbitals: string[];
  sizeText: string;
  colours: [string, string];
  opacityText: string;
  iso: number;
  texture: OrbitalTexture;
  zText: string;
  xText: string;
  zMode?: "uvw" | "longest" | "bridge";
  zNeighbour?: string;
}

export interface OrbitalRequest {
  readonly species: string;
  readonly orbitals: readonly string[];
  readonly size?: number;
  readonly iso?: number;
  readonly opacity?: number;
  readonly colours?: readonly string[];
  /** The orbital's local z along this crystal direction [u v w]. */
  readonly zAlong?: readonly number[];
  /** The local z from each atom's own bonds: along its longest bond to `neighbour`, or the line through its two nearest. */
  readonly zFrom?: { readonly neighbour: string; readonly mode: "longest" | "bridge" };
}

export const ORBITAL_IDS: readonly string[] = ORBITALS.map((o) => o.id);

/** The rule for a request, or an error sentence. `species` and `elements` are what the structure has. */
export function orbitalRuleFor(req: OrbitalRequest, species: readonly string[], previous?: OrbitalRuleState): OrbitalRuleState | { error: string } {
  const key = species.find((s) => s.toLowerCase() === req.species.trim().toLowerCase());
  if (!key) return { error: `There is no ${req.species} in this structure (it has ${species.join(", ")}).` };
  const unknown = req.orbitals.filter((o) => !ORBITAL_IDS.includes(o));
  if (req.orbitals.length === 0 || unknown.length) return { error: `Orbitals are named ${ORBITAL_IDS.join(", ")}${unknown.length ? `; not ${unknown.join(", ")}` : ""}.` };
  if (req.size !== undefined && !(req.size > 0.1 && req.size <= 20)) return { error: "size is the orbital's reach in angstrom, from 0.1 to 20." };
  if (req.iso !== undefined && !(req.iso >= 0.05 && req.iso <= 0.9)) return { error: "iso is from 0.05 (full lobes) to 0.9 (slim lobes)." };
  if (req.opacity !== undefined && !(req.opacity >= 0.05 && req.opacity <= 1)) return { error: "opacity is from 0.05 to 1." };
  if (req.colours !== undefined && (req.colours.length !== 2 || req.colours.some((c) => !/^#[0-9a-fA-F]{6}$/.test(c)))) return { error: 'colours are two "#rrggbb": the positive and the negative lobes.' };
  if (req.zAlong && req.zFrom) return { error: "Give the local z either along a direction (z_along) or from the bonds (z_from), not both." };
  if (req.zAlong && !(req.zAlong.length === 3 && req.zAlong.every(Number.isFinite) && req.zAlong.some((x) => x !== 0))) return { error: "z_along is a crystal direction [u, v, w], not all zero." };
  if (req.zFrom) {
    const n = species.find((s) => s.toLowerCase() === req.zFrom!.neighbour.trim().toLowerCase());
    if (!n) return { error: `z_from: there is no ${req.zFrom.neighbour} in this structure (it has ${species.join(", ")}).` };
    if (!["longest", "bridge"].includes(req.zFrom.mode)) return { error: 'z_from mode is "longest" (along the longest bond to that element) or "bridge" (the line through the two nearest).' };
  }
  const zFrom = req.zFrom ? { zMode: req.zFrom.mode, zNeighbour: species.find((s) => s.toLowerCase() === req.zFrom!.neighbour.trim().toLowerCase())! } : null;
  return {
    species: key,
    orbitals: [...new Set(req.orbitals)],
    sizeText: String(req.size ?? previous?.sizeText ?? DEFAULT_ORBITAL_SIZE),
    colours: (req.colours ? [req.colours[0]!.toLowerCase(), req.colours[1]!.toLowerCase()] : (previous?.colours ?? [...DEFAULT_ORBITAL_COLOURS])) as [string, string],
    opacityText: String(req.opacity ?? previous?.opacityText ?? DEFAULT_ORBITAL_OPACITY),
    iso: req.iso ?? previous?.iso ?? DEFAULT_ISO,
    texture: previous?.texture ?? "soft",
    zText: req.zAlong ? req.zAlong.join(" ") : req.zFrom ? "" : (previous?.zText ?? ""),
    xText: previous?.xText ?? "",
    ...(zFrom ? zFrom : req.zAlong ? {} : previous?.zMode ? { zMode: previous.zMode, ...(previous.zNeighbour ? { zNeighbour: previous.zNeighbour } : {}) } : {}),
  };
}

/** The orbitals shown, in words, for describe_figure. */
export function orbitalsInWords(rules: readonly OrbitalRuleState[]): string {
  if (rules.length === 0) return "none";
  return rules
    .map((r) => `${r.species}: ${r.orbitals.join(", ")}; size ${r.sizeText} Å, iso ${r.iso}, opacity ${r.opacityText}; local z ${r.zMode === "longest" && r.zNeighbour ? `along each atom's longest bond to ${r.zNeighbour}` : r.zMode === "bridge" && r.zNeighbour ? `along the line through its two nearest ${r.zNeighbour}` : r.zText.trim() ? `along [${r.zText.trim()}]` : "along c* (MOTIF's axes)"}`)
    .join("; ");
}
