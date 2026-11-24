// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The feature examples (examples/features.json): each a structure file shipped with the page and the settings
 * that show its feature, applied when it is opened from the list. Plain data; the app applies it.
 */
export interface FeatureExample {
  readonly title: string;
  readonly file: string;
  readonly note: string;
  /** Orbitals to draw: on the atoms of a species, which orbitals, and their size (angstrom) if not the default. */
  readonly orbitals?: readonly { readonly species: string; readonly orbitals: readonly string[]; readonly size?: number; readonly colours?: readonly [string, string]; readonly zFrom?: { readonly neighbour: string; readonly mode: "longest" | "bridge" } }[];
  /** False: bonds do not add atoms outside the cells shown (a slab stays a slab). */
  readonly completeBonds?: boolean;
  /** Species left out of the figure. */
  readonly hide?: readonly string[];
  /** For an RMC configuration: fold it into one averaged cell. */
  readonly fold?: boolean;
  /** The view: looking along this direction [u v w], which points at the viewer. */
  readonly along?: readonly [number, number, number];
  /** The cells shown: from a, b, c, then to a, b, c (in cell edges). */
  readonly cells?: readonly [number, number, number, number, number, number];
  /**
   * Coordination polyhedra: round each `centre` atom, with its `neighbour` atoms as corners. The bond rule between
   * the two is used if the page suggested one, else one is added up to `upTo` angstrom.
   */
  readonly polyhedra?: readonly { readonly centre: string; readonly neighbour: string; readonly upTo: number }[];
}

/** The feature examples from the text of features.json; an entry whose file is not among `files` is refused. */
export function readFeatures(text: string, files: readonly string[]): FeatureExample[] {
  const data = JSON.parse(text) as { examples?: unknown };
  if (!Array.isArray(data.examples)) throw new Error("features.json: no list of examples");
  return data.examples.map((e: Record<string, unknown>, i: number) => {
    const where = `features.json, example ${i + 1}`;
    if (typeof e.title !== "string" || typeof e.file !== "string") throw new Error(`${where}: a title and a file are needed`);
    if (!files.includes(e.file)) throw new Error(`${where}: no file ${e.file} in examples/`);
    const orbitals = e.orbitals as FeatureExample["orbitals"] | undefined;
    if (orbitals !== undefined && (!Array.isArray(orbitals) || orbitals.some((o) => typeof o.species !== "string" || !Array.isArray(o.orbitals) || (o.size !== undefined && !(o.size > 0 && o.size <= 20)) || (o.colours !== undefined && (!Array.isArray(o.colours) || o.colours.length !== 2 || o.colours.some((c: string) => !/^#[0-9a-fA-F]{6}$/.test(c)))) || (o.zFrom !== undefined && (typeof o.zFrom.neighbour !== "string" || !["longest", "bridge"].includes(o.zFrom.mode)))))) {
      throw new Error(`${where}: orbitals are given as { species, orbitals: [...], size (angstrom, optional), colours (two #rrggbb, optional), zFrom: { neighbour, mode: longest or bridge } (optional) }`);
    }
    const hide = e.hide as string[] | undefined;
    if (hide !== undefined && (!Array.isArray(hide) || hide.some((x) => typeof x !== "string"))) throw new Error(`${where}: hide is a list of species`);
    const along = e.along as number[] | undefined;
    if (along !== undefined && (!Array.isArray(along) || along.length !== 3 || along.some((x) => !Number.isInteger(x)) || along.every((x) => x === 0))) {
      throw new Error(`${where}: along is a direction of three whole numbers [u, v, w]`);
    }
    const cells = e.cells as number[] | undefined;
    if (cells !== undefined && (!Array.isArray(cells) || cells.length !== 6 || cells.some((x) => typeof x !== "number") || [0, 1, 2].some((i) => cells[i]! >= cells[i + 3]!))) {
      throw new Error(`${where}: cells are six numbers, from a, b, c then to a, b, c`);
    }
    const polyhedra = e.polyhedra as FeatureExample["polyhedra"] | undefined;
    if (polyhedra !== undefined && (!Array.isArray(polyhedra) || polyhedra.some((p) => typeof p.centre !== "string" || typeof p.neighbour !== "string" || !(p.upTo > 0.1 && p.upTo <= 10)))) {
      throw new Error(`${where}: polyhedra are given as { centre, neighbour, upTo (angstrom) }`);
    }
    return {
      title: e.title,
      file: e.file,
      note: typeof e.note === "string" ? e.note : "",
      ...(orbitals ? { orbitals } : {}),
      ...(e.fold === true ? { fold: true } : {}),
      ...(hide ? { hide } : {}),
      ...(e.completeBonds === false ? { completeBonds: false } : {}),
      ...(along ? { along: along as unknown as readonly [number, number, number] } : {}),
      ...(cells ? { cells: cells as unknown as readonly [number, number, number, number, number, number] } : {}),
      ...(polyhedra ? { polyhedra } : {}),
    };
  });
}
