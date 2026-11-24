// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The page's accent colour, chosen by each user and kept in this browser. It colours the page only (the main
 * buttons, the assistant drawer's header, the example cards on hover, the active control hint, notices); figures
 * are never affected. Lemon is the stylesheet's own colour (app.css), so choosing it just clears the choice.
 */

export interface Theme {
  readonly id: string;
  readonly name: string;
  /** The accent, and its deeper shade for hover. Ink text sits on both. */
  readonly accent: string;
  readonly deep: string;
}

export const THEMES: readonly Theme[] = [
  { id: "lemon", name: "Lemon", accent: "#fff27a", deep: "#f6e24a" },
  { id: "marigold", name: "Marigold", accent: "#ffd166", deep: "#f7bf3d" },
  { id: "apricot", name: "Apricot", accent: "#ffbe8a", deep: "#ffa86b" },
  { id: "mint", name: "Mint", accent: "#b5ecd4", deep: "#93e0bf" },
  { id: "sky", name: "Sky", accent: "#bcd8ff", deep: "#9cc4fb" },
  { id: "lilac", name: "Lilac", accent: "#d9ccff", deep: "#c6b4fb" },
];

export const DEFAULT_THEME = "lemon";
const STORE = "motif.theme";

/** A colour moved towards white by `f` (0 to 1): the light tint used for notices. */
export function tint(hex: string, f: number): string {
  return `#${[1, 3, 5]
    .map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16);
      return Math.round(c + (255 - c) * f)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

/** The stylesheet's variables a theme sets; none for the default, which is the stylesheet's own. */
export function themeVariables(id: string): Record<string, string> {
  const theme = THEMES.find((t) => t.id === id);
  if (!theme || theme.id === DEFAULT_THEME) return {};
  return { "--accent": theme.accent, "--accent-deep": theme.deep, "--note-bg": tint(theme.accent, 0.7) };
}

/** The choice kept in this browser, or the default if none (or one no longer offered). */
export function readTheme(): string {
  try {
    const id = localStorage.getItem(STORE);
    return id && THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Colour the page with a theme, and keep the choice in this browser. */
export function applyTheme(id: string, keep = true): void {
  const root = document.documentElement.style;
  for (const name of ["--accent", "--accent-deep", "--note-bg"]) root.removeProperty(name);
  for (const [name, value] of Object.entries(themeVariables(id))) root.setProperty(name, value);
  if (!keep) return;
  try {
    if (id === DEFAULT_THEME) localStorage.removeItem(STORE);
    else localStorage.setItem(STORE, id);
  } catch {
    // A browser that keeps nothing (a private window): the colour lasts for this visit.
  }
}
