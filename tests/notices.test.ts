// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

// The page ships third-party code and a font; their licences travel with it in public/third-party-licenses.txt.

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
// @ts-expect-error: a plain script, without types
import { noticesText } from "../scripts/third-party-notices.mjs";

it("public/third-party-licenses.txt is current (run node scripts/third-party-notices.mjs after changing dependencies)", () => {
  const text = noticesText() as string;
  expect(readFileSync("public/third-party-licenses.txt", "utf8")).toBe(text);
  for (const name of ["react 19", "react-dom", "@anthropic-ai/sdk", "IBM Plex Sans"]) expect(text).toContain(name);
  expect(text).toContain("SIL Open Font License");
  expect(text).not.toContain("no licence file in the package");
});
