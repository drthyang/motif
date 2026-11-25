// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * A model's reply, as the panel shows it: paragraphs, lists and bold, from the light Markdown models write even when
 * told not to, with LaTeX units made plain (μB, Å, °). The result is plain data the panel turns into elements, so no
 * reply is ever inserted as HTML.
 */

export interface Span {
  readonly text: string;
  readonly bold?: boolean;
  readonly code?: boolean;
}

export type Block = { readonly kind: "p"; readonly lines: readonly (readonly Span[])[] } | { readonly kind: "ul" | "ol"; readonly items: readonly (readonly Span[])[] };

/** LaTeX that models write for units, made plain; any other $...$ loses its dollars. */
export function plainUnits(text: string): string {
  return text
    .replace(/\$?\\mu_?\{?B\}?\$?/g, "μB")
    .replace(/\$?\\(?:AA|mathring\{A\}|text\{Å\})\$?/g, "Å")
    .replace(/\$?\^\{?\\circ\}?\$?/g, "°")
    .replace(/\$?\\times\$?/g, "×")
    .replace(/\$([^$\n]{1,40})\$/g, "$1");
}

/** Bold and code within a line. */
function spans(line: string): Span[] {
  const out: Span[] = [];
  const re = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    if (m[3] !== undefined) out.push({ text: m[3], code: true });
    else out.push({ text: (m[1] ?? m[2])!, bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out.filter((s) => s.text !== "");
}

const LIST = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/;

export function replyBlocks(raw: string): Block[] {
  let text = plainUnits(raw).replace(/\r\n?/g, "\n");
  // A numbered list written on one line ("…: 1. Edit … 2. Adjust …"): one item per line.
  text = text
    .split("\n")
    .map((line) => ((line.match(/(?:^|\s)\d+[.)]\s+\S/g) ?? []).length >= 2 ? line.replace(/\s+(?=\d+[.)]\s+\S)/g, "\n") : line))
    .join("\n");
  const blocks: Block[] = [];
  let para: Span[][] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", lines: para });
    para = [];
  };
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/^\s*#{1,6}\s+/, "").trimEnd();
    if (line.trim() === "") {
      flush();
      continue;
    }
    const m = LIST.exec(line);
    if (m) {
      flush();
      const kind = m[1] ? "ul" : "ol";
      const prev = blocks[blocks.length - 1];
      const item = spans(m[3]!);
      if (prev && prev.kind === kind) blocks[blocks.length - 1] = { kind, items: [...prev.items, item] };
      else blocks.push({ kind, items: [item] });
      continue;
    }
    para.push(spans(line.trim()));
  }
  flush();
  return blocks;
}
