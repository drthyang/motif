// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The assistant's tools: what a model may ask the page to do, and how each request is carried out.
 *
 * The tools change how the figure looks and is laid out, the way a person does in the side panel (the user's
 * scope for the first version, 2026-11-24): settings, element colours and sizes, bonds and their look, the view,
 * the cells shown, a journal template. They do not open files or save figures. Each answer says what changed and
 * where that knob is on the page, so the user learns where to find it.
 *
 * The tools speak to the page through `Page`, which App.tsx provides; the tests give a stand-in.
 */

import { KNOBS, knob, NOT_FOR_ASSISTANT } from "./catalogue";

/** A bond rule as the assistant sees it. */
export interface BondView {
  readonly between: string;
  readonly upTo: number;
  readonly count: number;
  readonly colour: string;
  readonly thickness: number;
  readonly line: string;
  readonly colouring: string;
  readonly fillTriangles: boolean;
  readonly triangleColour?: string;
  readonly highlight: boolean;
}

/** The figure as the assistant sees it. */
export interface FigureState {
  readonly file: string;
  readonly format: string;
  readonly cell: string;
  readonly elements: readonly { readonly element: string; readonly count: number; readonly colour: string; readonly radius: number; readonly hidden: boolean }[];
  readonly bonds: readonly BondView[];
  /** Pairs that could be bonded, with their shortest distances (angstrom). */
  readonly pairs: readonly { readonly between: string; readonly distances: readonly number[] }[];
  readonly cells: string;
  readonly view: string;
  readonly canvas: string;
  readonly journal: string;
  readonly settings: Readonly<Record<string, unknown>>;
}

/** What the page offers the tools. Each change returns an error sentence, or null when it was made. */
export interface Page {
  readonly hasStructure: () => boolean;
  readonly describe: () => FigureState;
  /** Applies settings through the page's own checks; returns the names that were not used. */
  readonly applySettings: (values: Record<string, unknown>) => string[];
  readonly setElement: (element: string, change: { colour?: string; radius?: number; hidden?: boolean }) => string | null;
  readonly addBonds: (centre: string, neighbour: string, upTo: number) => string | null;
  readonly changeBonds: (between: string, change: BondChange) => string | null;
  readonly removeBonds: (between: string) => string | null;
  readonly setView: (view: ViewRequest) => string | null;
  readonly setCells: (from: readonly number[], to: readonly number[]) => string | null;
  readonly useJournal: (request: { publisher?: string; journal?: string; column?: string; width?: string }) => string | null;
}

export interface BondChange {
  readonly upTo?: number;
  readonly colour?: string;
  readonly thickness?: number;
  readonly line?: "solid" | "dashed" | "dotted";
  readonly colouring?: "one colour" | "atom colours";
  readonly fillTriangles?: boolean;
  readonly triangleColour?: string;
  readonly highlight?: boolean;
}

export interface ViewRequest {
  readonly along?: readonly number[];
  readonly normalTo?: readonly number[];
  readonly preset?: string;
  readonly up?: "a" | "b" | "c";
  readonly turn?: number;
  readonly tilt?: number;
  readonly roll?: number;
}

/** A tool as the Messages API describes one. */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly input_schema: { readonly type: "object"; readonly properties: Record<string, unknown>; readonly required?: readonly string[] };
}

const colour = { type: "string", description: 'a colour "#rrggbb"' };

export const TOOLS: readonly ToolSpec[] = [
  {
    name: "describe_figure",
    description: "What is on the page now: the file, its elements with colours and sizes, the bonds and their look, the pairs that could be bonded with their distances, the cells shown, the view, the canvas, the journal template and every setting's value. Call it first.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "find_setting",
    description: "Find the settings that match some words (\"glass\", \"legend size\", \"cell lines\"), with where each is on the page and the values it takes.",
    input_schema: { type: "object", properties: { words: { type: "string" } }, required: ["words"] },
  },
  {
    name: "change_settings",
    description: "Change settings by name, as find_setting lists them, e.g. {\"atomMaterial\": \"glass\", \"showCell\": false}. Values must be of the kind find_setting gives.",
    input_schema: { type: "object", properties: { changes: { type: "object", description: "setting name -> new value" } }, required: ["changes"] },
  },
  {
    name: "set_element",
    description: "Change one element's colour or sphere radius (angstrom), or hide or show its atoms.",
    input_schema: { type: "object", properties: { element: { type: "string" }, colour, radius: { type: "number" }, hidden: { type: "boolean" } }, required: ["element"] },
  },
  {
    name: "add_bonds",
    description: "Draw bonds between two elements up to a distance (angstrom). Choose the distance from the pairs describe_figure lists.",
    input_schema: { type: "object", properties: { between: { type: "string", description: 'two elements, e.g. "Nb-Nb" or "Ga-Se"' }, up_to: { type: "number" } }, required: ["between", "up_to"] },
  },
  {
    name: "change_bonds",
    description: "Change one kind of bond: its distance limit, colour, thickness (angstrom), line, colouring, filled triangles (three mutually bonded atoms, e.g. the faces of a cluster) and their colour, or a highlight band.",
    input_schema: {
      type: "object",
      properties: {
        between: { type: "string" },
        up_to: { type: "number" },
        colour,
        thickness: { type: "number" },
        line: { type: "string", enum: ["solid", "dashed", "dotted"] },
        colouring: { type: "string", enum: ["one colour", "atom colours"] },
        fill_triangles: { type: "boolean" },
        triangle_colour: colour,
        highlight: { type: "boolean" },
      },
      required: ["between"],
    },
  },
  {
    name: "remove_bonds",
    description: "Stop drawing one kind of bond, e.g. \"Nb-Se\" (the atoms stay).",
    input_schema: { type: "object", properties: { between: { type: "string" } }, required: ["between"] },
  },
  {
    name: "set_view",
    description: "Turn the structure: look along a direction [u v w] or normal to a plane (h k l), use a preset (standard, clinographic, isometric, 110, 1-10), or give the up axis with turn, tilt and roll in degrees.",
    input_schema: {
      type: "object",
      properties: {
        along: { type: "array", items: { type: "number" }, description: "[u, v, w]" },
        normal_to: { type: "array", items: { type: "number" }, description: "(h, k, l)" },
        preset: { type: "string", enum: ["standard", "clinographic", "isometric", "110", "1-10"] },
        up: { type: "string", enum: ["a", "b", "c"] },
        turn: { type: "number" },
        tilt: { type: "number" },
        roll: { type: "number" },
      },
    },
  },
  {
    name: "set_cells",
    description: "The part of the crystal drawn: from and to along a, b, c in cell edges, e.g. from [0,0,0] to [2,2,1] for 2 x 2 x 1 cells.",
    input_schema: { type: "object", properties: { from: { type: "array", items: { type: "number" } }, to: { type: "array", items: { type: "number" } } }, required: ["from", "to"] },
  },
  {
    name: "use_journal",
    description: "Size the figure for a journal: publisher, journal, column, and the share of the column width (\"full\", \"1/2\", \"1/3\" or \"1/4\"). Sets the width on paper and the journal's text size.",
    input_schema: { type: "object", properties: { publisher: { type: "string" }, journal: { type: "string" }, column: { type: "string" }, width: { type: "string" } } },
  },
];

const BOND_PLACE = "Structure › Bonds (distance), Visual › Bonds (look)";

/** A change in plain words: {colour: "#ff0000", radius: 0.4} -> "colour #ff0000, radius 0.4 Å". */
function inWords(change: Record<string, unknown>): string {
  const say: Record<string, (v: unknown) => string> = {
    colour: (v) => `colour ${v}`,
    radius: (v) => `radius ${v} Å`,
    hidden: (v) => (v ? "hidden" : "shown"),
    upTo: (v) => `up to ${v} Å`,
    thickness: (v) => `thickness ${v} Å`,
    line: (v) => `${v} line`,
    colouring: (v) => `${v}`,
    fillTriangles: (v) => (v ? "triangles filled" : "triangles not filled"),
    triangleColour: (v) => `triangle colour ${v}`,
    highlight: (v) => (v ? "highlight band" : "no highlight band"),
    along: (v) => `along [${(v as number[]).join(" ")}]`,
    normalTo: (v) => `normal to (${(v as number[]).join(" ")})`,
    preset: (v) => `${v} view`,
    up: (v) => `${v} up`,
    turn: (v) => `turn ${v}°`,
    tilt: (v) => `tilt ${v}°`,
    roll: (v) => `roll ${v}°`,
  };
  return Object.entries(change).map(([k, v]) => (say[k] ? say[k](v) : `${k} ${JSON.stringify(v)}`)).join(", ");
}
const done = (what: string, place: string) => `Done: ${what}. On the page: ${place}.`;

/** Words of a setting, for find_setting. */
const searchable = (k: (typeof KNOBS)[number]) => `${k.name} ${k.says} ${k.place}`.toLowerCase();

/** Carry out one tool call; the answer is the text the model reads back. */
export function runTool(page: Page, name: string, input: Record<string, unknown>): { text: string; isError?: boolean } {
  const fail = (text: string) => ({ text, isError: true });
  if (name !== "find_setting" && name !== "change_settings" && !page.hasStructure()) return fail("No structure is open. Ask the user to open a file or pick an example first.");
  switch (name) {
    case "describe_figure":
      return { text: JSON.stringify(page.describe(), null, 1) };
    case "find_setting": {
      const words = String(input["words"] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const found = KNOBS.map((k) => ({ k, score: words.filter((w) => searchable(k).includes(w)).length })).filter((x) => x.score > 0);
      found.sort((a, b) => b.score - a.score);
      if (found.length === 0) return { text: `No setting matches "${input["words"]}". Element colours and sizes: set_element. Bonds: add_bonds, change_bonds. View: set_view. Cells: set_cells. Journal: use_journal.` };
      return { text: found.slice(0, 8).map(({ k }) => `${k.name} (${k.place}): ${k.says}; values: ${k.values}`).join("\n") };
    }
    case "change_settings": {
      const changes = input["changes"];
      if (typeof changes !== "object" || changes === null || Array.isArray(changes)) return fail('Give "changes" as an object of setting name -> value.');
      const entries = Object.entries(changes as Record<string, unknown>);
      const unknown = entries.filter(([n]) => !knob(n) || NOT_FOR_ASSISTANT.includes(n)).map(([n]) => n);
      const known = Object.fromEntries(entries.filter(([n]) => !unknown.includes(n)));
      const skipped = Object.keys(known).length ? page.applySettings(known) : [];
      const applied = Object.keys(known).filter((n) => !skipped.includes(n));
      const lines: string[] = [];
      if (applied.length) lines.push(`Done: ${applied.map((n) => `${n} = ${JSON.stringify(known[n])} (${knob(n)!.place})`).join("; ")}.`);
      if (skipped.length) lines.push(`Not a usable value: ${skipped.map((n) => `${n} (takes ${knob(n)!.values})`).join("; ")}.`);
      if (unknown.length) lines.push(`No such setting: ${unknown.join(", ")}. Use find_setting.`);
      return { text: lines.join("\n"), ...(applied.length ? {} : { isError: true }) };
    }
    case "set_element": {
      const element = String(input["element"] ?? "");
      const change = {
        ...(typeof input["colour"] === "string" ? { colour: input["colour"] as string } : {}),
        ...(typeof input["radius"] === "number" ? { radius: input["radius"] as number } : {}),
        ...(typeof input["hidden"] === "boolean" ? { hidden: input["hidden"] as boolean } : {}),
      };
      if (Object.keys(change).length === 0) return fail("Give a colour, a radius or hidden.");
      const error = page.setElement(element, change);
      return error ? fail(error) : { text: done(`${element}: ${inWords(change)}`, change.hidden === undefined ? "Visual › Atoms" : "Structure › Elements shown") };
    }
    case "add_bonds": {
      const pair = splitPair(String(input["between"] ?? ""));
      const upTo = Number(input["up_to"]);
      if (!pair) return fail('Name two elements, e.g. "Nb-Nb".');
      if (!(upTo > 0 && upTo <= 10)) return fail("up_to must be a distance in angstrom between 0 and 10.");
      const error = page.addBonds(pair[0], pair[1], upTo);
      return error ? fail(error) : { text: done(`${pair.join("–")} bonds up to ${upTo} Å`, "Structure › Bonds (their look: Visual › Bonds)") };
    }
    case "change_bonds": {
      const between = String(input["between"] ?? "");
      const change: BondChange = {
        ...(typeof input["up_to"] === "number" ? { upTo: input["up_to"] } : {}),
        ...(typeof input["colour"] === "string" ? { colour: input["colour"] } : {}),
        ...(typeof input["thickness"] === "number" ? { thickness: input["thickness"] } : {}),
        ...(typeof input["line"] === "string" ? { line: input["line"] as NonNullable<BondChange["line"]> } : {}),
        ...(typeof input["colouring"] === "string" ? { colouring: input["colouring"] as NonNullable<BondChange["colouring"]> } : {}),
        ...(typeof input["fill_triangles"] === "boolean" ? { fillTriangles: input["fill_triangles"] } : {}),
        ...(typeof input["triangle_colour"] === "string" ? { triangleColour: input["triangle_colour"] } : {}),
        ...(typeof input["highlight"] === "boolean" ? { highlight: input["highlight"] } : {}),
      };
      if (Object.keys(change).length === 0) return fail("Say what to change about these bonds.");
      const error = page.changeBonds(between, change);
      // Only the place of what changed: the distance limit is under Structure, the look under Visual.
      const place = change.upTo !== undefined && Object.keys(change).length === 1 ? "Structure › Bonds" : change.upTo !== undefined ? BOND_PLACE : "Visual › Bonds";
      return error ? fail(error) : { text: done(`${between} bonds: ${inWords(change as Record<string, unknown>)}`, place) };
    }
    case "remove_bonds": {
      const error = page.removeBonds(String(input["between"] ?? ""));
      return error ? fail(error) : { text: done(`${input["between"]} bonds removed`, "Structure › Bonds") };
    }
    case "set_view": {
      const req: ViewRequest = {
        ...(Array.isArray(input["along"]) ? { along: input["along"] as number[] } : {}),
        ...(Array.isArray(input["normal_to"]) ? { normalTo: input["normal_to"] as number[] } : {}),
        ...(typeof input["preset"] === "string" ? { preset: input["preset"] } : {}),
        ...(typeof input["up"] === "string" ? { up: input["up"] as NonNullable<ViewRequest["up"]> } : {}),
        ...(typeof input["turn"] === "number" ? { turn: input["turn"] } : {}),
        ...(typeof input["tilt"] === "number" ? { tilt: input["tilt"] } : {}),
        ...(typeof input["roll"] === "number" ? { roll: input["roll"] } : {}),
      };
      if (Object.keys(req).length === 0) return fail("Give a direction, a plane, a preset, or turn/tilt/roll.");
      const error = page.setView(req);
      return error ? fail(error) : { text: done(`view ${inWords(req as Record<string, unknown>)}`, "Layout › Direction, or the buttons over the figure") };
    }
    case "set_cells": {
      const from = input["from"];
      const to = input["to"];
      const ok = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x));
      if (!ok(from) || !ok(to)) return fail("from and to must each be three numbers.");
      const error = page.setCells(from as number[], to as number[]);
      return error ? fail(error) : { text: done(`cells from (${(from as number[]).join(", ")}) to (${(to as number[]).join(", ")})`, "Structure › Cells shown") };
    }
    case "use_journal": {
      const req = Object.fromEntries(["publisher", "journal", "column", "width"].filter((k) => typeof input[k] === "string").map((k) => [k, input[k] as string]));
      if (Object.keys(req).length === 0) return fail("Name at least a publisher or a journal.");
      const error = page.useJournal(req);
      return error ? fail(error) : { text: done(`journal template ${Object.values(req).join(", ")}`, "Layout › Canvas") };
    }
    default:
      return fail(`There is no tool "${name}".`);
  }
}

/** "Nb-Nb", "Nb–Nb", "Nb Nb", "Ga to Se" -> ["Nb", "Nb"]. */
export function splitPair(text: string): [string, string] | null {
  const parts = text.split(/\s*(?:[-–—\/]|\s+to\s+|\s+and\s+|\s+)\s*/).filter(Boolean);
  if (parts.length !== 2) return null;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return [cap(parts[0]!), cap(parts[1]!)];
}
