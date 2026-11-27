// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

// A structure sent by MATERIA, browser to browser: only from MATERIA's origin and the tab that opened MOTIF, well
// formed, and only once (src/ui/fromMateria.ts). The figure it opens is checked in a real browser
// (scripts/browser_check.cjs, part 6).

import { describe, expect, it } from "vitest";
import { MATERIA_ORIGINS, openedFromMateria, receiveFromMateria, sentStructure } from "../src/ui/fromMateria";

const opener = { name: "MATERIA's tab" };
const good = { type: "structure", v: 1, name: "refined.mcif", text: "data_x\n", format: "mcif" };

describe("a structure sent by MATERIA", () => {
  it("only with ?from=materia and an opening tab", () => {
    expect(openedFromMateria("?from=materia", opener)).toBe(true);
    expect(openedFromMateria("", opener)).toBe(false);
    expect(openedFromMateria("?from=other", opener)).toBe(false);
    expect(openedFromMateria("?from=materia", null)).toBe(false);
  });

  it("taken from MATERIA's origin and its own tab, well formed", () => {
    expect(sentStructure({ origin: "https://drthyang.github.io", source: opener, data: good }, opener)).toEqual({ name: "refined.mcif", text: "data_x\n", format: "mcif" });
    expect(MATERIA_ORIGINS).toContain("http://localhost:5173");
  });

  it("ignored from another origin, another window, or malformed", () => {
    expect(sentStructure({ origin: "https://example.org", source: opener, data: good }, opener)).toBeNull();
    expect(sentStructure({ origin: "https://drthyang.github.io", source: { other: true }, data: good }, opener)).toBeNull();
    for (const data of [null, "text", { ...good, type: "other" }, { ...good, v: 2 }, { ...good, format: "pdb" }, { ...good, text: "" }, { ...good, text: 5 }, { ...good, name: 5 }]) {
      expect(sentStructure({ origin: "https://drthyang.github.io", source: opener, data }, opener), JSON.stringify(data)).toBeNull();
    }
  });

  it("a name becomes a plain file name with its extension", () => {
    const name = (n: string, format = "cif") => sentStructure({ origin: "https://drthyang.github.io", source: opener, data: { ...good, name: n, format } }, opener)!.name;
    expect(name("../../etc/x.cif")).toBe("x.cif");
    expect(name("model")).toBe("model.cif");
    expect(name("")).toBe("materia.cif");
    expect(name("a\u0000b.mcif", "mcif")).toBe("ab.mcif");
  });

  it("says it is ready to the opening tab, takes one structure, and ignores everything after", () => {
    const posted: { data: unknown; origin: string }[] = [];
    const tab = { postMessage: (data: unknown, origin: string) => posted.push({ data, origin }) };
    let listener: ((e: MessageEvent) => void) | null = null;
    const win = {
      opener: tab,
      location: { search: "?from=materia" },
      addEventListener: (_: string, f: (e: MessageEvent) => void) => (listener = f),
      removeEventListener: () => (listener = null),
    } as unknown as Window;
    const taken: string[] = [];
    receiveFromMateria(win, (s) => taken.push(s.name));
    expect(posted.map((p) => p.data)).toEqual(MATERIA_ORIGINS.map(() => ({ type: "motif-ready", v: 1 })));
    const send = (origin: string, source: unknown, data: unknown) => listener?.({ origin, source, data } as MessageEvent);
    send("https://example.org", tab, good);
    send("https://drthyang.github.io", {}, good);
    send("https://drthyang.github.io", tab, { ...good, v: 9 });
    expect(taken).toEqual([]);
    send("https://drthyang.github.io", tab, good);
    send("https://drthyang.github.io", tab, { ...good, name: "second.cif" });
    expect(taken).toEqual(["refined.mcif"]);
  });

  it("without ?from=materia no listener is added", () => {
    let added = 0;
    const win = { opener: {}, location: { search: "" }, addEventListener: () => added++, removeEventListener: () => undefined } as unknown as Window;
    receiveFromMateria(win, () => undefined);
    expect(added).toBe(0);
  });
});
