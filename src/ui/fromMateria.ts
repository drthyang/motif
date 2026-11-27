// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * A structure sent by MATERIA, browser to browser (the user's choice, 2026-11-26): MATERIA opens MOTIF in a new tab
 * with ?from=materia and, once MOTIF says it is ready, posts the same file it would download. Nothing is uploaded.
 *
 * MOTIF posts {type: "motif-ready", v: 1} to the tab that opened it, and takes exactly one
 * {type: "structure", v: 1, name, text, format: "cif" | "mcif"}: from one of MATERIA_ORIGINS, from that same opening
 * tab (MATERIA and MOTIF share the origin https://drthyang.github.io, so the origin alone only says the message comes
 * from one of the author's pages; the opening tab says which), and well formed. Everything else is ignored, a second
 * structure too. Without ?from=materia no listener is added.
 */

/** Where MATERIA runs: its site, and its development and preview servers on this computer. */
export const MATERIA_ORIGINS: readonly string[] = ["https://drthyang.github.io", "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173"];

/** The largest file taken, in characters (a large magnetic supercell is a few MB). */
export const MAX_SENT_CHARS = 64 * 1024 * 1024;

export interface SentStructure {
  readonly name: string;
  readonly text: string;
  readonly format: "cif" | "mcif";
}

/** The page was opened by MATERIA to receive a structure. */
export function openedFromMateria(search: string, opener: unknown): boolean {
  return new URLSearchParams(search).get("from") === "materia" && opener !== null && opener !== undefined;
}

/** The structure in a message, or null when the message is not one to take (wrong origin, wrong sender, malformed). */
export function sentStructure(message: { readonly origin: string; readonly source: unknown; readonly data: unknown }, opener: unknown): SentStructure | null {
  if (!MATERIA_ORIGINS.includes(message.origin)) return null;
  if (opener === null || opener === undefined || message.source !== opener) return null;
  const d = message.data as Record<string, unknown> | null;
  if (typeof d !== "object" || d === null || d["type"] !== "structure" || d["v"] !== 1) return null;
  const { name, text, format } = d as { name?: unknown; text?: unknown; format?: unknown };
  if (format !== "cif" && format !== "mcif") return null;
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_SENT_CHARS) return null;
  if (typeof name !== "string") return null;
  // A plain file name, as a download would have: no folders, no control characters, an extension that fits.
  const base = name.trim().replace(/^.*[\\/]/, "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
  const file = base === "" ? `materia.${format}` : /\.(m?cif)$/i.test(base) ? base : `${base}.${format}`;
  return { name: file, text, format };
}

/**
 * Listen for the one structure MATERIA sends, after telling it MOTIF is ready. Returns a function that stops
 * listening; `take` is called at most once.
 */
export function receiveFromMateria(win: Window, take: (s: SentStructure) => void): () => void {
  const opener = win.opener as Window | null;
  if (!openedFromMateria(win.location.search, opener)) return () => undefined;
  let taken = false;
  const listen = (e: MessageEvent) => {
    if (taken) return;
    const s = sentStructure({ origin: e.origin, source: e.source, data: e.data }, opener);
    if (!s) return;
    taken = true;
    win.removeEventListener("message", listen);
    take(s);
  };
  win.addEventListener("message", listen);
  // The opener is on one of these origins; a message to any other is not delivered, so this reaches only it.
  for (const origin of MATERIA_ORIGINS) {
    try {
      opener!.postMessage({ type: "motif-ready", v: 1 }, origin);
    } catch {
      // A closed opener: nothing will come.
    }
  }
  return () => win.removeEventListener("message", listen);
}
