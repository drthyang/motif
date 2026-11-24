// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, readTheme, THEMES, themeVariables, tint } from "../src/ui/theme";

/** WCAG contrast ratio between two colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("page colour themes", () => {
  it("lemon, the default, is the stylesheet's own accent, so choosing it changes nothing", () => {
    const css = readFileSync("src/ui/app.css", "utf8");
    const lemon = THEMES.find((t) => t.id === DEFAULT_THEME)!;
    expect(css).toContain(`--accent: ${lemon.accent};`);
    expect(css).toContain(`--accent-deep: ${lemon.deep};`);
    expect(themeVariables(DEFAULT_THEME)).toEqual({});
  });

  it("every theme has a unique id, and the page's ink reads on its accent and its hover shade (WCAG AAA, 7:1)", () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    for (const t of THEMES) {
      expect(contrast("#1b1a18", t.accent), t.id).toBeGreaterThanOrEqual(7);
      expect(contrast("#1b1a18", t.deep), t.id).toBeGreaterThanOrEqual(7);
    }
  });

  it("another theme sets the accent, its hover shade, and a light tint for notices", () => {
    expect(themeVariables("apricot")).toEqual({ "--accent": "#ffbe8a", "--accent-deep": "#ffa86b", "--note-bg": tint("#ffbe8a", 0.7) });
    expect(tint("#000000", 0.5)).toBe("#808080");
    expect(tint("#fff27a", 0)).toBe("#fff27a");
    expect(themeVariables("no-such-theme")).toEqual({});
  });

  it("with no browser storage, the default is used", () => {
    expect(readTheme()).toBe(DEFAULT_THEME);
  });
});
