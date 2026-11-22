// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./", // relative paths, so the built site works from any folder of a static host
  plugins: [react()],
  test: { include: ["tests/**/*.test.ts"], testTimeout: 5000 },
});
