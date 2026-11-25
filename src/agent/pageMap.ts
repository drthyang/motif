// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Where things are on the page, for the assistant's instructions: without it a model guessed ("left panel →
 * Elements", "top → Magnetic moments"), none of which exists. Each place is a tab › section of the side panel or a
 * named control; a test holds every place to the page's own sections (tests/agentTools.test.ts). `assistant` says
 * whether the assistant can change it itself, or the user does it by hand.
 */

export interface PagePlace {
  readonly what: string;
  readonly where: string;
  readonly assistant: boolean;
}

export const PAGE_MAP: readonly PagePlace[] = [
  { what: "atom colours and sizes", where: "Visual › Atoms", assistant: true },
  { what: "hide or show an element", where: "Structure › Elements shown", assistant: true },
  { what: "which bonds are drawn (pairs, distance)", where: "Structure › Bonds", assistant: true },
  { what: "how bonds look (colour, thickness, line, filled triangles)", where: "Visual › Bonds", assistant: true },
  { what: "coordination polyhedra (from a bond rule)", where: "Structure › Bonds", assistant: true },
  { what: "marking bond angles", where: "Structure › Angles", assistant: true },
  { what: "how angle marks look", where: "Visual › Angles", assistant: true },
  { what: "orbitals", where: "Structure › Orbitals", assistant: false },
  { what: "cells shown", where: "Structure › Cells shown", assistant: true },
  { what: "surfaces (soft, glossy, metal, glass) and outlines", where: "Visual › Shading and outlines", assistant: true },
  { what: "unit cell lines", where: "Visual › Unit cell", assistant: true },
  { what: "legend", where: "Visual › Legend", assistant: true },
  { what: "a, b, c axis arrows", where: "Visual › Axes", assistant: true },
  { what: "font and text sizes", where: "Visual › Lettering", assistant: true },
  { what: "magnetic moment arrows (their look)", where: "Visual › Moment arrows", assistant: true },
  { what: "figure size on paper and journal templates", where: "Layout › Canvas", assistant: true },
  { what: "view direction", where: "Layout › Direction", assistant: true },
];

/** The page in a few lines: the side panel's tabs, the top bar, and where each thing is. */
export function pageMapText(): string {
  const mine = PAGE_MAP.filter((p) => p.assistant).map((p) => `${p.what}: ${p.where}`);
  const theirs = PAGE_MAP.filter((p) => !p.assistant).map((p) => `${p.what}: ${p.where}`);
  return [
    "The page: the figure on the left; on the right a side panel with tabs Info, Structure, Visual, Layout, Assistant (sections inside each tab); at the top Open file, Examples, Save SVG, Save PNG; buttons over the figure to look along a, b, c.",
    `You can change: ${mine.join("; ")}; magnetic moments as the user states them; saving the structure as CIF, POSCAR, XYZ or extended XYZ.`,
    `The user changes by hand (you cannot): ${theirs.join("; ")}; opening files; saving the figure (Save SVG, Save PNG at the top).`,
  ].join("\n");
}
