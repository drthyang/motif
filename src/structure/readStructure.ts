// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Any structure file MOTIF reads -> Structure, by its name (and, where names are shared, its content).
 * Each result carries the short name of its format, which the page shows over the figure.
 */

import { readCif } from "./readCif";
import { isAims, isXsf, isXyz, readAims, readXsf, readXyz } from "./readCartesian";
import { isCastep, isEspresso, isPdb, readCastep, readEspresso, readPdb } from "./readCodes";
import { isPoscar, readPoscar } from "./readPoscar";
import { isRmc6f, readRmc6f } from "./readRmc6f";
import { isShelx, readShelx } from "./readShelx";
import type { Structure } from "./types";

/** The extensions MOTIF reads by name (POSCAR, CONTCAR and geometry.in have none, so the Open file dialog offers every file). */
export const FILE_TYPES = ".cif,.mcif,.rmc6f,.vasp,.poscar,.xyz,.extxyz,.res,.ins,.pdb,.ent,.pwi,.in,.qe,.cell,.xsf";

export function readStructure(text: string, fileName: string, options: { fold?: boolean } = {}): Structure {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const read = (): Structure => {
    if (isRmc6f(text, base)) return readRmc6f(text, base, options);
    if (isPoscar(base)) return { ...readPoscar(text, base), format: "VASP" };
    if (isXyz(base)) return { ...readXyz(text, base), format: /Lattice\s*=/i.test(text.split(/\r?\n/, 2)[1] ?? "") ? "Extended XYZ" : "XYZ" };
    if (isShelx(base)) return { ...readShelx(text, base), format: "SHELX" };
    if (isPdb(base)) return { ...readPdb(text, base), format: "PDB" };
    if (isEspresso(base, text)) return { ...readEspresso(text, base), format: "Quantum ESPRESSO" };
    if (isAims(base, text)) return { ...readAims(text, base), format: "FHI-aims" };
    if (isCastep(base)) return { ...readCastep(text, base), format: "CASTEP" };
    if (isXsf(base)) return { ...readXsf(text, base), format: "XSF" };
    const cif = readCif(text);
    return cif;
  };
  const s = read();
  if (s.format) return s;
  if (s.rmc) return { ...s, format: "RMC" };
  return { ...s, format: s.magnetic ? "mCIF" : "CIF" };
}
