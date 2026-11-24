// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Displacive distortion modes from an ISODISTORT CIF (iso.byu.edu).
 *
 * Reading approved by the user (2026-11-23): the atoms drawn are the distorted structure the file lists;
 * each site's displacement from the parent is built from the displacive modes,
 *   delta_i = sum_j matrix[i][j] x amplitude_j x norm_j   (fractional units of the file's cell),
 * added to the site coordinates the file's _iso_coordinate_formula names; it is made angstrom with the
 * undistorted supercell (the parent cell in the file's basis) and carried to equivalent atoms as a polar
 * vector, d' = R d. Strain, magnetic, rotational and occupancy modes are not drawn.
 */

import { cifText, findLoop, parseCifNumber, type Loop } from "./cifSyntax";
import type { Cell, Distortion, Site, Structure, Vec3 } from "./types";

/** A file's stated deltas and those rebuilt from its modes may differ by the rounding of five decimals. */
const DELTA_TOLERANCE = 5e-4;

/** A loop's column by its exact tag (case-insensitive); throws if the loop lacks it. */
function column(loop: Loop, tag: string): string[] {
  const i = loop.headers.findIndex((h) => h.toLowerCase() === tag);
  if (i < 0) throw new Error(`The ISODISTORT data lack ${tag}.`);
  return loop.rows.map((r) => r[i]!);
}

function loopWith(loops: Loop[], tag: string): Loop | undefined {
  return findLoop(loops, (h) => h.includes(tag));
}

/** "1/2", "-0.25", "2" -> number. */
function rational(text: string): number {
  const t = text.trim();
  if (t === "" || t === "+") return 1;
  if (t === "-") return -1;
  const m = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:\/(\d+(?:\.\d*)?))?$/.exec(t);
  if (!m) throw new Error(`"${text}" is not a number.`);
  const value = Number(m[2]) / (m[3] !== undefined ? Number(m[3]) : 1);
  return m[1] === "-" ? -value : value;
}

/**
 * A coordinate formula such as "1/2 + Ti_dz" or "x - 2*O_dx": the constant is dropped, each named delta keeps its
 * coefficient. Throws on anything else, so a formula MOTIF does not understand is never half-read.
 */
export function formulaTerms(formula: string, deltaNames: ReadonlySet<string>): { name: string; coefficient: number }[] {
  const text = formula.replace(/\s+/g, "");
  if (text === "") return [];
  const terms: { name: string; coefficient: number }[] = [];
  for (const m of text.matchAll(/([+-]?)([^+-]+)/g)) {
    const [sign, body] = [m[1]!, m[2]!];
    const named = [...deltaNames].filter((n) => body === n || body.endsWith(`*${n}`) || (body.endsWith(n) && /^[\d./]*$/.test(body.slice(0, -n.length))));
    if (named.length === 0) {
      rational(sign + body); // a constant: check it is one
      continue;
    }
    const name = named.sort((p, q) => q.length - p.length)[0]!;
    const factor = body.slice(0, body.length - name.length).replace(/\*$/, "");
    terms.push({ name, coefficient: rational(sign + (factor === "" ? "1" : factor)) });
  }
  return terms;
}

/**
 * The basis part of a transform such as "a,b,c;1/2,1/2,-1/2" or "a-b,a+b,2c;0,0,0": for each new axis, its
 * components along the old a, b, c.
 */
export function readBasis(transform: string): [Vec3, Vec3, Vec3] {
  const parts = transform.split(";")[0]!.split(",");
  if (parts.length !== 3) throw new Error(`The transform "${transform}" does not give three axes.`);
  return parts.map((p) => {
    const v: [number, number, number] = [0, 0, 0];
    const text = p.replace(/\s+/g, "");
    let used = "";
    for (const m of text.matchAll(/([+-]?)([\d./]*)\*?([abc])/g)) {
      const k = "abc".indexOf(m[3]!) as 0 | 1 | 2;
      v[k] = v[k] + rational(m[1]! + (m[2] === "" ? "1" : m[2]!));
      used += m[0];
    }
    if (used !== text) throw new Error(`The axis "${p}" of the transform "${transform}" is not a sum of a, b and c.`);
    return v;
  }) as unknown as [Vec3, Vec3, Vec3];
}

/** The cell spanned by new axes given as components along the old ones (metric G' = P^T G P). */
export function transformedCell(cell: Cell, basis: readonly [Vec3, Vec3, Vec3]): Cell {
  const rad = Math.PI / 180;
  const [ca, cb, cg] = [Math.cos(cell.alpha * rad), Math.cos(cell.beta * rad), Math.cos(cell.gamma * rad)];
  const g = [
    [cell.a * cell.a, cell.a * cell.b * cg, cell.a * cell.c * cb],
    [cell.a * cell.b * cg, cell.b * cell.b, cell.b * cell.c * ca],
    [cell.a * cell.c * cb, cell.b * cell.c * ca, cell.c * cell.c],
  ];
  const dot = (u: Vec3, v: Vec3): number => {
    let s = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += u[i]! * g[i]![j]! * v[j]!;
    return s;
  };
  const [a, b, c] = basis;
  const [la, lb, lc] = [Math.sqrt(dot(a, a)), Math.sqrt(dot(b, b)), Math.sqrt(dot(c, c))];
  const angle = (u: Vec3, v: Vec3, lu: number, lv: number): number => Math.acos(Math.max(-1, Math.min(1, dot(u, v) / (lu * lv)))) / rad;
  return { a: la, b: lb, c: lc, alpha: angle(b, c, lb, lc), beta: angle(a, c, la, lc), gamma: angle(a, b, la, lb) };
}

/** Kinds of non-displacive mode the file holds, for the page to say they are not drawn. */
function otherModes(items: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [tag, words] of [
    ["_iso_strainmode_number", "strain"],
    ["_iso_magneticmode_number", "magnetic"],
    ["_iso_rotationalmode_number", "rotational"],
    ["_iso_occupancymode_number", "occupancy"],
  ] as const) {
    const n = Number(cifText(items.get(tag)) ?? "0");
    if (n > 0) out.push(`${n} ${words} mode${n > 1 ? "s" : ""}`);
  }
  return out;
}

/**
 * The displacive distortion of an ISODISTORT CIF, or undefined for any other file. `sites` are the file's
 * sites (to check that every coordinate formula names one). Throws a plain-language Error when the ISODISTORT
 * data are incomplete or do not agree with themselves.
 */
export function readDistortion(items: Map<string, string>, loops: Loop[], sites: readonly Site[]): Distortion | undefined {
  const modeLoop = loopWith(loops, "_iso_displacivemode_value");
  if (!modeLoop) {
    if (items.has("_iso_displacivemode_number") && Number(cifText(items.get("_iso_displacivemode_number"))) > 0) {
      throw new Error("The file announces ISODISTORT displacive modes but does not list them (_iso_displacivemode_value).");
    }
    return undefined;
  }
  const modeIds = column(modeLoop, "_iso_displacivemode_id").map(Number);
  const labels = column(modeLoop, "_iso_displacivemode_label");
  const amplitudes = column(modeLoop, "_iso_displacivemode_value").map(parseCifNumber);
  const normLoop = loopWith(loops, "_iso_displacivemodenorm_value");
  if (!normLoop) throw new Error("The ISODISTORT data lack the mode norms (_iso_displacivemodenorm_value).");
  const norms = new Map(column(normLoop, "_iso_displacivemodenorm_id").map((id, k) => [Number(id), parseCifNumber(column(normLoop, "_iso_displacivemodenorm_value")[k]!)]));
  const modes = modeIds.map((id, j) => {
    const norm = norms.get(id);
    if (norm === undefined) throw new Error(`The ISODISTORT data give no norm for mode ${id}.`);
    return { label: labels[j]!, amplitude: amplitudes[j]!, norm };
  });

  const deltaLoop = loopWith(loops, "_iso_deltacoordinate_value");
  if (!deltaLoop) throw new Error("The ISODISTORT data lack the coordinate shifts (_iso_deltacoordinate_value).");
  const deltaIds = column(deltaLoop, "_iso_deltacoordinate_id").map(Number);
  const deltas = column(deltaLoop, "_iso_deltacoordinate_label").map((label, i) => ({ label, value: parseCifNumber(column(deltaLoop, "_iso_deltacoordinate_value")[i]!) }));

  const matrixLoop = loopWith(loops, "_iso_displacivemodematrix_value");
  if (!matrixLoop) throw new Error("The ISODISTORT data lack the mode matrix (_iso_displacivemodematrix_value).");
  const matrix = deltaIds.map(() => modeIds.map(() => 0));
  const [rows, cols, values] = [column(matrixLoop, "_iso_displacivemodematrix_row"), column(matrixLoop, "_iso_displacivemodematrix_col"), column(matrixLoop, "_iso_displacivemodematrix_value")];
  rows.forEach((r, k) => {
    const [i, j] = [deltaIds.indexOf(Number(r)), modeIds.indexOf(Number(cols[k]))];
    if (i < 0 || j < 0) throw new Error(`The mode matrix names row ${r}, column ${cols[k]}, which are not a coordinate shift and a mode of the file.`);
    matrix[i]![j] = parseCifNumber(values[k]!);
  });

  // The file's own check: its modes must rebuild its stated shifts.
  deltas.forEach((d, i) => {
    const rebuilt = modes.reduce((sum, m, j) => sum + matrix[i]![j]! * m.amplitude * m.norm, 0);
    if (Math.abs(rebuilt - d.value) > DELTA_TOLERANCE) {
      throw new Error(`The ISODISTORT data do not agree with themselves: the modes give ${d.label} = ${rebuilt.toFixed(5)}, the file states ${d.value}.`);
    }
  });

  const formulaLoop = loopWith(loops, "_iso_coordinate_formula");
  if (!formulaLoop) throw new Error("The ISODISTORT data lack the coordinate formulas (_iso_coordinate_formula).");
  const names = new Set(deltas.map((d) => d.label));
  // A site with no free coordinate (its _atom_site_fract_symmform is 0,0,0) cannot move. ISODISTORT still writes a
  // formula for it, naming a shift such as Sr1_dx that it never lists; such a site is left where it is.
  const fixed = new Set<string>();
  const symmLoop = loopWith(loops, "_atom_site_fract_symmform");
  if (symmLoop) {
    const [labels, forms] = [column(symmLoop, "_atom_site_label"), column(symmLoop, "_atom_site_fract_symmform")];
    labels.forEach((label, i) => {
      if ((cifText(forms[i]) ?? "").split(",").every((t) => t.trim() === "0")) fixed.add(label);
    });
  }
  const uses: Distortion["uses"][number][] = [];
  const coordLabels = column(formulaLoop, "_iso_coordinate_label");
  const formulas = column(formulaLoop, "_iso_coordinate_formula");
  coordLabels.forEach((coord, k) => {
    const cut = coord.lastIndexOf("_");
    const [site, axisName] = [coord.slice(0, cut), coord.slice(cut + 1).toLowerCase()];
    const axis = ["x", "y", "z"].indexOf(axisName);
    if (cut <= 0 || axis < 0) throw new Error(`The coordinate "${coord}" is not a site label followed by _x, _y or _z.`);
    if (!sites.some((s) => s.label === site)) throw new Error(`The coordinate formula names the site "${site}", which is not in the atom list.`);
    if (fixed.has(site)) return;
    for (const t of formulaTerms(cifText(formulas[k]) ?? "", names)) {
      uses.push({ site, axis: axis as 0 | 1 | 2, delta: deltas.findIndex((d) => d.label === t.name), coefficient: t.coefficient });
    }
  });

  const parentTag = (k: string): number => {
    const v = items.get(`_iso_parentcell_${k}`);
    if (v === undefined) throw new Error(`The ISODISTORT data lack the parent cell (_iso_parentcell_${k}).`);
    return parseCifNumber(v);
  };
  const parent: Cell = { a: parentTag("length_a"), b: parentTag("length_b"), c: parentTag("length_c"), alpha: parentTag("angle_alpha"), beta: parentTag("angle_beta"), gamma: parentTag("angle_gamma") };
  const transform = cifText(items.get("_iso_parent-to-child.transform_pp_abc"));
  if (transform === undefined) throw new Error("The ISODISTORT data lack the parent-to-child basis (_iso_parent-to-child.transform_Pp_abc).");
  return { modes, matrix, deltas, uses, undistortedCell: transformedCell(parent, readBasis(transform)), notDrawn: otherModes(items) };
}

/** Each site's displacement (fractional units) with the modes switched on (`on[j]` for mode j; all when absent). */
export function siteDisplacements(distortion: Distortion, on?: readonly boolean[]): Map<string, Vec3> {
  const delta = distortion.matrix.map((row) => row.reduce((sum, m, j) => sum + (on && !on[j] ? 0 : m * distortion.modes[j]!.amplitude * distortion.modes[j]!.norm), 0));
  const out = new Map<string, [number, number, number]>();
  for (const u of distortion.uses) {
    const d = out.get(u.site) ?? [0, 0, 0];
    d[u.axis] = d[u.axis] + u.coefficient * delta[u.delta]!;
    out.set(u.site, d);
  }
  return out;
}

/** The structure with each site's displacement from the modes switched on (all when `on` is absent). */
export function withDisplacements(structure: Structure, on?: readonly boolean[]): Structure {
  if (!structure.distortion) return structure;
  const shifts = siteDisplacements(structure.distortion, on);
  return {
    ...structure,
    sites: structure.sites.map((s) => {
      const { displacement: _old, ...rest } = s;
      const d = shifts.get(s.label);
      return d && (d[0] !== 0 || d[1] !== 0 || d[2] !== 0) ? { ...rest, displacement: d } : rest;
    }),
  };
}
