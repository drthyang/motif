// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * public/third-party-licenses.txt: the licences of the third-party code and fonts the page ships to the browser
 * (every runtime package in package-lock.json, and the IBM Plex Sans font), as their licences ask. Run after
 * changing dependencies: `node scripts/third-party-notices.mjs`; tests/notices.test.ts fails while the file is out
 * of date. `--check` prints the text instead of writing it.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const MIT = `MIT License

Copyright (c) <holder>

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of
the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

export function noticesText() {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const runtime = Object.entries(lock.packages)
    .filter(([path, p]) => path.startsWith("node_modules/") && !p.dev)
    .map(([path, p]) => ({ name: path.slice(path.lastIndexOf("node_modules/") + 13), path, version: p.version, license: p.license }));
  // The page's font is a build-time package but ships with the page.
  const font = lock.packages["node_modules/@fontsource/ibm-plex-sans"];
  const shipped = [...runtime, { name: "@fontsource/ibm-plex-sans (IBM Plex Sans)", path: "node_modules/@fontsource/ibm-plex-sans", version: font.version, license: font.license }];
  shipped.sort((a, b) => a.name.localeCompare(b.name));
  const licenceFile = (dir) => {
    const name = existsSync(join(root, dir)) ? readdirSync(join(root, dir)).find((f) => /^(licen[cs]e|copying)(\.md|\.txt)?$/i.test(f)) : undefined;
    return name ? readFileSync(join(root, dir, name), "utf8").trim() : null;
  };
  const parts = shipped.map((p) => {
    const text = licenceFile(p.path);
    // A package that states MIT but ships no licence file: the MIT text, with its author from package.json.
    const meta = JSON.parse(readFileSync(join(root, p.path, "package.json"), "utf8"));
    const author = typeof meta.author === "string" ? meta.author : meta.author?.name;
    const fallback = p.license === "MIT" ? `${MIT.replace("<holder>", author ?? p.name)}\n(The package ships no licence file; its package.json states MIT${meta.repository ? `, source ${typeof meta.repository === "string" ? meta.repository : meta.repository.url}` : ""}.)` : `(no licence file in the package; its package.json says: ${p.license})`;
    return `${"=".repeat(78)}\n${p.name} ${p.version}\nLicence: ${p.license ?? "see below"}\n${"-".repeat(78)}\n${text ?? fallback}\n`;
  });
  return `Third-party software and fonts in MOTIF's web page\n\nMOTIF itself is licensed under the GNU Affero General Public License v3.0 or later (see LICENSE in\nhttps://github.com/drthyang/motif). The page also contains the following, each under its own licence.\n\n${parts.join("\n")}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = noticesText();
  if (process.argv.includes("--check")) process.stdout.write(text);
  else {
    writeFileSync(join(root, "public", "third-party-licenses.txt"), text);
    process.stderr.write(`wrote public/third-party-licenses.txt (${text.length} characters)\n`);
  }
}
