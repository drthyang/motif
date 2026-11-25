// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The feature examples for the MCP server: features.json and the files it names, by file name. The bundle carries
 * them (scripts/build-mcp.mjs puts them in `__MOTIF_EXAMPLES__`), so it runs from any folder; run from the source,
 * they are read from examples/.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFeatures } from "../ui/examples";

declare const __MOTIF_EXAMPLES__: Record<string, string> | undefined;

/** features.json and the files it names, read from a folder. */
export function readExamples(dir: string): Record<string, string> {
  const text = readFileSync(join(dir, "features.json"), "utf8");
  const files = [...new Set(readFeatures(text, readdirSync(dir)).map((f) => f.file))];
  return { "features.json": text, ...Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), "utf8")])) };
}

export function bundledExamples(): Record<string, string> {
  if (typeof __MOTIF_EXAMPLES__ !== "undefined") return __MOTIF_EXAMPLES__;
  return readExamples(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "examples"));
}
