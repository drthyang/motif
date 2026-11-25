// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * CIF 1.1 syntax: text -> data blocks of items and loops. No crystallography here.
 * Adapted from MATERIA (src/parsers/cif.ts), by the same author.
 */

/** Strip the parenthetical esd and parse: "5.41317(8)" -> 5.41317. */
export function parseCifNumber(raw: string): number {
  const cleaned = raw.replace(/\([^)]*\)/g, "").trim();
  const value = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(cleaned) ? parseFloat(cleaned) : NaN;
  if (Number.isNaN(value)) {
    throw new Error(`Cannot parse CIF number: "${raw}"`);
  }
  return value;
}

/** A CIF text value; undefined for absent, empty, `?` (unknown) and `.` (inapplicable). */
export function cifText(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  return t === undefined || t === "" || t === "?" || t === "." ? undefined : t;
}

/** One CIF token. `quoted` marks a quoted string or a semicolon text field:
 *  always a value, never a tag, a reserved word or the null `?`/`.`. */
interface CifToken {
  readonly text: string;
  readonly quoted: boolean;
  /** 1-based line the token starts on. */
  readonly line: number;
}

/** Split one line (no text field) into tokens. A comment starts with `#` at a
 *  token boundary. A quoted string ends at its quote followed by whitespace or
 *  the end of the line, so 'O'Brien' is one value; an unterminated quote is
 *  read as a bare word. */
function tokenizeLine(line: string, lineNo: number, out: CifToken[]): void {
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (/\s/.test(c)) {
      i++; // any whitespace, including a byte-order mark
      continue;
    }
    if (c === "#") return;
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < line.length && !(line[j] === c && (j + 1 === line.length || /\s/.test(line[j + 1]!)))) j++;
      if (j < line.length) {
        out.push({ text: line.slice(i + 1, j), quoted: true, line: lineNo });
        i = j + 1;
        continue;
      }
    }
    // A CIF 2 list, "[0 0 0.2317]" (the propagation vector k as MATERIA and the Bilbao server write it), is one
    // value with its spaces; read word by word it would split into three and shift every value after it in a loop.
    if (c === "[") {
      let depth = 0;
      let j = i;
      for (; j < line.length; j++) {
        if (line[j] === "[") depth++;
        else if (line[j] === "]" && --depth === 0) break;
      }
      if (j < line.length) {
        out.push({ text: line.slice(i, j + 1), quoted: true, line: lineNo });
        i = j + 1;
        continue;
      }
    }
    let j = i;
    while (j < line.length && !/\s/.test(line[j]!)) j++;
    out.push({ text: line.slice(i, j), quoted: false, line: lineNo });
    i = j;
  }
}

/**
 * CIF 1.1 tokens. A line starting with `;` opens a text field that runs to the
 * next line starting with `;`; its lines are one value, so a `_tag`, `loop_` or
 * `data_` inside it is text, not syntax.
 */
function tokenizeCif(text: string): CifToken[] {
  const lines = text.split(/\r\n|\r|\n/);
  const tokens: CifToken[] = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!;
    if (!line.startsWith(";")) {
      tokenizeLine(line, n + 1, tokens);
      continue;
    }
    const body = [line.slice(1)];
    let end = n + 1;
    while (end < lines.length && !lines[end]!.startsWith(";")) body.push(lines[end++]!);
    if (end === lines.length) throw new Error(`CIF line ${n + 1}: the text field opened by ";" is never closed`);
    tokens.push({ text: body.join("\n").trim(), quoted: true, line: n + 1 });
    tokenizeLine(lines[end]!.slice(1), end + 1, tokens);
    n = end;
  }
  return tokens;
}

/** The reserved word a token is (`data_<name>` → "data_"), if any. */
function reservedWord(t: CifToken): string | undefined {
  if (t.quoted) return undefined;
  const lower = t.text.toLowerCase();
  if (lower.startsWith("data_")) return "data_";
  if (lower.startsWith("save_")) return "save_";
  return lower === "loop_" || lower === "global_" || lower === "stop_" ? lower : undefined;
}

const isTag = (t: CifToken): boolean => !t.quoted && t.text.startsWith("_");

export interface Loop {
  readonly headers: string[];
  readonly rows: string[][];
  /** Set when the values do not fill whole rows; reading the loop throws it. */
  readonly malformed?: string;
}

/**
 * Rows of a loop. CIF puts rows anywhere — wrapped over lines, several to a
 * line — so the values are cut into rows of `headers.length`. One exception
 * keeps a non-conformant layout readable as before: when every line holds the
 * same number of values, more than one row's worth but not a whole number of
 * rows (MAGNDATA's `1 x,y,z,+1 mx,my,mz` under two tags), each line is a row
 * and the extra values are ignored. Values that cannot be cut into rows mark
 * the loop malformed instead of shifting every later column.
 */
function loopRows(headers: string[], values: CifToken[]): Pick<Loop, "rows" | "malformed"> {
  const n = headers.length;
  if (values.length === 0) return { rows: [] };
  const perLine: string[][] = [];
  let last = -1;
  for (const v of values) {
    if (v.line !== last) perLine.push([]);
    perLine[perLine.length - 1]!.push(v.text);
    last = v.line;
  }
  const width = perLine[0]!.length;
  const uniform = perLine.every((r) => r.length === width);
  if (n > 0 && uniform && width > n && width % n !== 0) return { rows: perLine };
  // Every line short by the same count, and not a clean wrap of a row over
  // several lines: a column is missing, so cutting rows would misalign them.
  const missingColumn = uniform && width < n && n % width !== 0;
  if (n > 0 && !missingColumn && values.length % n === 0) {
    const rows: string[][] = [];
    for (let i = 0; i < values.length; i += n) rows.push(values.slice(i, i + n).map((v) => v.text));
    return { rows };
  }
  return {
    rows: [],
    malformed:
      `CIF loop ${headers[0] ?? "(no tags)"} (line ${values[0]!.line}): ${values.length} values ` +
      `in lines of ${[...new Set(perLine.map((r) => r.length))].join("/")} do not fill rows of ${n} columns`,
  };
}

export interface ParsedCif {
  readonly items: Map<string, string>;
  readonly loops: Loop[];
}

/**
 * Split a (possibly multi-block) CIF into its `data_` blocks, parsing each into
 * its own items + loops. A single-block file yields one block. Keeping blocks
 * separate avoids cross-contamination — e.g. a file with X-ray, neutron, and
 * refined-XRD blocks must not take its cell from one block and its atoms from
 * another.
 */
/** Where a block's `data_` name is kept among its items (no CIF tag starts with a space). */
export const BLOCK_NAME = " data_block";

export function parseCifBlocks(text: string): ParsedCif {
  const blocks: ParsedCif[] = [];
  let items = new Map<string, string>();
  let loops: Loop[] = [];
  const flush = (): void => {
    if (items.size > (items.has(BLOCK_NAME) ? 1 : 0) || loops.length > 0) blocks.push({ items, loops });
  };

  const tokens = tokenizeCif(text);
  const isValue = (t: CifToken | undefined): t is CifToken => t !== undefined && !isTag(t) && reservedWord(t) === undefined;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i]!;
    const word = reservedWord(t);
    if (word === "data_") {
      // New data block — start fresh so blocks never merge. Its name is kept
      // (under a key no CIF tag can have) as the last fallback for the phase name.
      flush();
      items = new Map<string, string>([[BLOCK_NAME, t.text.slice(5)]]);
      loops = [];
      i++;
      continue;
    }
    if (word === "loop_") {
      i++;
      const headers: string[] = [];
      while (i < tokens.length && isTag(tokens[i]!)) headers.push(tokens[i++]!.text);
      const values: CifToken[] = [];
      while (isValue(tokens[i])) values.push(tokens[i++]!);
      loops.push({ headers, ...loopRows(headers, values) });
      continue;
    }
    if (isTag(t)) {
      const key = t.text.toLowerCase();
      const value = tokens[i + 1];
      i++;
      if (isValue(value)) {
        // Further bare words on the value's line belong to it: a common
        // non-conformant spelling is `_symmetry_space_group_name_H-M P 21/c`.
        let text = value.text;
        i++;
        while (!value.quoted && isValue(tokens[i]) && !tokens[i]!.quoted && tokens[i]!.line === value.line) {
          text += ` ${tokens[i++]!.text}`;
        }
        items.set(key, text);
      }
      continue;
    }
    i++; // global_, save_, stop_, or a stray value
  }
  flush();

  if (blocks.length === 0) return { items: new Map(), loops: [] };
  // Prefer the first block that actually carries atom sites, so a leading
  // metadata-only (global) block or a non-structural block is skipped.
  const hasAtoms = (b: ParsedCif): boolean =>
    b.loops.some((l) => l.headers.some((h) => h.toLowerCase().includes("atom_site_fract")));
  return blocks.find(hasAtoms) ?? blocks[0]!;
}

/** The first loop whose tags satisfy `predicate`; throws if that loop's values
 *  do not fill whole rows, rather than reading misaligned columns. */
export function findLoop(loops: Loop[], predicate: (headers: string[]) => boolean): Loop | undefined {
  const loop = loops.find((l) => predicate(l.headers.map((h) => h.toLowerCase())));
  if (loop?.malformed) throw new Error(loop.malformed);
  return loop;
}
