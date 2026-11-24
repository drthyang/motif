// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The readers of other formats give the same crystal as the CIF reader (itself checked against gemmi): quartz
 * (hexagonal) and halite are written in each format from the CIF's expanded unit cell, with the lattice turned to
 * an arbitrary orientation where the format is Cartesian, read back, expanded, and compared atom by atom.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fractionalToCartesian, orthogonalizationMatrix } from "../src/structure/cell";
import { expandToUnitCell } from "../src/structure/expand";
import { BOHR, latticeFromVectors, MOLECULE_PAD } from "../src/structure/lattice";
import { readCif } from "../src/structure/readCif";
import { readStructure } from "../src/structure/readStructure";
import type { Cell, Structure, Vec3 } from "../src/structure/types";

const quartz = readCif(readFileSync("examples/quartz_COD-9009666.cif", "utf8"));
const halite = readCif(readFileSync("examples/halite-NaCl_COD-9008678.cif", "utf8"));

/** The atoms of one unit cell as "element x y z" with coordinates wrapped and rounded, sorted. */
function cellAtoms(s: Structure): string[] {
  const wrap = (x: number) => {
    const v = ((x % 1) + 1) % 1;
    return v > 1 - 5e-5 ? 0 : v;
  };
  return expandToUnitCell(s)
    .atoms.map((a) => `${a.species} ${a.frac.map((x) => wrap(x).toFixed(4)).join(" ")}`)
    .sort();
}

function sameCell(a: Cell, b: Cell) {
  for (const k of ["a", "b", "c", "alpha", "beta", "gamma"] as const) expect(a[k], k).toBeCloseTo(b[k], 4);
}

/** A rotation by `deg` about the axis (1, 2, 3): an arbitrary orientation for the Cartesian formats. */
function rotation(deg: number): (v: Vec3) => Vec3 {
  const n = Math.hypot(1, 2, 3);
  const [x, y, z] = [1 / n, 2 / n, 3 / n];
  const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  const R = [
    [c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
    [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
    [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)],
  ];
  return (v) => R.map((r) => r[0]! * v[0] + r[1]! * v[1] + r[2]! * v[2]) as unknown as Vec3;
}

/** The expanded cell of a structure as (element, Cartesian in a turned frame), with the turned lattice vectors. */
function turned(s: Structure, deg = 37) {
  const turn = rotation(deg);
  const m = orthogonalizationMatrix(s.cell);
  const vectors = [0, 1, 2].map((j) => turn([m[0][j]!, m[1][j]!, m[2][j]!]));
  const atoms = expandToUnitCell(s).atoms.map((a) => ({ element: a.species, frac: a.frac, cart: turn(fractionalToCartesian(s.cell, a.frac)) }));
  return { vectors, atoms };
}

const f = (x: number) => x.toFixed(10);
const row = (v: readonly number[]) => v.map(f).join(" ");

describe("other formats give the same crystal as the CIF", () => {
  for (const [name, s] of [["quartz", quartz], ["halite", halite]] as const) {
    const ref = cellAtoms(s);
    const { vectors, atoms } = turned(s);
    const elements = [...new Set(atoms.map((a) => a.element))];

    it(`${name}: VASP POSCAR, Cartesian, scaled by 2, in a turned frame`, () => {
      const text = [
        `${name} test`,
        "2.0",
        ...vectors.map((v) => row(v.map((x) => x / 2))),
        elements.map((e) => `${e}_pv`).join(" "),
        elements.map((e) => atoms.filter((a) => a.element === e).length).join(" "),
        "Selective dynamics",
        "Cartesian",
        ...elements.flatMap((e) => atoms.filter((a) => a.element === e).map((a) => `${row(a.cart.map((x) => x / 2))} T T F`)),
      ].join("\n");
      const read = readStructure(text, "POSCAR");
      expect(read.format).toBe("VASP");
      sameCell(read.cell, s.cell);
      expect(cellAtoms(read)).toEqual(ref);
    });

    it(`${name}: VASP CONTCAR, Direct, with a negative scale (the volume)`, () => {
      const volume = Math.abs(latticeFromVectors(vectors).cell.a > 0 ? det(vectors) : 0);
      const text = [
        "test",
        `-${f(volume)}`,
        ...vectors.map((v) => row(v.map((x) => x * 0.37))),
        elements.join(" "),
        elements.map((e) => atoms.filter((a) => a.element === e).length).join(" "),
        "Direct",
        ...elements.flatMap((e) => atoms.filter((a) => a.element === e).map((a) => row(a.frac))),
      ].join("\n");
      const read = readStructure(text, "CONTCAR");
      sameCell(read.cell, s.cell);
      expect(cellAtoms(read)).toEqual(ref);
    });

    it(`${name}: extended XYZ`, () => {
      const text = [
        String(atoms.length),
        `Lattice="${vectors.map(row).join(" ")}" Properties=species:S:1:pos:R:3:forces:R:3 pbc="T T T"`,
        ...atoms.map((a) => `${a.element} ${row(a.cart)} 0 0 0`),
      ].join("\n");
      const read = readStructure(text, "frame.extxyz");
      expect(read.format).toBe("Extended XYZ");
      sameCell(read.cell, s.cell);
      expect(cellAtoms(read)).toEqual(ref);
    });

    it(`${name}: XSF, FHI-aims, CASTEP (LATTICE_CART, POSITIONS_ABS in bohr), Quantum ESPRESSO (bohr and alat)`, () => {
      const xsf = ["CRYSTAL", "PRIMVEC", ...vectors.map(row), "PRIMCOORD", `${atoms.length} 1`, ...atoms.map((a) => `${a.element} ${row(a.cart)}`)].join("\n");
      const aims = [...vectors.map((v) => `lattice_vector ${row(v)}`), ...atoms.map((a, i) => (i % 2 ? `atom_frac ${row(a.frac)} ${a.element}` : `atom ${row(a.cart)} ${a.element}`))].join("\n");
      const castep = [
        "%BLOCK LATTICE_CART",
        "ang",
        ...vectors.map(row),
        "%ENDBLOCK LATTICE_CART",
        "%BLOCK POSITIONS_ABS",
        "bohr",
        ...atoms.map((a) => `${a.element} ${row(a.cart.map((x) => x / BOHR))}`),
        "%ENDBLOCK POSITIONS_ABS",
      ].join("\n");
      const alat = Math.hypot(...vectors[0]!) / BOHR; // bohr
      const qe = [
        "&CONTROL calculation='scf' /",
        `&SYSTEM ibrav = 0, celldm(1) = ${f(alat)}, nat = ${atoms.length}, ntyp = ${elements.length} /`,
        "ATOMIC_SPECIES",
        ...elements.map((e, i) => `${e}${i + 1} 1.0 ${e}.pbe-n-kjpaw_psl.1.0.0.UPF`),
        "CELL_PARAMETERS bohr",
        ...vectors.map((v) => row(v.map((x) => x / BOHR))),
        "ATOMIC_POSITIONS {alat}",
        ...atoms.map((a) => `${a.element}${elements.indexOf(a.element) + 1} ${row(a.cart.map((x) => x / (alat * BOHR)))}`),
        "K_POINTS gamma",
      ].join("\n");
      for (const [text, file, format] of [[xsf, "s.xsf", "XSF"], [aims, "geometry.in", "FHI-aims"], [castep, "s.cell", "CASTEP"], [qe, "scf.in", "Quantum ESPRESSO"]] as const) {
        const read = readStructure(text, file);
        expect(read.format, file).toBe(format);
        sameCell(read.cell, s.cell);
        expect(cellAtoms(read), file).toEqual(ref);
      }
    });

    it(`${name}: PDB in P 1 and CASTEP LATTICE_ABC (Cartesian in MOTIF's own axes)`, () => {
      const c = s.cell;
      const own = expandToUnitCell(s).atoms.map((a) => ({ element: a.species, cart: fractionalToCartesian(c, a.frac) }));
      const pad = (v: number, w: number, d: number) => v.toFixed(d).padStart(w);
      const pdb = [
        `CRYST1${pad(c.a, 9, 3)}${pad(c.b, 9, 3)}${pad(c.c, 9, 3)}${pad(c.alpha, 7, 2)}${pad(c.beta, 7, 2)}${pad(c.gamma, 7, 2)} P 1           1`,
        ...own.map(
          (a, i) =>
            `HETATM${String(i + 1).padStart(5)} ${a.element.toUpperCase().padEnd(4)} UNK A   1    ${pad(a.cart[0], 8, 3)}${pad(a.cart[1], 8, 3)}${pad(a.cart[2], 8, 3)}  1.00  0.00          ${a.element.toUpperCase().padStart(2)}`,
        ),
        "END",
      ].join("\n");
      const read = readStructure(pdb, "s.pdb");
      expect(read.format).toBe("PDB");
      expect(read.molecule).toBeUndefined();
      // PDB keeps 3 decimals of angstrom: compare to 1e-3 of the cell.
      const near = (x: string[], y: string[]) =>
        x.forEach((line, i) => {
          const [ea, ...pa] = line.split(" ");
          const [eb, ...pb] = y[i]!.split(" ");
          expect(ea).toBe(eb);
          pa.forEach((v, k) => expect(Math.abs(Number(v) - Number(pb[k])) % 1).toBeLessThan(2e-3));
        });
      near(cellAtoms(read), ref);
      const castep = [
        "%block lattice_abc",
        `${f(c.a)} ${f(c.b)} ${f(c.c)}`,
        `${f(c.alpha)} ${f(c.beta)} ${f(c.gamma)}`,
        "%endblock lattice_abc",
        "%block positions_abs",
        ...own.map((a) => `${a.element} ${row(a.cart)}`),
        "%endblock positions_abs",
      ].join("\n");
      expect(cellAtoms(readStructure(castep, "s.cell"))).toEqual(ref);
    });

    it(`${name}: SHELX with the symmetry as SYMM and LATT, from the CIF's operations`, () => {
      // The CIF's operations without the identity; a non-centrosymmetric LATT so all are listed as SYMM.
      const symm = s.operations.filter((o) => o.xyz.replace(/\s/g, "").toLowerCase() !== "x,y,z").map((o) => `SYMM ${o.xyz.toUpperCase()}`);
      const sfac = [...new Set(s.sites.map((x) => x.element))];
      const res = [
        `TITL ${name} test`,
        `CELL 0.71073 ${s.cell.a} ${s.cell.b} ${s.cell.c} ${s.cell.alpha} ${s.cell.beta} ${s.cell.gamma}`,
        "ZERR 4 0.001 0.001 0.001 0 0 0",
        "LATT -1",
        ...symm,
        `SFAC ${sfac.join(" ")}`,
        "UNIT 1 1",
        "FVAR 0.5 0.25",
        ...s.sites.map((x, i) => `${x.label} ${sfac.indexOf(x.element) + 1} ${x.frac.map((v, k) => (i === 0 && k === 0 ? 10 + v : v).toFixed(6)).join(" ")} 11.00000 0.01=\n   0.02`),
        "Q1 1 0.1 0.2 0.3 11.0 0.05 1.2",
        "HKLF 4",
        "END",
      ].join("\n");
      const read = readStructure(res, "s.res");
      expect(read.format).toBe("SHELX");
      expect(read.operations.length).toBe(s.operations.length);
      expect(cellAtoms(read)).toEqual(ref);
    });
  }
});

describe("details of the readers", () => {
  it("SHELX: LATT 4 (F, centrosymmetric) with only the proper rotations as SYMM gives halite's 192 operations", () => {
    const proper = halite.operations.filter((o) => {
      const r = o.rotation;
      const d = r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) - r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) + r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
      return d > 0 && o.translation.every((t) => Math.abs(t) < 1e-9) && o.xyz.replace(/\s/g, "") !== "x,y,z";
    });
    expect(proper.length).toBe(23);
    const res = ["TITL NaCl", "CELL 0.71 5.64 5.64 5.64 90 90 90", "LATT 4", ...proper.map((o) => `SYMM ${o.xyz}`), "SFAC Na Cl", "NA1 1 0 0 0 10.02083 0.01", "CL1 2 0.5 0.5 0.5 10.02083 0.01", "END"].join("\n");
    const read = readStructure(res, "nacl.ins");
    expect(read.operations.length).toBe(192);
    const atoms = expandToUnitCell(read).atoms;
    expect(atoms.filter((a) => a.species === "Na").length).toBe(4);
    expect(atoms.filter((a) => a.species === "Cl").length).toBe(4);
    // sof 10.02083 is 0.02083 held fixed (SHELX's sof is the site's multiplicity share), as written.
    expect(read.sites[0]!.occupancy).toBeCloseTo(0.02083, 9);
  });

  it("SHELX: free-variable occupancies", () => {
    const res = (sof: string) => ["CELL 1 5 5 5 90 90 90", "LATT -1", "SFAC Fe Mg", "FVAR 1.0 0.7", `FE1 1 0.1 0.2 0.3 ${sof} 0.01`, "END"].join("\n");
    expect(readStructure(res("21.0"), "a.res").sites[0]!.occupancy).toBeCloseTo(0.7, 12);
    expect(readStructure(res("-21.0"), "a.res").sites[0]!.occupancy).toBeCloseTo(0.3, 12);
    expect(readStructure(res("10.5"), "a.res").sites[0]!.occupancy).toBeCloseTo(0.5, 12);
    expect(() => readStructure(res("31.0"), "a.res")).toThrow(/free variable 3/);
  });

  it("plain XYZ is a molecule: in a box with room around it, no cell outline wanted", () => {
    const water = ["3", "water", "O 0 0 0", "H 0.9572 0 0", "8 -0.2400 0.9266 0"].join("\n");
    const read = readStructure(water, "water.xyz");
    expect(read.format).toBe("XYZ");
    expect(read.molecule).toBe(true);
    expect(read.sites.map((x) => x.element)).toEqual(["O", "H", "O"]); // atomic number 8 is oxygen
    expect(read.cell.a).toBeCloseTo(0.9572 + 0.24 + 2 * MOLECULE_PAD, 9);
    // The O-H distance is kept.
    const [o, h] = [read.sites[0]!, read.sites[1]!].map((x) => fractionalToCartesian(read.cell, x.frac));
    expect(Math.hypot(o![0] - h![0], o![1] - h![1], o![2] - h![2])).toBeCloseTo(0.9572, 9);
  });

  it("PDB in another space group is drawn as the listed model, saying why", () => {
    const pdb = ["CRYST1   10.000   10.000   10.000  90.00  90.00  90.00 P 21 21 21    4", "ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00  0.00           C", "END"].join("\n");
    const read = readStructure(pdb, "p.pdb");
    expect(read.molecule).toBe(true);
    expect(read.spaceGroupName).toMatch(/P 21 21 21 not applied/);
  });

  it("refused rather than guessed: left-handed lattices, unknown elements, QE ibrav other than 0, VASP 4 without names", () => {
    const poscar = (vectors: string[], names = "Si") => ["x", "1", ...vectors, names, "1", "Direct", "0 0 0"].join("\n");
    expect(() => readStructure(poscar(["5 0 0", "0 5 0", "0 0 -5"]), "POSCAR")).toThrow(/left-handed/);
    expect(() => readStructure(poscar(["5 0 0", "0 5 0", "0 0 5"], "Xx"), "POSCAR")).toThrow(/not an element/);
    expect(() => readStructure(["x", "1", "5 0 0", "0 5 0", "0 0 5", "1", "Direct", "0 0 0"].join("\n"), "POSCAR")).toThrow(/no species names/);
    expect(() => readStructure("&SYSTEM ibrav=2, celldm(1)=10.2 /\nATOMIC_POSITIONS crystal\nSi 0 0 0\n", "si.in")).toThrow(/ibrav = 2/);
    expect(() => readStructure(["2", "", "Ox 0 0 0", "H 1 0 0"].join("\n"), "m.xyz")).toThrow(/"Ox"/);
  });

  it("CIF, mCIF and RMC keep their names", () => {
    expect(halite.format).toBeUndefined(); // readCif alone does not set it
    expect(readStructure(readFileSync("examples/halite-NaCl_COD-9008678.cif", "utf8"), "h.cif").format).toBe("CIF");
    expect(readStructure(readFileSync("examples/MnF2-antiferromagnet_handwritten.mcif", "utf8"), "m.mcif").format).toBe("mCIF");
    expect(readStructure(readFileSync("examples/SrTiO3-supercell_generated.rmc6f", "utf8"), "s.rmc6f").format).toBe("RMC");
  });
});

function det(v: readonly Vec3[]): number {
  const [a, b, c] = v as [Vec3, Vec3, Vec3];
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
}
