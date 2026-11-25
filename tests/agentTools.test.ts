// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KNOBS, NOT_FOR_ASSISTANT } from "../src/agent/catalogue";
import { runTool, splitPair, TOOLS, type Page } from "../src/agent/tools";

/** A stand-in page that records what the tools asked of it. */
function fakePage(over: Partial<Page> = {}) {
  const calls: unknown[][] = [];
  const page: Page = {
    hasStructure: () => true,
    describe: () => ({ file: "x.cif", format: "CIF", cell: "", elements: [], bonds: [], pairs: [], cells: "", view: "", canvas: "", journal: "", moments: "none", settings: {} }),
    applySettings: (v) => (calls.push(["settings", v]), Object.entries(v).filter(([, x]) => x === "bad").map(([n]) => n)),
    setElement: (e, c) => (calls.push(["element", e, c]), e === "Xx" ? "No element Xx in this structure." : null),
    addBonds: (a, b, d) => (calls.push(["add", a, b, d]), null),
    changeBonds: (p, c) => (calls.push(["change", p, c]), null),
    removeBonds: (p) => (calls.push(["remove", p]), null),
    setView: (v) => (calls.push(["view", v]), null),
    setCells: (f, t) => (calls.push(["cells", f, t]), null),
    useJournal: (r) => (calls.push(["journal", r]), { applied: "Physical Review, 1 column, 8.5 cm, 1/2 width = 4.25 cm" }),
    setMoments: (r) => (calls.push(["moments", r]), { applied: "Mn: 5 μB along [0 0 1] on 2 atoms" }),
    clearMoments: () => (calls.push(["clear"]), null),
    saveStructure: (f, n) => (calls.push(["save", f, n]), { applied: `${n ?? "x"}.cif: 24 atoms` }),
    ...over,
  };
  return { page, calls };
}

describe("the assistant's catalogue of settings", () => {
  it("describes every setting the page keeps, and invents none", () => {
    const app = readFileSync("src/ui/App.tsx", "utf8");
    const block = app.slice(app.indexOf("const settingFields: Record<string, SettingField> = {"));
    const pageNames = [...block.slice(0, block.indexOf("\n  };")).matchAll(/^\s+(\w+): field\(/gm)].map((m) => m[1]!);
    expect(pageNames.length).toBeGreaterThan(40);
    const described = KNOBS.map((k) => k.name);
    expect(described.filter((n) => !pageNames.includes(n)), "described but not on the page").toEqual([]);
    expect(pageNames.filter((n) => !described.includes(n) && !NOT_FOR_ASSISTANT.includes(n)), "on the page but not described").toEqual([]);
    for (const k of KNOBS) {
      expect(k.place, k.name).toMatch(/^(Structure|Visual|Layout) › |^Top bar$|^Under the figure$/);
      expect(k.says.length, k.name).toBeGreaterThan(5);
    }
  });

  it("every place named is a section of the page", () => {
    const app = readFileSync("src/ui/App.tsx", "utf8");
    const sections = new Set([...app.matchAll(/<Section tab="(\w+)"(?: closed)? title="([^"]+)"/g)].map((m) => `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} › ${m[2]}`));
    for (const k of KNOBS) if (k.place.includes("›")) expect(sections.has(k.place), `${k.name}: ${k.place}`).toBe(true);
  });
});

describe("the assistant's tools", () => {
  it("each tool has a name, a description and an object schema", () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(30);
      expect(t.input_schema.type).toBe("object");
    }
  });

  it("find_setting tells where a knob is and what it takes", () => {
    const { page } = fakePage();
    const r = runTool(page, "find_setting", { words: "glass" });
    expect(r.text).toMatch(/glassOpacity \(Visual › Shading and outlines\)/);
    expect(runTool(page, "find_setting", { words: "zzz" }).text).toMatch(/No setting matches/);
    // However the words are run together or spelt.
    for (const words of ["text,size", "font size", "Text sizes", "pt"]) expect(runTool(page, "find_setting", { words }).text, words).toMatch(/textSizes/);
  });

  it("change_settings passes known settings through the page's checks and reports each", () => {
    const { page, calls } = fakePage();
    const r = runTool(page, "change_settings", { changes: { atomMaterial: "glass", showCell: "bad", nonsense: 1, savedViews: [] } });
    expect(calls).toEqual([["settings", { atomMaterial: "glass", showCell: "bad" }]]);
    expect(r.text).toMatch(/Done: atomMaterial = "glass" \(Visual › Shading and outlines\)/);
    expect(r.text).toMatch(/Not a usable value: showCell/);
    expect(r.text).toMatch(/No such setting: nonsense, savedViews/);
    expect(runTool(page, "change_settings", { changes: { nonsense: 1 } }).isError).toBe(true);
  });

  it("a value refused as written is tried again in its natural other form: 8 as \"8\", \"true\" as true", () => {
    // A page that keeps text sizes as text and showCell as true/false, as App.tsx does.
    const kept: Record<string, unknown> = {};
    const { page } = fakePage({
      applySettings: (v) =>
        Object.entries(v).filter(([n, x]) => {
          const ok = n === "textSizes" ? typeof x === "object" && Object.values(x as object).every((y) => typeof y === "string") : n === "showCell" ? typeof x === "boolean" : true;
          if (ok) kept[n] = x;
          return !ok;
        }).map(([n]) => n),
    });
    const r = runTool(page, "change_settings", { changes: { textSizes: { legend: 8, axes: 8, angle: 8 }, showCell: "false" } });
    expect(r.isError).toBeUndefined();
    expect(kept).toEqual({ textSizes: { legend: "8", axes: "8", angle: "8" }, showCell: false });
    expect(r.text).toMatch(/textSizes = \{"legend":"8","axes":"8","angle":"8"\}/);
    // Still refused: the error says what was sent.
    const bad = runTool(page, "change_settings", { changes: { showCell: "maybe" } });
    expect(bad.text).toMatch(/showCell = "maybe", but it takes true or false/);
  });

  it("bonds, elements, view, cells and journal reach the page, and errors come back as errors", () => {
    const { page, calls } = fakePage();
    expect(runTool(page, "add_bonds", { between: "Nb-Nb", up_to: 3.2 }).text).toMatch(/Done: Nb–Nb bonds up to 3.2 Å/);
    runTool(page, "change_bonds", { between: "Nb–Nb", fill_triangles: true, triangle_colour: "#2f6fd6", thickness: 0.22 });
    runTool(page, "set_view", { along: [0, 0, 1] });
    runTool(page, "set_cells", { from: [0, 0, 0], to: [2, 2, 1] });
    runTool(page, "use_journal", { publisher: "American Physical Society", width: "1/2" });
    expect(calls).toEqual([
      ["add", "Nb", "Nb", 3.2],
      ["change", "Nb–Nb", { thickness: 0.22, fillTriangles: true, triangleColour: "#2f6fd6" }],
      ["view", { along: [0, 0, 1] }],
      ["cells", [0, 0, 0], [2, 2, 1]],
      ["journal", { publisher: "American Physical Society", width: "1/2" }],
    ]);
    // Polyhedra are set under Structure, and the reply says so.
    const poly = runTool(page, "change_bonds", { between: "Ti–O", polyhedra: true, polyhedron_look: "line art", polyhedron_colour: "#5f89b8" });
    expect(calls[calls.length - 1]).toEqual(["change", "Ti–O", { polyhedra: true, polyhedronLook: "line art", polyhedronColour: "#5f89b8" }]);
    expect(poly.text).toMatch(/polyhedra drawn, line art polyhedra, polyhedron colour #5f89b8/);
    expect(poly.text).toMatch(/Structure › Bonds/);
    expect(runTool(page, "set_element", { element: "Xx", colour: "#000000" })).toEqual({ text: "No element Xx in this structure.", isError: true });
    expect(runTool(page, "add_bonds", { between: "Nb", up_to: 3 }).isError).toBe(true);
    expect(runTool(page, "set_element", { element: "all", colour: "#ffffff" }).text).toMatch(/atomMaterial/);
    expect(runTool(page, "add_bonds", { between: "Nb-Se", up_to: 50 }).isError).toBe(true);
    expect(runTool(page, "set_cells", { from: [0, 0], to: [1, 1, 1] }).isError).toBe(true);
    expect(runTool(page, "nope", {}).isError).toBe(true);
  });

  it("numbers outside the panel's limits are refused with what was probably meant; cells errors quote the values", () => {
    const { page, calls } = fakePage({ setCells: () => 'Each "from" must be below its "to".' });
    const r = runTool(page, "change_settings", { changes: { axesHead: "0", legendSize: 1.5 } });
    expect(r.text).toMatch(/Out of range: axesHead = "0", but it takes 0.2 to 4 \(to hide the axis arrows use showAxes false\)/);
    expect(calls).toEqual([["settings", { legendSize: 1.5 }]]);
    expect(runTool(page, "set_cells", { from: [0, 0, 0], to: [3, 3, 0] }).text).toMatch(/Received from \(0, 0, 0\) to \(3, 3, 0\)/);
    // Every range is the panel field's own (low below high, both finite).
    for (const k of KNOBS) if (k.range) expect(k.range[0] < k.range[1], k.name).toBe(true);
  });

  it("moments and saving reach the page as stated; incomplete moments are refused, not guessed", () => {
    const { page, calls } = fakePage();
    expect(runTool(page, "set_moments", { moments: [{ element: "mn", size: 5, along: [0, 0, 1], where: { axis: "c", at: 0.5 } }] }).text).toMatch(/Done: moments set by hand/);
    expect(runTool(page, "set_moments", { moments: [{ element: "Mn", along: [0, 0, 1] }] }).isError).toBe(true);
    expect(runTool(page, "set_moments", { moments: [{ element: "Mn", size: 5, along: [0, 1] }] }).isError).toBe(true);
    expect(runTool(page, "set_moments", { moments: [{ element: "Mn", size: 5, along: [0, 0, 1], where: { axis: "z", at: 0 } }] }).isError).toBe(true);
    runTool(page, "clear_moments", {});
    expect(runTool(page, "save_structure", { format: "VASP", file_name: "mine" }).text).toMatch(/saved mine.cif/);
    expect(runTool(page, "save_structure", { format: "pdf" }).isError).toBe(true);
    expect(calls).toEqual([
      ["moments", [{ element: "Mn", size: 5, along: [0, 0, 1], where: { axis: "c", at: 0.5 } }]],
      ["clear"],
      ["save", "poscar", "mine"],
    ]);
  });

  it("with no structure open, only the settings tools work", () => {
    const { page } = fakePage({ hasStructure: () => false });
    expect(runTool(page, "describe_figure", {}).isError).toBe(true);
    expect(runTool(page, "find_setting", { words: "legend" }).isError).toBeUndefined();
  });

  it("reads pairs written in several ways", () => {
    expect(splitPair("nb-se")).toEqual(["Nb", "Se"]);
    expect(splitPair("Ga–Se")).toEqual(["Ga", "Se"]);
    expect(splitPair("Ga to Se")).toEqual(["Ga", "Se"]);
    expect(splitPair("Nb")).toBeNull();
  });
});
