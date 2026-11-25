// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "../src/agent/assistant";
import { PAGE_MAP } from "../src/agent/pageMap";
import { plainUnits, replyBlocks } from "../src/agent/reply";

// The reply the user saw as one run-on paragraph (2026-11-24).
const DUMP =
  'MOTIF helps you create crystal structure figures for papers and slides by letting you: 1. **Edit elements**: Change atom colours, sizes, or hide/show them (left panel → "Elements"). 2. **Adjust bonds**: Add, remove, or style bonds. 3. **Modify views**: Rotate/tilt the structure. Ask for specific changes, like "Make Ti atoms pink"!';

describe("replies as the panel shows them", () => {
  it("a numbered list written on one line becomes a list, with its bold", () => {
    const blocks = replyBlocks(DUMP);
    expect(blocks[0]).toEqual({ kind: "p", lines: [[{ text: "MOTIF helps you create crystal structure figures for papers and slides by letting you:" }]] });
    expect(blocks[1]!.kind).toBe("ol");
    const items = (blocks[1] as unknown as { items: { text: string; bold?: boolean }[][] }).items;
    expect(items.length).toBe(3);
    expect(items[0]![0]).toEqual({ text: "Edit elements", bold: true });
  });

  it("dash lists, paragraphs, headings and code", () => {
    const blocks = replyBlocks("## Done\nI set:\n- Si `blue`\n- O red\n\nSee Visual › Atoms.");
    expect(blocks.map((b) => b.kind)).toEqual(["p", "ul", "p"]);
    expect((blocks[0] as unknown as { lines: unknown[] }).lines.length).toBe(2); // the heading's text, then "I set:"
    expect((blocks[1] as unknown as { items: { text: string; code?: boolean }[][] }).items[0]).toEqual([{ text: "Si " }, { text: "blue", code: true }]);
  });

  it("LaTeX units made plain", () => {
    expect(plainUnits("size (in $\\mu_B$), 3.2 \\AA, 90$^\\circ$, 2 $\\times$ 2")).toBe("size (in μB), 3.2 Å, 90°, 2 × 2");
  });
});

describe("the page as the assistant is told it", () => {
  it("every place in the map is a section of the page, and the instructions carry the map", () => {
    const app = readFileSync("src/ui/App.tsx", "utf8");
    const sections = new Set([...app.matchAll(/<Section tab="(\w+)"(?: closed)? title="([^"]+)"/g)].map((m) => `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} › ${m[2]}`));
    for (const p of PAGE_MAP) expect(sections.has(p.where), `${p.what}: ${p.where}`).toBe(true);
    expect(SYSTEM_PROMPT).toContain("Visual › Atoms");
    expect(SYSTEM_PROMPT).toMatch(/side panel with tabs Info, Structure, Visual, Layout, Assistant/);
    expect(SYSTEM_PROMPT).toMatch(/Never name a place that is not listed above/);
  });
});
