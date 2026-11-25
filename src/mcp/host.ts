// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The MCP host: the registry's tools on one figure, behind an MCP server. Transport only: `server.ts` connects it
 * to stdio, the tests to an in-memory client. Shaped like MATERIA's (web-refinement, src/mcp/host.ts, the user's
 * own code); MOTIF's server keeps one figure, as the page does, instead of passing data by reference.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Figure } from "./figure";
import { defaultRoots } from "./files";
import { TOOL_REGISTRY, type Context } from "./registry";

export const SERVER_VERSION = "0.1.0-dev.0";

const INSTRUCTIONS = `MOTIF: vector figures of crystal structures (CIF, magnetic CIF, ISODISTORT, RMCProfile and other formats), the same drawing code as the MOTIF page.

The server holds one figure. Open a file (open_file, from the server's folders) or an example (open_example), call describe_figure, change how it looks with the other tools, then save_figure writes the SVG exactly as the page saves it. Answers name where each change is on the MOTIF page ("Visual › Bonds"), so a person can find it there.

Moments set by hand are as stated, per atom of one unit cell, nothing spread by symmetry: ask the user for any size or direction they have not given, never make one up.`;

export interface HostOptions {
  /** Folders files may be read from and written into. Default: defaultRoots() (MOTIF_ROOTS). */
  readonly roots?: readonly string[];
  /** The feature examples: features.json and the files it names, by file name. */
  readonly examples: Readonly<Record<string, string>>;
}

export function createMotifServer(opts: HostOptions): { server: McpServer; context: Context } {
  const context: Context = { figure: new Figure(), roots: opts.roots ?? defaultRoots(), examples: opts.examples };
  const server = new McpServer({ name: "motif", version: SERVER_VERSION }, { instructions: INSTRUCTIONS });
  for (const tool of TOOL_REGISTRY) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.inputSchema }, async (args: Record<string, unknown>) => {
      try {
        const answer = await tool.handler(context, args);
        return { content: [{ type: "text" as const, text: answer.text }], ...(answer.isError ? { isError: true } : {}) };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
      }
    });
  }
  return { server, context };
}
