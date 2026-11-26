// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * MOTIF's version, from package.json, its one source. Vite (the page and the tests) and the MCP bundle
 * (scripts/build-mcp.mjs) put it in `__MOTIF_VERSION__` when they build.
 */
declare const __MOTIF_VERSION__: string;

export const VERSION: string = __MOTIF_VERSION__;
