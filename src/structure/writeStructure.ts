// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Save a structure as text (the user's choice, 2026-11-24): every atom of one unit cell (P1), in CIF, VASP POSCAR,
 * XYZ or extended XYZ. Symmetry is not kept: the file lists the cell's atoms with the identity as its only operation.
 *
 * The cell is written in MOTIF's axes (a along x, b in the xy plane), so POSCAR and extended XYZ carry lattice vectors
 * and Cartesian positions in those axes. POSCAR and XYZ have no occupancies: a structure with a partly occupied or
 * shared site is refused for them (CIF keeps occupancies). Magnetic moments are not written by any of these formats;
 * the caller is told so. Each format is checked by reading it back with MOTIF's own readers (tests/writeStructure.test.ts).
 */

import { fractionalToCartesian, orthogonalizationMatrix } from "./cell";
import { expandToUnitCell } from "./expand";
import type { Structure } from "./types";

export type StructureFormat = "cif" | "poscar" | "xyz" | "extxyz";

export const FORMATS: readonly { id: StructureFormat; label: string; file: (name: string) => string }[] = [
  { id: "cif", label: "CIF", file: (n) => `${n}.cif` },
  { id: "poscar", label: "VASP POSCAR", file: (n) => `${n}.vasp` },
  { id: "xyz", label: "XYZ", file: (n) => `${n}.xyz` },
  { id: "extxyz", label: "extended XYZ", file: (n) => `${n}.extxyz` },
];

const f = (x: number, d = 6) => (Math.abs(x) < 0.5 * 10 ** -d ? 0 : x).toFixed(d);

export interface Written {
  readonly text: string;
  readonly atoms: number;
  /** Things the format could not keep, in words. */
  readonly notes: readonly string[];
}

/** The structure's unit cell as `format`. Throws, with the reason, when the format cannot hold it. */
export function writeStructure(structure: Structure, format: StructureFormat, name = structure.name || "structure"): Written {
  const atoms = expandToUnitCell(structure).atoms;
  const cell = structure.cell;
  const notes: string[] = [];
  if (atoms.some((a) => a.moment)) notes.push("magnetic moments are not written (none of these formats carries them)");
  const partial = atoms.some((a) => a.components.length > 1 || a.occupancy < 1 - 1e-6);
  if (partial && format !== "cif") throw new Error(`${FORMATS.find((x) => x.id === format)!.label} has no occupancies, and this structure has partly occupied or shared sites. CIF keeps them: ask the user whether to save it as CIF instead.`);
  const title = name.replace(/[\r\n]+/g, " ").trim() || "structure";
  if (format === "cif") {
    const lines = [
      `data_${title.replace(/[^A-Za-z0-9_.-]+/g, "_")}`,
      "_audit_creation_method 'MOTIF: every atom of one unit cell (P1)'",
      `_cell_length_a ${f(cell.a)}`,
      `_cell_length_b ${f(cell.b)}`,
      `_cell_length_c ${f(cell.c)}`,
      `_cell_angle_alpha ${f(cell.alpha)}`,
      `_cell_angle_beta ${f(cell.beta)}`,
      `_cell_angle_gamma ${f(cell.gamma)}`,
      "_space_group_name_H-M_alt 'P 1'",
      "loop_",
      "_space_group_symop_operation_xyz",
      "'x, y, z'",
      "loop_",
      "_atom_site_label",
      "_atom_site_type_symbol",
      "_atom_site_fract_x",
      "_atom_site_fract_y",
      "_atom_site_fract_z",
      "_atom_site_occupancy",
    ];
    const counts = new Map<string, number>();
    for (const a of atoms)
      for (const c of a.components) {
        const n = (counts.get(c.element) ?? 0) + 1;
        counts.set(c.element, n);
        lines.push(`${c.element}${n} ${c.element} ${a.frac.map((x) => f(x)).join(" ")} ${f(c.occupancy, 4)}`);
      }
    return { text: lines.join("\n") + "\n", atoms: atoms.length, notes };
  }
  const elements = [...new Set(atoms.map((a) => a.components[0]!.element))];
  const sorted = elements.flatMap((e) => atoms.filter((a) => a.components[0]!.element === e));
  const m = orthogonalizationMatrix(cell);
  const vectors = [0, 1, 2].map((j) => [m[0][j]!, m[1][j]!, m[2][j]!]);
  if (format === "poscar") {
    const lines = [title, "1.0", ...vectors.map((v) => v.map((x) => f(x, 10)).join(" ")), elements.join(" "), elements.map((e) => sorted.filter((a) => a.components[0]!.element === e).length).join(" "), "Direct", ...sorted.map((a) => a.frac.map((x) => f(x, 10)).join(" "))];
    return { text: lines.join("\n") + "\n", atoms: atoms.length, notes };
  }
  const cart = sorted.map((a) => `${a.components[0]!.element} ${fractionalToCartesian(cell, a.frac).map((x) => f(x, 8)).join(" ")}`);
  if (format === "xyz") {
    notes.push("plain XYZ has no cell: it reads back as a molecule (use extended XYZ to keep the cell)");
    return { text: [String(atoms.length), title, ...cart].join("\n") + "\n", atoms: atoms.length, notes };
  }
  const lattice = vectors.map((v) => v.map((x) => f(x, 8)).join(" ")).join(" ");
  return { text: [String(atoms.length), `Lattice="${lattice}" Properties=species:S:1:pos:R:3 pbc="T T T" comment="${title.replace(/"/g, "'")}"`, ...cart].join("\n") + "\n", atoms: atoms.length, notes };
}
