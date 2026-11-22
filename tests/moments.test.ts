// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CANVAS, layoutAll, renderSvg, type Drawn, type DrawnArrow, type DrawnSphere } from "../src/render/svg";
import { viewFromAngles } from "../src/render/view";
import { buildScene, cellAxes, DEFAULT_SPEC, largestMoment, momentToCartesian } from "../src/scene/scene";
import { expandToUnitCell, transformMoment } from "../src/structure/expand";
import { readCif } from "../src/structure/readCif";
import { parseMagneticSymmetryOperation } from "../src/structure/symmetry";
import type { Vec3 } from "../src/structure/types";

const mnf2Text = readFileSync("examples/MnF2-antiferromagnet_handwritten.mcif", "utf8");
const mnf2 = readCif(mnf2Text);
const op = (xyz: string) => parseMagneticSymmetryOperation(xyz);
const cubic: Vec3 = [4, 4, 4];
const near = (p: Vec3, q: readonly number[]): void => {
  for (let i = 0; i < 3; i++) expect(p[i]).toBeCloseTo(q[i]!, 9);
};

/** A small P1-like magnetic file: given operations, centrings, cell and atoms with moments. */
function mcif(o: { ops: string[]; centrings?: string[]; cell?: string; atoms: string[]; moments: string[] }): string {
  return (
    `data_t\n${o.cell ?? "_cell_length_a 4\n_cell_length_b 4\n_cell_length_c 8\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90"}\n` +
    `loop_\n_space_group_symop_magn_operation.id\n_space_group_symop_magn_operation.xyz\n${o.ops.map((x, i) => `${i + 1} ${x}`).join("\n")}\n` +
    (o.centrings ? `loop_\n_space_group_symop_magn_centering.id\n_space_group_symop_magn_centering.xyz\n${o.centrings.map((x, i) => `${i + 1} ${x}`).join("\n")}\n` : "") +
    `loop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n${o.atoms.join("\n")}\n` +
    `loop_\n_atom_site_moment.label\n_atom_site_moment.crystalaxis_x\n_atom_site_moment.crystalaxis_y\n_atom_site_moment.crystalaxis_z\n${o.moments.join("\n")}\n`
  );
}

describe("how a moment transforms (axial vector, odd under time reversal), by hand", () => {
  const m: Vec3 = [1, 2, 3];
  it("identity keeps it; time reversal alone flips it", () => {
    near(transformMoment(op("x,y,z,+1"), m, cubic), [1, 2, 3]);
    near(transformMoment(op("x,y,z,-1"), m, cubic), [-1, -2, -3]);
  });
  it("inversion keeps it (unlike a displacement); inversion with time reversal flips it", () => {
    near(transformMoment(op("-x,-y,-z,+1"), m, cubic), [1, 2, 3]);
    near(transformMoment(op("-x,-y,-z,-1"), m, cubic), [-1, -2, -3]);
  });
  it("a twofold axis along z keeps the z component and flips the other two", () => {
    near(transformMoment(op("-x,-y,z,+1"), m, cubic), [-1, -2, 3]);
  });
  it("a mirror plane keeps the component perpendicular to it and flips the two in the plane", () => {
    near(transformMoment(op("x,y,-z,+1"), m, cubic), [-1, -2, 3]); // mirror perpendicular to z
    near(transformMoment(op("-x,y,z,+1"), m, cubic), [1, -2, -3]); // mirror perpendicular to x
  });
  it("a fourfold axis along z turns x into y", () => {
    near(transformMoment(op("-y,x,z,+1"), [1, 0, 0], cubic), [0, 1, 0]);
  });
  it("hexagonal axes: the threefold axis turns a moment along a into one along b, the same size, 120 degrees away", () => {
    const quartz = readCif(readFileSync("examples/quartz_COD-9009666.cif", "utf8"));
    const edges: Vec3 = [quartz.cell.a, quartz.cell.b, quartz.cell.c];
    const turned = transformMoment(op("-y,x-y,z,+1"), [2, 0, 0], edges);
    near(turned, [0, 2, 0]);
    const [p, q] = [momentToCartesian(quartz, [2, 0, 0]), momentToCartesian(quartz, turned)];
    expect(Math.hypot(...q)).toBeCloseTo(2, 9);
    expect((p[0] * q[0] + p[1] * q[1] + p[2] * q[2]) / 4).toBeCloseTo(Math.cos((120 * Math.PI) / 180), 9);
  });
  it("no symmetry operation of any example changes the size of a moment", () => {
    for (const file of ["quartz_COD-9009666.cif", "olivine-FeMg_COD-1541262.cif", "halite-NaCl_COD-9008678.cif", "MnF2-antiferromagnet_handwritten.mcif"]) {
      const s = readCif(readFileSync(`examples/${file}`, "utf8"));
      const edges: Vec3 = [s.cell.a, s.cell.b, s.cell.c];
      const start: Vec3 = [0.7, -1.3, 2.1];
      const size = Math.hypot(...momentToCartesian(s, start));
      for (const o of s.operations) expect(Math.hypot(...momentToCartesian(s, transformMoment(o, start, edges)))).toBeCloseTo(size, 9);
    }
  });
});

describe("MnF2, the textbook antiferromagnet (hand-written mCIF)", () => {
  it("reads the magnetic group: 16 operations, 8 of them with time reversal, as P4_2'/mnm' says", () => {
    expect(mnf2.magnetic).toBe(true);
    expect(mnf2.spaceGroupName).toBe("P4_2'/mnm'");
    expect(mnf2.operations.length).toBe(16);
    const sign = (xyz: string): number => mnf2.operations.find((o) => o.xyz === xyz)!.timeReversal!;
    expect(sign("-y+1/2,x+1/2,z+1/2")).toBe(-1); // 4_2' : primed
    expect(sign("x+1/2,-y+1/2,z+1/2")).toBe(1); // n glide: not primed
    expect(sign("y,x,z")).toBe(-1); // diagonal mirror m': primed
    expect(sign("-x,-y,-z")).toBe(1); // inversion: not primed
    expect(mnf2.operations.filter((o) => o.timeReversal === -1).length).toBe(8);
  });

  it("gives the corner Mn a moment along +c and the body-centre Mn the opposite one, with no symmetry clash", () => {
    const { atoms, warnings } = expandToUnitCell(mnf2);
    expect(warnings).toEqual([]);
    const mn = atoms.filter((a) => a.species === "Mn");
    expect(mn.length).toBe(2);
    expect(atoms.filter((a) => a.species === "F").length).toBe(4);
    const corner = mn.find((a) => a.frac.every((x) => Math.abs(x) < 1e-9))!;
    const centre = mn.find((a) => a.frac.every((x) => Math.abs(x - 0.5) < 1e-9))!;
    near(corner.moment!, [0, 0, 5]);
    near(centre.moment!, [0, 0, -5]);
    expect(atoms.filter((a) => a.species === "F").every((a) => a.moment === undefined)).toBe(true);
  });

  it("reports a moment that the site symmetry does not allow", () => {
    const tilted = readCif(mnf2Text.replace("Mn1 0 0 5.0", "Mn1 3.0 0 4.0"));
    expect(expandToUnitCell(tilted).warnings.join(" ")).toMatch(/not allowed by the magnetic symmetry/);
  });

  it("atoms repeated by lattice translations keep their moment", () => {
    const scene = buildScene(mnf2, { ...DEFAULT_SPEC, range: { from: [0, 0, 0], to: [1, 1, 2], boundary: "both" } });
    const mn = scene.spheres.filter((s) => s.species === "Mn");
    expect(mn.length).toBe(8 + 4 + 2); // corners of two stacked cells (12) and two body centres
    for (const s of mn) {
      const atCorner = Math.abs(s.frac![0] - Math.round(s.frac![0])) < 1e-9;
      near(s.moment!, [0, 0, atCorner ? 5 : -5]);
    }
  });
});

describe("time reversal in centring translations", () => {
  it("an anti-translation (0,0,1/2 with time reversal) reverses the moment half a cell up", () => {
    const s = readCif(mcif({ ops: ["x,y,z,+1"], centrings: ["x,y,z,+1", "x,y,z+1/2,-1"], atoms: ["Fe1 Fe 0 0 0"], moments: ["Fe1 1.5 0 0"] }));
    const { atoms, warnings } = expandToUnitCell(s);
    expect(warnings).toEqual([]);
    expect(atoms.length).toBe(2);
    near(atoms.find((a) => a.frac[2] === 0)!.moment!, [1.5, 0, 0]);
    near(atoms.find((a) => a.frac[2] === 0.5)!.moment!, [-1.5, 0, 0]);
  });

  it("combines the operation list with the centring list (both loops), old tag spelling included", () => {
    const text = mcif({ ops: ["x,y,z,+1", "-x,-y,-z,+1"], centrings: ["x,y,z,+1", "x+1/2,y+1/2,z+1/2,-1"], atoms: ["Fe1 Fe 0.1 0.2 0.3"], moments: ["Fe1 0 0 2"] });
    expect(readCif(text).operations.length).toBe(4);
    const old = text.replace(/_space_group_symop_magn_operation\.xyz/, "_space_group_symop.magn_operation_xyz").replace(/_space_group_symop_magn_centering\.xyz/, "_space_group_symop.magn_centering_xyz");
    const { atoms } = expandToUnitCell(readCif(old));
    expect(atoms.length).toBe(4);
    expect(atoms.map((a) => a.moment![2]).sort()).toEqual([-2, -2, 2, 2]);
  });

  it("refuses inconsistent time-reversal signs, moments in another form, an unknown label, and modulated structures", () => {
    // Two anti-operations must combine to an ordinary one: -x,-y,z' twice is the identity, fine; but 4' then 4' = 2 must be unprimed.
    expect(() => readCif(mcif({ ops: ["x,y,z,+1", "-y,x,z,-1", "-x,-y,z,-1", "y,-x,z,-1"], atoms: ["Fe1 Fe 0 0 0"], moments: ["Fe1 0 0 0"] }))).toThrow(/time-reversal/);
    const ok = mcif({ ops: ["x,y,z,+1"], atoms: ["Fe1 Fe 0 0 0"], moments: ["Fe1 0 0 1"] });
    expect(() => readCif(ok.replace(/crystalaxis/g, "cartn"))).toThrow(/crystal axes/);
    expect(() => readCif(ok.replace("Fe1 0 0 1", "Fe9 0 0 1"))).toThrow(/not in the atom list/);
    expect(() => readCif(ok.replace("data_t", "data_t\n_cell_modulation_dimension 1"))).toThrow(/modulated/);
  });
});

describe("moment arrows", () => {
  const scene = buildScene(mnf2, { ...DEFAULT_SPEC, range: { from: [0, 0, 0], to: [1, 1, 1], boundary: "once" }, momentLength: 3 });

  it("the largest moment gets the chosen length; direction is the moment's", () => {
    expect(largestMoment(mnf2)).toBeCloseTo(5, 9);
    expect(scene.arrows.length).toBe(2);
    for (const a of scene.arrows) {
      const s = scene.spheres[a.sphere]!;
      near(a.vector, [0, 0, s.moment![2] > 0 ? 3 : -3]);
    }
  });

  it("a smaller moment gets a proportionally shorter arrow", () => {
    const s = readCif(mcif({ ops: ["x,y,z,+1"], atoms: ["Fe1 Fe 0 0 0", "Fe2 Fe 0.5 0.5 0.5"], moments: ["Fe1 0 0 4", "Fe2 2 0 0"] }));
    const lengths = buildScene(s, { ...DEFAULT_SPEC, range: { from: [0, 0, 0], to: [1, 1, 1], boundary: "once" }, momentLength: 3 }).arrows.map((a) => Math.hypot(...a.vector));
    expect(lengths[0]).toBeCloseTo(3, 9);
    expect(lengths[1]).toBeCloseTo(1.5, 9);
  });

  it("seen from the side, the arrow of the corner Mn points up the page and that of the centre Mn down", () => {
    const side = viewFromAngles(0, 0); // c up
    const drawn = layoutAll(scene, side, DEFAULT_CANVAS);
    const heads = drawn.filter((d) => d.kind === "arrow" && d.head !== undefined);
    expect(heads.length).toBe(2);
    const spheres = drawn.filter((d) => d.kind === "sphere" && d.style === "Mn");
    for (const h of heads) {
      if (h.kind !== "arrow") continue;
      const tipY = Number(h.head!.split(" ")[0]!.split(",")[1]);
      // The corner Mn is the lower of the two on screen (z = 0); its arrow tip is above its centre, the other's below.
      const lower = spheres.reduce((p, q) => (p.kind === "sphere" && q.kind === "sphere" && p.y > q.y ? p : q));
      const upper = spheres.find((s) => s !== lower)!;
      if (lower.kind !== "sphere" || upper.kind !== "sphere") continue;
      const own = Math.abs(h.x1 - lower.x) < 1e-6 ? lower : upper;
      if (own === lower) expect(tipY).toBeLessThan(lower.y); // SVG y runs down: up the page is smaller y
      else expect(tipY).toBeGreaterThan(upper.y);
    }
  });

  it("the arrow passes through the atom, centred on it: tail and tip are equally far from the centre, on opposite sides", () => {
    const drawn = layoutAll(scene, viewFromAngles(25, 15), DEFAULT_CANVAS);
    for (const s of drawn) {
      if (s.kind !== "sphere" || s.style !== "Mn") continue;
      const parts = drawn.filter((d) => d.kind === "arrow" && Math.abs((d.x2 - d.x1) * (s.y - d.y1) - (d.y2 - d.y1) * (s.x - d.x1)) < 1e-3 && Math.hypot(d.x1 - s.x, d.y1 - s.y) < 400);
      const tail = parts.find((d) => d.kind === "arrow" && d.head === undefined)!;
      const front = parts.find((d) => d.kind === "arrow" && d.head !== undefined)!;
      if (tail.kind !== "arrow" || front.kind !== "arrow") throw new Error("arrow parts not found");
      const [tx, ty] = front.head!.split(" ")[0]!.split(",").map(Number) as [number, number];
      expect(tx - s.x).toBeCloseTo(-(tail.x1 - s.x), 0);
      expect(ty - s.y).toBeCloseTo(-(tail.y1 - s.y), 0);
    }
  });

  it("looking along the moment: the part towards the viewer is drawn over the atom, the part away under it", () => {
    const fromAbove = viewFromAngles(0, 90); // +c towards the viewer
    const order = layoutAll(scene, fromAbove, DEFAULT_CANVAS).filter((d) => d.kind !== "cell");
    const index = (pred: (d: (typeof order)[number]) => boolean): number => order.findIndex(pred);
    // Corner Mn (moment towards the viewer) is the deeper of the two Mn (z = 0); take its sphere and parts by depth.
    const spheres = order.filter((d) => d.kind === "sphere" && d.style === "Mn");
    const back = spheres.reduce((p, q) => (p.depth < q.depth ? p : q));
    const parts = order.filter((d) => d.kind === "arrow" && Math.abs(d.depth - back.depth) < 1.6);
    const head = parts.find((d) => d.kind === "arrow" && d.depth > back.depth)!;
    const tail = parts.find((d) => d.kind === "arrow" && d.depth < back.depth)!;
    expect(index((d) => d === tail)).toBeLessThan(index((d) => d === back));
    expect(index((d) => d === head)).toBeGreaterThan(index((d) => d === back));
  });

  it("is a rod that pierces the sphere: behind, the sphere's outline cuts it; in front, it has a rounded foot on the sphere's face", () => {
    const isSphere = (d: Drawn): d is DrawnSphere => d.kind === "sphere";
    const isArrow = (d: Drawn): d is DrawnArrow => d.kind === "arrow";
    const draw = (view: ReturnType<typeof viewFromAngles>) => {
      const order = layoutAll(scene, view, DEFAULT_CANVAS);
      return { order, mn: order.filter(isSphere).filter((d) => d.style === "Mn"), arrows: order.filter(isArrow) };
    };
    // In the screen plane: two parts per atom, both from the centre and both drawn before their sphere.
    const flat = draw(viewFromAngles(0, 0));
    expect(flat.arrows.length).toBe(2 * 2);
    for (const d of flat.arrows) {
      const sphere = flat.mn.find((x) => Math.abs(x.x - d.x1) < 1e-6)!;
      expect(flat.order.indexOf(d)).toBeLessThan(flat.order.indexOf(sphere));
      expect(d.svg).not.toContain("arrow-shadow");
    }
    // Tilted: a third part per atom, after the sphere, with the shadow and a foot whose depth along the rod is
    // sin(tilt) times its half-width (an ellipse: the circle where the rod pierces the surface, seen at an angle).
    const tilted = draw(viewFromAngles(0, 40));
    const over = tilted.arrows.filter((d) => d.svg.includes("arrow-shadow"));
    expect(over.length).toBe(2); // one per Mn
    for (const d of over) {
      const sphere = tilted.mn.find((x) => Math.hypot(d.x1 - x.x, d.y1 - x.y) < x.r)!;
      expect(tilted.order.indexOf(d)).toBeGreaterThan(tilted.order.indexOf(sphere));
      // The foot is on the sphere's face, not at its rim: inside the disc by the factor cos(40 degrees).
      expect(Math.hypot(d.x1 - sphere.x, d.y1 - sphere.y) / sphere.r).toBeCloseTo(Math.cos((40 * Math.PI) / 180), 1);
      const rod = /class="arrow-rod" points="([^"]+)"/.exec(d.svg)![1]!.split(" ").map((q) => q.split(",").map(Number));
      expect(rod.length).toBe(4 + 7); // four corners and the seven points of the rounded foot
      const bulge = Math.max(...rod.slice(4).map((q) => Math.abs(q[1]! - d.y1)));
      expect(bulge / (d.width / 2)).toBeCloseTo(Math.sin((40 * Math.PI) / 180), 1);
    }
  });

  it("can be switched off, and says so when an arrow is too short to see", () => {
    expect(buildScene(mnf2, { ...DEFAULT_SPEC, showMoments: false }).arrows).toEqual([]);
    expect(renderSvg(buildScene(mnf2, { ...DEFAULT_SPEC, showMoments: false }), viewFromAngles(0, 0))).not.toContain('class="arrow"');
    expect(buildScene(mnf2, { ...DEFAULT_SPEC, momentLength: 0.5 }).warnings.join(" ")).toMatch(/shorter than the atom/);
  });
});

describe("against pymatgen, an independent program (scripts/pymatgen_moments.py)", () => {
  interface Ref {
    frac: number[];
    moment: number[];
    size: number;
    along: number[];
  }
  const reference = JSON.parse(readFileSync("tests/reference/moments_pymatgen.json", "utf8")) as Record<string, Ref[]>;
  for (const [file, expected] of Object.entries(reference)) {
    it(`${file.split("/").pop()}: every moment in the cell, ${expected.length} atoms`, () => {
      const s = readCif(readFileSync(file, "utf8"));
      const { atoms, warnings } = expandToUnitCell(s);
      expect(warnings).toEqual([]);
      const magnetic = atoms.filter((a) => a.moment);
      expect(magnetic.length).toBe(expected.length);
      const axes = cellAxes(s).map((x) => x.direction);
      for (const atom of magnetic) {
        const ref = expected.find((r) => r.frac.every((x, i) => Math.abs(x - atom.frac[i]! - Math.round(x - atom.frac[i]!)) < 1e-6));
        expect(ref, `no atom at ${atom.frac.join(", ")} in the reference`).toBeDefined();
        // The three numbers (components along a, b, c) ...
        for (let i = 0; i < 3; i++) expect(atom.moment![i]).toBeCloseTo(ref!.moment[i]!, 6);
        // ... and the arrow in real space: its size and its projection on each cell edge.
        const m = momentToCartesian(s, atom.moment!);
        expect(Math.hypot(...m)).toBeCloseTo(ref!.size, 6);
        axes.forEach((axis, i) => expect(m[0] * axis[0] + m[1] * axis[1] + m[2] * axis[2]).toBeCloseTo(ref!.along[i]!, 6));
      }
    });
  }
});
