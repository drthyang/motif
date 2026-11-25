// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

// The MCP server (src/mcp): files kept inside the server's folders, the tool list, and the tools through an
// in-memory MCP client. That the server's SVG is the page's, byte for byte, is checked in a real browser
// (scripts/browser_check.cjs, part 5).

import { mkdtempSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KNOBS } from "../src/agent/catalogue";
import { TOOLS } from "../src/agent/tools";
import { defaultSettings, SETTING_NAMES } from "../src/mcp/figure";
import { defaultRoots, readAllowedFile, writeAllowedFile } from "../src/mcp/files";
import { createMotifServer } from "../src/mcp/host";
import { TOOL_REGISTRY, zodOf } from "../src/mcp/registry";
import { readStructure } from "../src/structure/readStructure";

const EXAMPLES = resolve(__dirname, "..", "examples");
const OLIVINE = "olivine-FeMg_COD-1541262.cif";

describe("folders", () => {
  test("MOTIF_ROOTS, else the folder started in, but never the filesystem root or the home folder", () => {
    expect(defaultRoots(`/a${process.platform === "win32" ? ";" : ":"}/b`, "/x")).toEqual([resolve("/a"), resolve("/b")]);
    expect(defaultRoots(undefined, "/x/y")).toEqual([resolve("/x/y")]);
    expect(defaultRoots(undefined, parse(process.cwd()).root)).toEqual([]);
    expect(defaultRoots(undefined, homedir())).toEqual([]);
  });

  test("reads only inside the folders, links followed first", async () => {
    const root = mkdtempSync(join(tmpdir(), "motif-mcp-"));
    const outside = mkdtempSync(join(tmpdir(), "motif-mcp-out-"));
    writeFileSync(join(root, "a.cif"), "data_a");
    writeFileSync(join(outside, "secret.cif"), "data_secret");
    symlinkSync(join(outside, "secret.cif"), join(root, "link.cif"));
    expect((await readAllowedFile("a.cif", [root])).text).toBe("data_a");
    await expect(readAllowedFile(join(outside, "secret.cif"), [root])).rejects.toThrow(/outside/);
    await expect(readAllowedFile("link.cif", [root])).rejects.toThrow(/outside/);
    await expect(readAllowedFile("../" + parse(outside).base + "/secret.cif", [root])).rejects.toThrow(/outside/);
    await expect(readAllowedFile("missing.cif", [root])).rejects.toThrow(/No such file/);
    await expect(readAllowedFile("a.cif", [])).rejects.toThrow(/off/);
  });

  test("writes plain names inside the folders, never over a file unless asked, never through a link", async () => {
    const root = mkdtempSync(join(tmpdir(), "motif-mcp-"));
    const outside = mkdtempSync(join(tmpdir(), "motif-mcp-out-"));
    const first = await writeAllowedFile("figs/new", "a.svg", "<svg/>", false, [root]);
    expect(readFileSync(first.path, "utf8")).toBe("<svg/>");
    await expect(writeAllowedFile("figs/new", "a.svg", "x", false, [root])).rejects.toThrow(/exists/);
    await writeAllowedFile("figs/new", "a.svg", "y", true, [root]);
    expect(readFileSync(first.path, "utf8")).toBe("y");
    await expect(writeAllowedFile(".", "../a.svg", "x", false, [root])).rejects.toThrow(/plain file name/);
    await expect(writeAllowedFile(".", ".hidden", "x", false, [root])).rejects.toThrow(/plain file name/);
    await expect(writeAllowedFile(outside, "a.svg", "x", false, [root])).rejects.toThrow(/outside/);
    symlinkSync(outside, join(root, "out"));
    await expect(writeAllowedFile("out", "a.svg", "x", false, [root])).rejects.toThrow(/outside/);
    mkdirSync(join(root, "d"));
    symlinkSync(join(outside, "target.svg"), join(root, "d", "l.svg"));
    await expect(writeAllowedFile("d", "l.svg", "x", true, [root])).rejects.toThrow(/not a regular file/);
  });
});

describe("tool list", () => {
  test("the page assistant's tools (its save_structure replaced by one that writes a file), and open, open example, save figure", () => {
    const names = TOOL_REGISTRY.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(["open_file", "open_example", "save_figure", "save_structure", ...TOOLS.map((t) => t.name)]));
    expect(names.length).toBe(TOOLS.length + 3);
    for (const t of TOOLS.filter((x) => x.name !== "save_structure")) expect(TOOL_REGISTRY.find((x) => x.name === t.name)!.description).toBe(t.description);
  });

  test("the schemas take what the page's schemas take", () => {
    const view = TOOLS.find((t) => t.name === "set_view")!.input_schema;
    const z = zodOf(view as unknown as Record<string, unknown>);
    expect(z.safeParse({ along: [0, 0, 1], up: "c" }).success).toBe(true);
    expect(z.safeParse({ up: "d" }).success).toBe(false);
    const moments = zodOf(TOOLS.find((t) => t.name === "set_moments")!.input_schema as unknown as Record<string, unknown>);
    expect(moments.safeParse({ moments: [{ element: "Mn", size: 5, along: [0, 0, 1], where: { axis: "c", at: 0.5 } }] }).success).toBe(true);
    expect(moments.safeParse({ moments: [{ element: "Mn", along: [0, 0, 1] }] }).success).toBe(false);
  });

  test("the server keeps every setting the assistant may change, with the page's defaults", () => {
    expect([...SETTING_NAMES].sort()).toEqual(KNOBS.map((k) => k.name).sort());
    const d = defaultSettings();
    expect([d["canvasFixed"], d["canvasUnit"], d["canvasSize"], d["aspect"], d["textSizes"], d["fontFamily"], d["letterWeight"]]).toEqual([true, "cm", ["8.9", "6.675"], "4:3", { legend: "7", axes: "7", angle: "7" }, "Open Sans", 400]);
  });
});

describe("the server, through an MCP client", () => {
  let client: Client;
  const out = mkdtempSync(join(tmpdir(), "motif-mcp-out-"));
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0]!.text, isError: r.isError === true };
  };

  beforeAll(async () => {
    const { server } = createMotifServer({ roots: [EXAMPLES, out], examples: Object.fromEntries(readdirSync(EXAMPLES).map((f) => [f, readFileSync(join(EXAMPLES, f), "utf8")])) });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    client = new Client({ name: "test", version: "0" });
    await client.connect(b);
  });
  afterAll(async () => client.close());

  test("lists its tools", async () => {
    expect((await client.listTools()).tools.length).toBe(TOOL_REGISTRY.length);
  });

  test("nothing open: a plain answer, not a crash", async () => {
    const r = await call("describe_figure");
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/No structure is open/);
  });

  test("opens a file, describes it, changes it, and saves the figure and the structure", async () => {
    expect((await call("open_file", { path: OLIVINE })).text).toMatch(/Opened olivine.*Si–O/);
    const state = JSON.parse((await call("describe_figure")).text);
    expect(state.canvas).toBe("8.9 × 6.675 cm on paper");
    expect(state.view).toMatch(/c up · turn -120.0° · tilt 15.0°/);
    expect((await call("add_bonds", { between: "Si-Si", up_to: 1 })).isError).toBe(true);
    expect((await call("change_settings", { changes: { atomMaterial: "glass", cellWidth: "99" } })).text).toMatch(/Done: atomMaterial = "glass".*\n.*Out of range: cellWidth/);
    expect((await call("set_view", { along: [1, 0, 0] })).isError).toBe(false);
    expect((await call("use_journal", { publisher: "Physical Review", width: "full" })).isError).toBe(false);
    const saved = await call("save_figure", { folder: out });
    expect(saved.text).toMatch(/saved the figure to .*olivine-FeMg_COD-1541262\.svg/);
    const svg = readFileSync(join(out, "olivine-FeMg_COD-1541262.svg"), "utf8");
    expect(svg).toMatch(/^<svg[^>]* width="8.5cm" height="6.375cm"/);
    expect(svg).toContain("<circle");
    expect((await call("save_figure", { folder: out })).text).toMatch(/exists/);
    expect((await call("save_structure", { format: "cif", folder: out, file_name: "olivine-p1" })).text).toMatch(/28 atoms of one unit cell/);
    const back = readStructure(readFileSync(join(out, "olivine-p1.cif"), "utf8"), "olivine-p1.cif");
    expect(back.cell.a).toBeCloseTo(4.8129, 3);
  });

  test("files outside its folders are refused", async () => {
    const r = await call("open_file", { path: "/etc/hosts" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/outside the server's folders/);
    expect((await call("save_figure", { folder: "/" })).text).toMatch(/outside/);
  });

  test("moments by hand, as stated, and cleared", async () => {
    await call("open_file", { path: "perovskite-SrTiO3_COD-9006864.cif" });
    expect((await call("set_moments", { moments: [{ element: "Ti", size: 2, along: [0, 0, 1] }] })).text).toMatch(/Ti: 2 μB along \[0 0 1\] on 1 atom/);
    expect(JSON.parse((await call("describe_figure")).text).moments).toBe("added by hand: Ti 2 μB along [0 0 1]");
    expect((await call("clear_moments")).isError).toBe(false);
  });

  test("opens each feature example with its settings", async () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const r = await call("open_example", { number: n });
      expect(r.isError, r.text).toBe(false);
    }
    expect((await call("open_example", { number: 9 })).isError).toBe(true);
    await call("open_example", { number: 2 });
    expect(JSON.parse((await call("describe_figure")).text).moments).toBe("from the file (a magnetic CIF)");
  });
});
