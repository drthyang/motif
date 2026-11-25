// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * MOTIF's MCP server over stdio, for agents outside the page. Transport only (the tools are in registry.ts).
 * Bundled by `npm run build:mcp` into dist-mcp/mcp-server.mjs (the feature examples inside it); `npm run mcp` builds
 * and starts it.
 * Folders: MOTIF_ROOTS (a path list), else the folder it is started in.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { bundledExamples } from "./examples";
import { createMotifServer } from "./host";
import { defaultRoots } from "./files";
import { TOOL_REGISTRY } from "./registry";

async function main(): Promise<void> {
  const roots = defaultRoots();
  const { server } = createMotifServer({ roots, examples: bundledExamples() });
  await server.connect(new StdioServerTransport());
  // Never write to stdout: it is the JSON-RPC channel.
  process.stderr.write(`motif MCP server ready (stdio, ${TOOL_REGISTRY.length} tools; ${roots.length ? `folders: ${roots.join(", ")}` : "files off (set MOTIF_ROOTS)"})\n`);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
