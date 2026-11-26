// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Bundle the MCP server into one runnable file with rolldown, which Vite already brings. The MCP SDK, zod and the
 * feature examples (examples/features.json and the files it names) are inside it, so it runs from any folder:
 * `node dist-mcp/mcp-server.mjs`. dist-mcp/ is a folder of its own, so `vite build` (which empties dist/) never
 * removes it.
 *
 *   --outfile <path>   write the bundle there instead (the scattering-agent-tools launcher builds one per process)
 *   --serve            start the server once built; stdout is then the JSON-RPC channel, so this logs to stderr
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "rolldown";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const at = process.argv.indexOf("--outfile");
const file = at > 0 && process.argv[at + 1] ? resolve(process.argv[at + 1]) : resolve(root, "dist-mcp/mcp-server.mjs");

// The feature examples, as the server reads them (src/mcp/examples.ts, readExamples).
const dir = join(root, "examples");
const features = readFileSync(join(dir, "features.json"), "utf8");
const names = [...new Set(JSON.parse(features).examples.map((e) => e.file))];
const examples = { "features.json": features, ...Object.fromEntries(names.map((n) => [n, readFileSync(join(dir, n), "utf8")])) };

await build({
  input: resolve(root, "src/mcp/server.ts"),
  platform: "node",
  logLevel: "warn",
  transform: { define: { __MOTIF_EXAMPLES__: JSON.stringify(examples), __MOTIF_VERSION__: JSON.stringify(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version) } },
  output: { file, format: "esm", banner: "#!/usr/bin/env node" },
});
process.stderr.write(`built ${file}\n`);
if (process.argv.includes("--serve")) await import(pathToFileURL(file).href);
