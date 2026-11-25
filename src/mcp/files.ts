// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Files for the MCP server: which folders it may read from and write into, and reading and writing inside them.
 *
 * Shaped like MATERIA's MCP host (web-refinement, src/mcp/host.ts, the user's own code): the folders come from an
 * environment variable (here MOTIF_ROOTS, a path list), else the folder the server was started in, unless that is
 * the filesystem root or the home folder (some clients start servers there; then files stay off until MOTIF_ROOTS
 * names a folder). Symbolic links are followed before the check, so a link cannot lead outside. A file is never
 * replaced unless the caller asks, and never written through a link.
 */

import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

/** Largest file the server reads (a large RMC configuration is tens of MB). */
export const MAX_FILE_BYTES = 128 * 1024 * 1024;

/** The folders files may be read from and written into. */
export function defaultRoots(env: string | undefined = process.env["MOTIF_ROOTS"], cwd: string = process.cwd()): string[] {
  if (env) return env.split(delimiter).filter(Boolean).map((r) => resolve(r));
  const here = resolve(cwd);
  return here === parse(here).root || here === resolve(homedir()) ? [] : [here];
}

function inside(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

async function realRoots(roots: readonly string[]): Promise<string[]> {
  return (await Promise.all(roots.map((r) => realpath(r).catch(() => null)))).filter((r): r is string => r !== null);
}

/** Read a file inside the roots: relative to each root in turn, or absolute. Returns its real path, name and text. */
export async function readAllowedFile(p: string, roots: readonly string[]): Promise<{ path: string; name: string; text: string }> {
  if (!roots.length) throw new Error("Reading files is off: the server has no folder. Set MOTIF_ROOTS to a folder list, or start the server in a project folder.");
  const allowed = await realRoots(roots);
  const candidates = isAbsolute(p) ? [p] : roots.map((r) => resolve(r, p));
  for (const candidate of candidates) {
    const real = await realpath(candidate).catch(() => null);
    if (!real) continue;
    if (!allowed.some((r) => inside(r, real))) throw new Error(`${p} is outside the server's folders (${roots.join(", ")}).`);
    const info = await stat(real);
    if (!info.isFile()) throw new Error(`${p} is not a file.`);
    if (info.size > MAX_FILE_BYTES) throw new Error(`${p} is ${info.size} bytes; the limit is ${MAX_FILE_BYTES}.`);
    return { path: real, name: basename(real), text: await readFile(real, "utf8") };
  }
  throw new Error(`No such file: ${p} (folders: ${roots.join(", ")}).`);
}

/** A folder to write into (it may not exist yet), inside the roots; relative paths start from the first root. */
async function allowedDir(p: string, roots: readonly string[]): Promise<string> {
  if (!roots.length) throw new Error("Writing files is off: the server has no folder. Set MOTIF_ROOTS to a folder list, or start the server in a project folder.");
  const target = isAbsolute(p) ? resolve(p) : resolve(roots[0]!, p);
  // Follow links on the deepest part that exists; the rest is created fresh.
  let existing = target;
  while (!(await lstat(existing).catch(() => null))) {
    const up = dirname(existing);
    if (up === existing) break;
    existing = up;
  }
  const real = resolve(await realpath(existing), relative(existing, target));
  const allowed = await realRoots(roots);
  if (!allowed.some((r) => r === real || inside(r, real))) throw new Error(`${p} is outside the server's folders (${roots.join(", ")}).`);
  const info = await stat(real).catch(() => null);
  if (info && !info.isDirectory()) throw new Error(`${p} exists and is not a folder.`);
  return real;
}

/**
 * Write one file into a folder inside the roots. The name must be a plain file name; an existing file is kept
 * unless `overwrite`, and a link or anything but a regular file is never written over.
 */
export async function writeAllowedFile(
  folder: string,
  name: string,
  text: string,
  overwrite: boolean,
  roots: readonly string[],
): Promise<{ path: string; bytes: number }> {
  if (!name || name !== basename(name) || name.startsWith(".")) throw new Error(`Refusing to write "${name}": not a plain file name.`);
  const dir = await allowedDir(folder, roots);
  const path = join(dir, name);
  const info = await lstat(path).catch(() => null);
  if (info) {
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`Refusing to write ${path}: it exists and is not a regular file.`);
    if (!overwrite) throw new Error(`${path} exists; pass overwrite: true to replace it, or choose another name or folder.`);
  }
  await mkdir(dir, { recursive: true });
  await writeFile(path, text, "utf8");
  return { path, bytes: Buffer.byteLength(text, "utf8") };
}
