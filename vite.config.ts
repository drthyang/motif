// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

// The version, from package.json (its one source; src/version.ts).
const version = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

export default defineConfig({
  base: "./", // relative paths, so the built site works from any folder of a static host
  plugins: [react()],
  define: { __MOTIF_VERSION__: JSON.stringify(version) },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 5000 },
});
