// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The MCP server's tools, in one list: name, title, description, input schema and handler.
 *
 * Shaped like MATERIA's registry (web-refinement, src/mcp/registry.ts, the user's own code): the host serves this
 * list in a loop and adds nothing of its own. Most tools are the in-page assistant's (agent/tools.ts), with the same
 * descriptions, schemas, checks and answers, carried out on a `Figure` instead of the page. The server adds what the
 * page does by hand: opening a file (from the server's folders) or a feature example, and saving the structure and
 * the figure (SVG) into a folder.
 */

import { z } from "zod";
import { runTool, TOOLS, type ToolSpec } from "../agent/tools";
import { readFeatures, type FeatureExample } from "../ui/examples";
import type { StructureFormat } from "../structure/writeStructure";
import { Figure } from "./figure";
import { readAllowedFile, writeAllowedFile } from "./files";

/** What a handler works on: the one figure, the folders it may use, and where the feature examples are. */
export interface Context {
  readonly figure: Figure;
  readonly roots: readonly string[];
  /** The feature examples: features.json and the files it names, by file name (built into the bundle). */
  readonly examples: Readonly<Record<string, string>>;
}

export interface Answer {
  readonly text: string;
  readonly isError?: boolean;
}

export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Record<string, z.ZodType>;
  readonly handler: (ctx: Context, args: Record<string, unknown>) => Promise<Answer>;
}

/** A Zod type for the small JSON Schemas of agent/tools.ts (object, array, string with enum, number, boolean). */
export function zodOf(schema: Record<string, unknown>): z.ZodType {
  const described = (t: z.ZodType): z.ZodType => (typeof schema["description"] === "string" ? t.describe(schema["description"]) : t);
  switch (schema["type"]) {
    case "string": {
      const choices = schema["enum"] as string[] | undefined;
      return described(choices ? z.enum(choices as [string, ...string[]]) : z.string());
    }
    case "number":
      return described(z.number());
    case "boolean":
      return described(z.boolean());
    case "array":
      return described(z.array(schema["items"] ? zodOf(schema["items"] as Record<string, unknown>) : z.any()));
    case "object": {
      const properties = schema["properties"] as Record<string, Record<string, unknown>> | undefined;
      if (!properties) return described(z.record(z.string(), z.any()));
      return described(z.object(shapeOf(schema as ToolSpec["input_schema"])));
    }
    default:
      return described(z.any());
  }
}

/** The raw shape of a tool's input: each property, optional unless required. */
export function shapeOf(schema: ToolSpec["input_schema"]): Record<string, z.ZodType> {
  const required = new Set(schema.required ?? []);
  return Object.fromEntries(Object.entries(schema.properties).map(([k, s]) => [k, required.has(k) ? zodOf(s as Record<string, unknown>) : zodOf(s as Record<string, unknown>).optional()]));
}

const TITLES: Readonly<Record<string, string>> = {
  describe_figure: "Describe the figure",
  find_setting: "Find a setting",
  change_settings: "Change settings",
  set_element: "Element colour, size, shown",
  add_bonds: "Add bonds",
  change_bonds: "Change bonds",
  remove_bonds: "Remove bonds",
  set_view: "Set the view",
  set_cells: "Cells shown",
  use_journal: "Journal template",
  set_moments: "Moments by hand",
  mark_angles: "Mark bond angles",
  clear_angles: "Clear angle marks",
  clear_moments: "Clear moments by hand",
  set_orbitals: "Orbitals on a species",
  remove_orbitals: "Remove orbitals",
};

/** The in-page assistant's tools, as they are (save_structure is the server's own, below). */
const PAGE_TOOLS: ToolDefinition[] = TOOLS.filter((t) => t.name !== "save_structure").map((t) => ({
  name: t.name,
  title: TITLES[t.name] ?? t.name,
  description: t.description,
  inputSchema: shapeOf(t.input_schema),
  handler: async (ctx, args) => runTool(ctx.figure, t.name, args),
}));

const FOLDER = z.string().optional().describe("Folder to write into, inside the server's folders (created if missing); relative paths start from the first. Default: the first folder.");
const OVERWRITE = z.boolean().optional().describe("Replace a file of the same name (default false)");
const FILE_NAME = z.string().optional().describe("File name without its extension (default: the name of the file opened)");

function features(examples: Readonly<Record<string, string>>): FeatureExample[] {
  const text = examples["features.json"];
  if (text === undefined) throw new Error("The feature examples are missing from this server.");
  return readFeatures(text, Object.keys(examples));
}

const opened = (figure: Figure): string => {
  const d = figure.describe();
  const elements = d.elements.map((e) => `${e.element} ${e.count}`).join(", ");
  const bonds = d.bonds.map((b) => `${b.between} up to ${b.upTo} Å`).join(", ") || "none";
  return `Opened ${d.file} (${d.format}): ${d.cell}. Drawn: ${elements}; bonds ${bonds}. View: ${d.view}. Canvas: ${d.canvas}. Call describe_figure for more.`;
};

const SERVER_TOOLS: ToolDefinition[] = [
  {
    name: "open_file",
    title: "Open a structure file",
    description:
      "Open a structure file from the server's folders, as the page opens a file: CIF, magnetic CIF, ISODISTORT CIF, RMCProfile .rmc6f, VASP POSCAR/CONTCAR, XYZ and extended XYZ, SHELX .res/.ins, PDB, Quantum ESPRESSO input, CASTEP .cell, FHI-aims geometry.in, XSF. It replaces the figure: one cell, bonds suggested, the opening view, the settings kept. An RMC configuration opens as its whole supercell unless `fold` (each site the plain average of its copies, in one cell).",
    inputSchema: {
      path: z.string().describe("The file: relative to the server's folders, or absolute inside one"),
      fold: z.boolean().optional().describe("RMC configuration only: fold into one averaged cell (default false)"),
    },
    handler: async (ctx, args) => {
      const file = await readAllowedFile(String(args["path"]), ctx.roots);
      ctx.figure.open(file.text, file.name, args["fold"] === true);
      return { text: opened(ctx.figure) };
    },
  },
  {
    name: "open_example",
    title: "Open a feature example",
    description:
      "Open one of MOTIF's feature examples (published or generated structures) with the settings that show its feature, as the page's numbered cards do: 1 coordination polyhedra (LaMnO3), 2 magnetic structure (MnF2), 3 distortion mode (SrTiO3), 4 orbital order (LaMnO3), 5 RMC configuration (SrTiO3 supercell).",
    inputSchema: { number: z.number().int().min(1).describe("1 to 5, as listed") },
    handler: async (ctx, args) => {
      const list = features(ctx.examples);
      const f = list[Number(args["number"]) - 1];
      if (!f) return { text: `There are ${list.length} examples: ${list.map((x, i) => `${i + 1} ${x.title}`).join(", ")}.`, isError: true };
      ctx.figure.openFeature(f, ctx.examples[f.file]!);
      return { text: `${f.title}: ${f.note}. ${opened(ctx.figure)}` };
    },
  },
  {
    name: "save_figure",
    title: "Save the figure (SVG)",
    description:
      "Write the figure as an SVG file, exactly as the page's Save › SVG writes it (vector, the size on paper stated, the fonts named, not embedded). Returns where it was written.",
    inputSchema: { file_name: FILE_NAME, folder: FOLDER, overwrite: OVERWRITE },
    handler: async (ctx, args) => {
      if (!ctx.figure.hasStructure()) return { text: "No structure is open. Open a file or an example first.", isError: true };
      const svg = ctx.figure.svg();
      const base = typeof args["file_name"] === "string" && args["file_name"] !== "" ? String(args["file_name"]).replace(/\.svg$/i, "") : ctx.figure.baseName();
      const out = await writeAllowedFile(String(args["folder"] ?? "."), `${base}.svg`, svg, args["overwrite"] === true, ctx.roots);
      return { text: `Done: saved the figure to ${out.path} (${out.bytes} bytes, ${ctx.figure.describe().canvas}).` };
    },
  },
  {
    name: "save_structure",
    title: "Save the structure",
    description:
      "Write the structure as a file: every atom of one unit cell (no symmetry), in \"cif\", \"poscar\" (VASP), \"xyz\" or \"extxyz\" (extended XYZ, keeps the cell). POSCAR and XYZ refuse partly occupied or shared sites; moments are not written.",
    inputSchema: {
      format: z.enum(["cif", "poscar", "xyz", "extxyz"]),
      file_name: FILE_NAME,
      folder: FOLDER,
      overwrite: OVERWRITE,
    },
    handler: async (ctx, args) => {
      if (!ctx.figure.hasStructure()) return { text: "No structure is open. Open a file or an example first.", isError: true };
      const written = ctx.figure.structureFile(String(args["format"]) as StructureFormat, typeof args["file_name"] === "string" ? String(args["file_name"]) : undefined);
      const out = await writeAllowedFile(String(args["folder"] ?? "."), written.name, written.text, args["overwrite"] === true, ctx.roots);
      return { text: `Done: saved ${written.applied}, to ${out.path}.` };
    },
  },
];

export const TOOL_REGISTRY: readonly ToolDefinition[] = [...SERVER_TOOLS, ...PAGE_TOOLS];
