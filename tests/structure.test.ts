import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fractionalToCartesian } from "../src/structure/cell";
import { expandToUnitCell } from "../src/structure/expand";
import { readCif } from "../src/structure/readCif";
import { parseSymmetryOperation } from "../src/structure/symmetry";
import type { Vec3 } from "../src/structure/types";

const example = (name: string): string => readFileSync(`examples/${name}.cif`, "utf8");
const names = readdirSync("examples").filter((f) => f.endsWith(".cif")).map((f) => f.replace(/\.cif$/, ""));

/** Difference of two fractional coordinates, to the nearest lattice translation. */
const periodic = (x: number): number => Math.abs(x - Math.round(x));
const sameFrac = (p: Vec3, q: readonly number[], tol: number): boolean => [0, 1, 2].every((i) => periodic(p[i]! - q[i]!) < tol);

interface Reference {
  cell: number[];
  atoms: { element: string; label: string; occ: number; frac: number[]; cart: number[] }[];
}

describe("against gemmi (independent reference, scripts/gemmi_reference.py)", () => {
  it("covers every example", () => expect(names.length).toBeGreaterThanOrEqual(5));

  for (const name of names) {
    const ref = JSON.parse(readFileSync(`tests/reference/${name}.json`, "utf8")) as Reference;
    const structure = readCif(example(name));
    const { atoms, warnings } = expandToUnitCell(structure);

    it(`${name}: same cell`, () => {
      const c = structure.cell;
      expect([c.a, c.b, c.c, c.alpha, c.beta, c.gamma]).toEqual(ref.cell);
    });

    it(`${name}: same atoms in one unit cell, one to one`, () => {
      // Tolerance 1e-5: quartz gives z = 0.33333 for 1/3, so the images of that site that coincide differ by 7e-6,
      // and the two programs keep different ones of them.
      // gemmi lists each element of a shared site separately; MOTIF makes them components of one atom.
      const ours = atoms.flatMap((atom) => atom.components.map((c) => ({ element: c.element, occupancy: c.occupancy, frac: atom.frac })));
      expect(ours.length).toBe(ref.atoms.length);
      const unmatched = [...ref.atoms];
      for (const atom of ours) {
        const i = unmatched.findIndex((r) => r.element === atom.element && Math.abs(r.occ - atom.occupancy) < 1e-9 && sameFrac(atom.frac, r.frac, 1e-5));
        expect(i, `${atom.element} at ${atom.frac.join(", ")} is not in the gemmi list`).toBeGreaterThanOrEqual(0);
        unmatched.splice(i, 1);
      }
      expect(unmatched).toEqual([]);
      expect(warnings).toEqual([]);
    });

    it(`${name}: same cartesian axes (a along x, b in xy, c* along z)`, () => {
      for (const r of ref.atoms) {
        const p = fractionalToCartesian(structure.cell, r.frac as unknown as Vec3);
        for (let i = 0; i < 3; i++) expect(p[i]).toBeCloseTo(r.cart[i]!, 9);
      }
    });

    it(`${name}: fractional coordinates lie in [0, 1)`, () => {
      for (const atom of atoms) for (const x of atom.frac) expect(x >= 0 && x < 1).toBe(true);
    });
  }
});

/** Distances from atom i to every other atom, over the neighbouring cells too. */
function distances(name: string): { species: string; to: { species: string; d: number }[] }[] {
  const structure = readCif(example(name));
  const { atoms } = expandToUnitCell(structure);
  return atoms.map((p) => {
    const to: { species: string; d: number }[] = [];
    for (const q of atoms) {
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
        const a = fractionalToCartesian(structure.cell, p.frac);
        const b = fractionalToCartesian(structure.cell, [q.frac[0] + i, q.frac[1] + j, q.frac[2] + k]);
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d > 1e-6) to.push({ species: q.species, d });
      }
    }
    return { species: p.species, to };
  });
}

describe("by hand", () => {
  it("silicon: the eight atoms of the diamond structure (origin at an atom)", () => {
    const { atoms } = expandToUnitCell(readCif(example("silicon_COD-9008565")));
    const expected = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0], [0.25, 0.25, 0.25], [0.25, 0.75, 0.75], [0.75, 0.25, 0.75], [0.75, 0.75, 0.25]];
    expect(atoms.length).toBe(8);
    for (const e of expected) expect(atoms.some((a) => sameFrac(a.frac, e, 1e-9))).toBe(true);
  });

  it("silicon: four neighbours at a*sqrt(3)/4", () => {
    const a = readCif(example("silicon_COD-9008565")).cell.a;
    for (const atom of distances("silicon_COD-9008565")) {
      const near = atom.to.filter((t) => t.d < 3);
      expect(near.length).toBe(4);
      for (const t of near) expect(t.d).toBeCloseTo((a * Math.sqrt(3)) / 4, 9);
    }
  });

  it("rock salt: six unlike neighbours at a/2", () => {
    const a = readCif(example("halite-NaCl_COD-9008678")).cell.a;
    for (const atom of distances("halite-NaCl_COD-9008678")) {
      const near = atom.to.filter((t) => t.d < a / 2 + 0.01);
      expect(near.length).toBe(6);
      for (const t of near) {
        expect(t.d).toBeCloseTo(a / 2, 9);
        expect(t.species).not.toBe(atom.species);
      }
    }
  });

  it("perovskite: Ti has six O at a/2, Sr has twelve O at a/sqrt(2)", () => {
    const a = readCif(example("perovskite-SrTiO3_COD-9006864")).cell.a;
    for (const atom of distances("perovskite-SrTiO3_COD-9006864")) {
      const oxygens = atom.to.filter((t) => t.species === "O").map((t) => t.d);
      if (atom.species === "Ti") expect(oxygens.filter((d) => Math.abs(d - a / 2) < 1e-6).length).toBe(6);
      if (atom.species === "Sr") expect(oxygens.filter((d) => Math.abs(d - a / Math.SQRT2) < 1e-6).length).toBe(12);
    }
  });

  it("quartz (hexagonal axes): every Si has four O at about 1.61 A, every O two Si", () => {
    for (const atom of distances("quartz_COD-9009666")) {
      const near = atom.to.filter((t) => t.d < 2 && t.species !== atom.species);
      expect(near.length).toBe(atom.species === "Si" ? 4 : 2);
      for (const t of near) expect(t.d > 1.59 && t.d < 1.63).toBe(true);
    }
  });
});

describe("reading", () => {
  it("parses symmetry operations", () => {
    const op = parseSymmetryOperation("x-y, x, 1/2+z");
    expect(op.rotation).toEqual([[1, -1, 0], [1, 0, 0], [0, 0, 1]]);
    expect(op.translation).toEqual([0, 0, 0.5]);
    expect(parseSymmetryOperation("-y+1/4,x+3/4,z+1/4").translation).toEqual([0.25, 0.75, 0.25]);
  });

  const minimal = (ops: string[], hm = "P 1"): string =>
    `data_t\n_cell_length_a 4\n_cell_length_b 5\n_cell_length_c 6\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n` +
    `_symmetry_space_group_name_H-M '${hm}'\n` +
    (ops.length ? `loop_\n_symmetry_equiv_pos_as_xyz\n${ops.map((o) => `'${o}'`).join("\n")}\n` : "") +
    `loop_\n_atom_site_label\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nFe1 0.1 0.2 0.3(1)\nO1 0 0 0\n`;

  it("reads a minimal file, takes the element from the label, strips uncertainties", () => {
    const s = readCif(minimal(["x,y,z", "-x,-y,-z"], "P -1"));
    expect(s.sites.map((x) => x.element)).toEqual(["Fe", "O"]);
    expect(s.sites[0]!.frac).toEqual([0.1, 0.2, 0.3]);
    const { atoms } = expandToUnitCell(s);
    expect(atoms.length).toBe(3); // Fe twice, O on the inversion centre once
  });

  it("refuses a file without symmetry operations", () => {
    expect(() => readCif(minimal([]))).toThrow(/no symmetry operations/);
  });

  it("refuses an operation list that is not a complete group", () => {
    expect(() => readCif(minimal(["x,y,z", "-y,x,z"]))).toThrow(/not a complete group/);
  });

  it("refuses a centred space group whose list lacks the centring", () => {
    expect(() => readCif(minimal(["x,y,z", "-x,-y,-z"], "C 2/m"))).toThrow(/centring/);
  });

  it("refuses text that is not a CIF", () => {
    expect(() => readCif("hello")).toThrow();
  });
});
