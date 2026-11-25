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
import type { MomentRule } from "../structure/handMoments";
import type { StructureFormat } from "../structure/writeStructure";

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
  /** "off", or the look of the coordination polyhedra round the centre atoms ("glass", "solid", "line art"). */
  readonly polyhedra: string;
  readonly polyhedronColour?: string;
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
  /** The magnetic moments: none, from the file, or added by hand (with what was stated). */
  readonly moments: string;
  /** Bond angles that can be marked (between drawn bonds, with their sizes) and those marked now. */
  readonly angles: string;
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
  /** Applies a journal template; returns an error sentence, or what was applied in words (so the model reports the truth). */
  readonly useJournal: (request: { publisher?: string; journal?: string; column?: string; width?: string }) => { error: string } | { applied: string };
  /** Sets moments by hand (handMoments.ts); returns an error sentence, or what was set in words. */
  readonly setMoments: (rules: readonly MomentRule[]) => { error: string } | { applied: string };
  readonly clearMoments: () => string | null;
  /** Marks a kind of bond angle (end–apex–end); returns an error sentence, or what was marked in words. */
  readonly markAngles: (request: { ends: [string, string]; apex: string; min?: number; max?: number; colour?: string; labels?: boolean }) => { error: string } | { applied: string };
  /** Removes the marks of one kind of angle, or of all when none is named. */
  readonly clearAngles: (request?: { ends: [string, string]; apex: string }) => string | null;
  /** Saves the structure's unit cell in a format, downloaded by the browser; returns an error, or what was saved. */
  readonly saveStructure: (format: StructureFormat, fileName?: string) => { error: string } | { applied: string };
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
  readonly polyhedra?: boolean;
  readonly polyhedronLook?: "glass" | "solid" | "line art";
  readonly polyhedronColour?: string;
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
    description: "Change one kind of bond: its distance limit, colour, thickness (angstrom), line, colouring, filled triangles (three mutually bonded atoms, e.g. the faces of a cluster) and their colour, a highlight band, or coordination polyhedra round the first element of the pair (e.g. TiO6 octahedra for \"Ti-O\"): on or off, their look and colour.",
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
        polyhedra: { type: "boolean" },
        polyhedron_look: { type: "string", enum: ["glass", "solid", "line art"] },
        polyhedron_colour: colour,
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
  {
    name: "set_moments",
    description:
      "Add magnetic moments by hand, as the user states them: for each, an element, a size in Bohr magnetons (0 to 15) and a direction as a crystal direction [u v w]; optionally only the atoms at one fractional coordinate along a, b or c (e.g. where {axis: \"c\", at: 0.5}). Set on those atoms of one unit cell only, nothing spread by symmetry; later entries win. Ask the user for any size or direction they have not given; never make one up.",
    input_schema: {
      type: "object",
      properties: {
        moments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              element: { type: "string" },
              size: { type: "number", description: "μB" },
              along: { type: "array", items: { type: "number" }, description: "[u, v, w]" },
              where: { type: "object", properties: { axis: { type: "string", enum: ["a", "b", "c"] }, at: { type: "number" } } },
            },
            required: ["element", "size", "along"],
          },
        },
      },
      required: ["moments"],
    },
  },
  {
    name: "mark_angles",
    description:
      "Mark and label bond angles, e.g. \"O-Mn-O\" (the middle element is the atom at the corner). Angles exist only between drawn bonds: describe_figure lists those that can be marked, with their sizes. Optionally only angles from min to max degrees, a colour, and labels (the value written beside each mark, on by default).",
    input_schema: {
      type: "object",
      properties: { angle: { type: "string", description: 'end-apex-end, e.g. "O-Mn-O"' }, min: { type: "number" }, max: { type: "number" }, colour, labels: { type: "boolean" } },
      required: ["angle"],
    },
  },
  {
    name: "clear_angles",
    description: "Remove the marks of one kind of bond angle (e.g. \"O-Mn-O\"), or of all marked angles when none is named.",
    input_schema: { type: "object", properties: { angle: { type: "string" } } },
  },
  {
    name: "clear_moments",
    description: "Remove the moments added by hand (moments read from the file stay).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "save_structure",
    description: "Save the structure as a file the browser downloads: every atom of one unit cell (no symmetry), in \"cif\", \"poscar\" (VASP), \"xyz\" or \"extxyz\" (extended XYZ, keeps the cell). Optionally a file name without its extension.",
    input_schema: { type: "object", properties: { format: { type: "string", enum: ["cif", "poscar", "xyz", "extxyz"] }, file_name: { type: "string" } }, required: ["format"] },
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
    polyhedra: (v) => (v ? "polyhedra drawn" : "no polyhedra"),
    polyhedronLook: (v) => `${v} polyhedra`,
    polyhedronColour: (v) => `polyhedron colour ${v}`,
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
      // Words split on any punctuation ("text,size" is two words); a plural also finds the singular.
      const words = String(input["words"] ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 || /\d/.test(w));
      const hit = (k: (typeof KNOBS)[number], w: string) => searchable(k).includes(w) || (w.endsWith("s") && searchable(k).includes(w.slice(0, -1)));
      const found = KNOBS.map((k) => ({ k, score: words.filter((w) => hit(k, w)).length })).filter((x) => x.score > 0);
      found.sort((a, b) => b.score - a.score);
      if (found.length === 0) return { text: `No setting matches "${input["words"]}". Element colours and sizes: set_element. Bonds: add_bonds, change_bonds. View: set_view. Cells: set_cells. Journal: use_journal.` };
      return { text: found.slice(0, 8).map(({ k }) => `${k.name} (${k.place}): ${k.says}; values: ${k.values}`).join("\n") };
    }
    case "change_settings": {
      const changes = input["changes"];
      if (typeof changes !== "object" || changes === null || Array.isArray(changes)) return fail('Give "changes" as an object of setting name -> value.');
      const entries = Object.entries(changes as Record<string, unknown>);
      const unknown = entries.filter(([n]) => !knob(n) || NOT_FOR_ASSISTANT.includes(n)).map(([n]) => n);
      // Numbers outside the panel field's own limits are refused before the page sees them (the page keeps such fields
      // as text and would take "0"), with what the user may have meant instead.
      const outOfRange = entries.filter(([n, v]) => {
        const k = knob(n);
        if (!k?.range) return false;
        const x = Number(v);
        return v === "" || !Number.isFinite(x) || x < k.range[0] || x > k.range[1];
      });
      const known: Record<string, unknown> = Object.fromEntries(entries.filter(([n]) => !unknown.includes(n) && !outOfRange.some(([m]) => m === n)));
      let skipped = Object.keys(known).length ? page.applySettings(known) : [];
      // A value refused as written is tried once more in the form the page keeps: 8 as "8" where text is kept
      // (text sizes, lengths), "true" as true, "60" as 60. A model (or a person) writes such values naturally.
      const retry = Object.fromEntries(skipped.map((n) => [n, naturalForm(known[n])]).filter(([n, v]) => JSON.stringify(v) !== JSON.stringify(known[n as string])));
      const retried = Object.keys(retry).length ? page.applySettings(retry) : [];
      for (const n of Object.keys(retry)) if (!retried.includes(n)) known[n] = retry[n];
      skipped = skipped.filter((n) => !(n in retry) || retried.includes(n));
      const applied = Object.keys(known).filter((n) => !skipped.includes(n));
      const lines: string[] = [];
      if (applied.length) lines.push(`Done: ${applied.map((n) => `${n} = ${JSON.stringify(known[n])} (${knob(n)!.place})`).join("; ")}.`);
      if (skipped.length) lines.push(`Not a usable value: ${skipped.map((n) => `${n} = ${JSON.stringify(known[n])}, but it takes ${knob(n)!.values}`).join("; ")}.`);
      if (outOfRange.length) lines.push(`Out of range: ${outOfRange.map(([n, v]) => `${n} = ${JSON.stringify(v)}, but it takes ${knob(n)!.range![0]} to ${knob(n)!.range![1]}${knob(n)!.instead ? ` (${knob(n)!.instead})` : ""}`).join("; ")}.`);
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
      // "all" or "atoms" is not an element: point to the settings that act on every atom (a small model did this).
      if (/^(all|every|atoms?|all atoms|everything)$/i.test(element.trim())) {
        return fail('"' + element + '" is not an element. For every atom use change_settings: atomMaterial for the surface ("glass", "metal", ...), and set_element once per element for colours and sizes.');
      }
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
        ...(typeof input["polyhedra"] === "boolean" ? { polyhedra: input["polyhedra"] } : {}),
        ...(typeof input["polyhedron_look"] === "string" ? { polyhedronLook: input["polyhedron_look"] as NonNullable<BondChange["polyhedronLook"]> } : {}),
        ...(typeof input["polyhedron_colour"] === "string" ? { polyhedronColour: input["polyhedron_colour"] } : {}),
      };
      if (Object.keys(change).length === 0) return fail("Say what to change about these bonds.");
      const error = page.changeBonds(between, change);
      // Only the place of what changed: the distance limit and the polyhedra are under Structure, the look under Visual.
      const underStructure = ["upTo", "polyhedra", "polyhedronLook", "polyhedronColour"];
      const keys = Object.keys(change);
      const place = keys.every((k) => underStructure.includes(k)) ? "Structure › Bonds" : keys.some((k) => underStructure.includes(k)) ? BOND_PLACE : "Visual › Bonds";
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
      return error ? fail(`${error} Received from (${(from as number[]).join(", ")}) to (${(to as number[]).join(", ")}). For n1 x n2 x n3 cells give from [0, 0, 0] to [n1, n2, n3].`) : { text: done(`cells from (${(from as number[]).join(", ")}) to (${(to as number[]).join(", ")})`, "Structure › Cells shown") };
    }
    case "use_journal": {
      const req = Object.fromEntries(["publisher", "journal", "column", "width"].filter((k) => typeof input[k] === "string").map((k) => [k, input[k] as string]));
      if (Object.keys(req).length === 0) return fail("Name at least a publisher or a journal.");
      const result = page.useJournal(req);
      return "error" in result ? fail(result.error) : { text: done(`journal template ${result.applied}`, "Layout › Canvas") };
    }
    case "set_moments": {
      const raw = input["moments"];
      if (!Array.isArray(raw) || raw.length === 0) return fail('Give "moments" as a list of {element, size, along, where?}.');
      const rules: MomentRule[] = [];
      for (const [k, m] of raw.entries()) {
        const x = (m ?? {}) as Record<string, unknown>;
        const along = x["along"];
        const where = x["where"] as { axis?: string; at?: unknown } | undefined;
        if (typeof x["element"] !== "string" || typeof x["size"] !== "number" || !Array.isArray(along) || along.length !== 3) return fail(`Moment ${k + 1} needs element, size (μB) and along [u, v, w].`);
        if (where && (!["a", "b", "c"].includes(String(where.axis)) || typeof where.at !== "number")) return fail(`Moment ${k + 1}: where must be {axis: "a" | "b" | "c", at: a number}.`);
        rules.push({
          element: x["element"].charAt(0).toUpperCase() + x["element"].slice(1).toLowerCase(),
          size: x["size"],
          along: along.map(Number) as unknown as [number, number, number],
          ...(where ? { where: { axis: where.axis as "a" | "b" | "c", at: where.at as number } } : {}),
        });
      }
      const result = page.setMoments(rules);
      return "error" in result ? fail(result.error) : { text: done(`moments set by hand: ${result.applied}`, "Visual › Moment arrows (their look)") };
    }
    case "mark_angles": {
      const parts = splitAngle(String(input["angle"] ?? ""));
      if (!parts) return fail('Name the angle as three elements, end-apex-end, e.g. "O-Mn-O".');
      const req = {
        ends: [parts[0], parts[2]] as [string, string],
        apex: parts[1],
        ...(typeof input["min"] === "number" ? { min: input["min"] as number } : {}),
        ...(typeof input["max"] === "number" ? { max: input["max"] as number } : {}),
        ...(typeof input["colour"] === "string" ? { colour: input["colour"] as string } : {}),
        ...(typeof input["labels"] === "boolean" ? { labels: input["labels"] as boolean } : {}),
      };
      const result = page.markAngles(req);
      return "error" in result ? fail(result.error) : { text: done(`angles marked: ${result.applied}`, "Structure › Angles (which), Visual › Angles (look)") };
    }
    case "clear_angles": {
      const named = typeof input["angle"] === "string" && input["angle"] !== "" ? splitAngle(input["angle"] as string) : null;
      if (typeof input["angle"] === "string" && input["angle"] !== "" && !named) return fail('Name the angle as end-apex-end, e.g. "O-Mn-O", or give none to clear all.');
      const error = page.clearAngles(named ? { ends: [named[0], named[2]], apex: named[1] } : undefined);
      return error ? fail(error) : { text: done(named ? `${named.join("–")} angle marks removed` : "all angle marks removed", "Structure › Angles") };
    }
    case "clear_moments": {
      const error = page.clearMoments();
      return error ? fail(error) : { text: done("moments added by hand removed", "the figure") };
    }
    case "save_structure": {
      const format = String(input["format"] ?? "").toLowerCase().replace(/^vasp$/, "poscar").replace(/^extended ?xyz$/, "extxyz");
      if (!["cif", "poscar", "xyz", "extxyz"].includes(format)) return fail('format must be "cif", "poscar", "xyz" or "extxyz".');
      const result = page.saveStructure(format as StructureFormat, typeof input["file_name"] === "string" ? (input["file_name"] as string) : undefined);
      return "error" in result ? fail(result.error) : { text: `Done: saved ${result.applied}. The browser downloads it.` };
    }
    default:
      return fail(`There is no tool "${name}".`);
  }
}

/**
 * The other natural form of a value, for a second try: numbers as text (and the numbers inside a list or an object),
 * or text as a number or a true/false. The page's own checks still decide.
 */
export function naturalForm(v: unknown): unknown {
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true" || t === "false") return t === "true";
    if (t !== "" && Number.isFinite(Number(t))) return Number(t);
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => (typeof x === "number" ? String(x) : x));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, typeof x === "number" ? String(x) : x]));
  return v;
}

/** "O-Mn-O", "O–Mn–O", "O Mn O" -> ["O", "Mn", "O"] (the middle is the apex). */
export function splitAngle(text: string): [string, string, string] | null {
  const parts = text.split(/\s*[-–—\/]\s*|\s+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return [cap(parts[0]!), cap(parts[1]!), cap(parts[2]!)];
}

/** "Nb-Nb", "Nb–Nb", "Nb Nb", "Ga to Se" -> ["Nb", "Nb"]. */
export function splitPair(text: string): [string, string] | null {
  const parts = text.split(/\s*(?:[-–—\/]|\s+to\s+|\s+and\s+|\s+)\s*/).filter(Boolean);
  if (parts.length !== 2) return null;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return [cap(parts[0]!), cap(parts[1]!)];
}
