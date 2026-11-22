// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CANVAS, renderSvg, wedgePaths } from "../src/render/svg";
import { DEFAULT_VIEW } from "../src/render/view";
import { atomsAndBonds } from "../src/scene/bonds";
import { defaultColour, defaultRadius } from "../src/scene/elementStyle";
import { buildScene, DEFAULT_SPEC, MATERIALS, VACANCY_COLOUR, type Material } from "../src/scene/scene";
import { ONE_CELL } from "../src/scene/select";
import { fractionalToCartesian } from "../src/structure/cell";
import { expandToUnitCell } from "../src/structure/expand";
import { readCif } from "../src/structure/readCif";

const structure = (name: string) => readCif(readFileSync(`examples/${name}.cif`, "utf8"));
const olivine = structure("olivine-FeMg_COD-1541262");

/** A one-site P1 file with the given atom rows (label type x y z occupancy). */
const p1 = (rows: string[]): string =>
  `data_t\n_cell_length_a 4\n_cell_length_b 4\n_cell_length_c 4\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n` +
  `_symmetry_space_group_name_H-M 'P 1'\nloop_\n_symmetry_equiv_pos_as_xyz\nx,y,z\n` +
  `loop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n_atom_site_occupancy\n${rows.join("\n")}\n`;

describe("shared sites", () => {
  it("olivine, against gemmi: the same 28 places with the same elements and occupancies", () => {
    const ref = JSON.parse(readFileSync("tests/reference/shared.json", "utf8")) as { places: { cart: number[]; components: Record<string, number> }[] };
    const { atoms, warnings } = expandToUnitCell(olivine);
    expect(warnings).toEqual([]);
    expect(atoms.length).toBe(ref.places.length);
    expect(atoms.length).toBe(28); // Z = 4: 8 (Fe,Mg) + 4 Si + 16 O
    for (const atom of atoms) {
      const here = Object.fromEntries(atom.components.map((c) => [c.element, c.occupancy]));
      const p = fractionalToCartesian(olivine.cell, atom.frac);
      // gemmi's place may be a lattice translation away; compare modulo the (orthorhombic) cell.
      const match = ref.places.find((r) =>
        [olivine.cell.a, olivine.cell.b, olivine.cell.c].every((len, i) => {
          const d = (r.cart[i]! - p[i]!) / len;
          return Math.abs(d - Math.round(d)) * len < 1e-4;
        }),
      );
      expect(match, `${atom.label} is at no place gemmi lists`).toBeDefined();
      expect(here).toEqual(match!.components);
    }
  });

  it("names a shared place by its elements, in file order", () => {
    const { atoms } = expandToUnitCell(olivine);
    const count: Record<string, number> = {};
    for (const a of atoms) count[a.species] = (count[a.species] ?? 0) + 1;
    expect(count).toEqual({ Si: 4, O: 16, "Fe/Mg": 8 });
    const m1 = atoms.find((a) => a.label === "Fe1/Mg1")!;
    expect(m1.components).toEqual([{ element: "Fe", occupancy: 0.878 }, { element: "Mg", occupancy: 0.122 }]);
    expect(m1.occupancy).toBeCloseTo(1, 12);
  });

  it("does not merge different elements that are merely close (0.3 A apart)", () => {
    const s = readCif(p1(["Na1 Na 0.1 0.1 0.1 0.5", "K1 K 0.175 0.1 0.1 0.5"]));
    expect(expandToUnitCell(s).atoms.map((a) => a.species)).toEqual(["Na", "K"]);
  });

  it("warns when the occupancies at one place add up to more than 1", () => {
    const s = readCif(p1(["Na1 Na 0 0 0 0.7", "K1 K 0 0 0 0.6"]));
    expect(expandToUnitCell(s).warnings.join(" ")).toMatch(/more than 1/);
  });

  it("bond rules treat a shared site as one species: every (Fe,Mg) has six O", () => {
    const { atoms, bonds } = atomsAndBonds(olivine, ONE_CELL, [{ centre: "Fe/Mg", neighbour: "O", max: 2.4, complete: true }]);
    const centres = atoms.map((a, i) => ({ a, i })).filter(({ a }) => a.species === "Fe/Mg" && !a.added);
    expect(centres.length).toBeGreaterThan(0);
    for (const { i } of centres) expect(bonds.filter((b) => b.i === i || b.j === i).length).toBe(6);
  });
});

describe("pie spheres", () => {
  it("wedges are the occupancies; two sites with different proportions get different pies", () => {
    const scene = buildScene(olivine, { ...DEFAULT_SPEC, range: { ...ONE_CELL, boundary: "once" } });
    const pies = Object.entries(scene.styles).filter(([, s]) => s.wedges);
    expect(pies.map(([key]) => key).sort()).toEqual(["Fe/Mg@0.860,0.140", "Fe/Mg@0.878,0.122"]);
    for (const [, style] of pies) {
      expect(style.wedges!.reduce((sum, w) => sum + w.fraction, 0)).toBeCloseTo(1, 12);
      expect(style.wedges!.map((w) => w.element)).toEqual(["Fe", "Mg"]);
      expect(style.wedges!.map((w) => w.colour)).toEqual([defaultColour("Fe"), defaultColour("Mg")]);
    }
    expect(scene.spheres.filter((s) => s.species === "Fe/Mg").length).toBe(8);
  });

  it("the wedge order can be chosen; elements not named keep their file order after the named ones", () => {
    const first = (order: string[]) => {
      const styles = buildScene(olivine, { ...DEFAULT_SPEC, looks: { "Fe/Mg": { order } } }).styles;
      return Object.values(styles).find((s) => s.wedges)!.wedges!;
    };
    expect(first(["Mg", "Fe"]).map((w) => w.element)).toEqual(["Mg", "Fe"]);
    expect(first(["Mg"]).map((w) => w.element)).toEqual(["Mg", "Fe"]);
    expect(first(["Xx"]).map((w) => w.element)).toEqual(["Fe", "Mg"]);
    // The shares stay with their elements.
    const mg = first(["Mg", "Fe"]).find((w) => w.element === "Mg")!.fraction;
    expect([0.122, 0.14].some((x) => Math.abs(x - mg) < 1e-9)).toBe(true);
  });

  it("a partly vacant place gets a vacancy wedge, unless that is switched off", () => {
    const s = readCif(p1(["Na1 Na 0 0 0 0.5", "K1 K 0 0 0 0.25", "O1 O 0.5 0.5 0.5 0.8", "Cl1 Cl 0.5 0 0 1"]));
    const range = { ...ONE_CELL, boundary: "once" as const };
    const withVacancy = buildScene(s, { ...DEFAULT_SPEC, range }).styles;
    expect(withVacancy["Na/K@0.500,0.250,0.250"]!.wedges).toEqual([
      { colour: defaultColour("Na"), fraction: 0.5, element: "Na" },
      { colour: defaultColour("K"), fraction: 0.25, element: "K" },
      { colour: VACANCY_COLOUR, fraction: 0.25, element: "vacancy" },
    ]);
    expect(withVacancy["O@0.800,0.200"]!.wedges!.map((w) => w.element)).toEqual(["O", "vacancy"]);
    expect(withVacancy["Cl"]!.wedges).toBeUndefined();
    const without = buildScene(s, { ...DEFAULT_SPEC, range, showVacancy: false }).styles;
    expect(without["O"]!.wedges).toBeUndefined(); // a plain sphere again
    const pie = Object.values(without).find((x) => x.wedges)!;
    expect(pie.wedges!.map((w) => w.fraction)).toEqual([0.5 / 0.75, 0.25 / 0.75]); // scaled to fill the circle
  });

  it("wedge geometry: clockwise from the top, angle = 360 degrees x fraction", () => {
    // Radius 100 at (0, 0): a quarter starting at the top ends at the right; SVG y runs down.
    const quarter = wedgePaths(0, 0, 100, [{ colour: "#111111", fraction: 0.25, element: "A" }, { colour: "#222222", fraction: 0.75, element: "B" }]);
    expect(quarter).toContain('d="M0 0 L0 -100 A100 100 0 0 1 100 0 Z" fill="#111111"');
    // The other three quarters: from the right, the long way round (large-arc flag 1), back to the top.
    expect(quarter).toContain('d="M0 0 L100 0 A100 100 0 1 1 0 -100 Z" fill="#222222"');
    // One element at full occupancy is a full disc, not a zero-length arc.
    expect(wedgePaths(0, 0, 100, [{ colour: "#111111", fraction: 1, element: "A" }])).toBe('<circle cx="0" cy="0" r="100" fill="#111111"/>');
  });

  it("draws each pie as its wedges plus one shaded outline circle", () => {
    const scene = buildScene(olivine, { ...DEFAULT_SPEC, range: { ...ONE_CELL, boundary: "once" }, showLegend: false, showAxes: false });
    const svg = renderSvg(scene, DEFAULT_VIEW, DEFAULT_CANVAS);
    expect(svg.match(/class="wedge"/g)?.length).toBe(8 * 2);
    expect(svg.match(/fill="url\(#pie-shade\)"/g)?.length).toBe(8);
    expect(svg.match(/<circle /g)?.length).toBe(28);
  });
});

describe("surfaces", () => {
  const draw = (atomMaterial: Material, arrowMaterial: Material = "soft") => renderSvg(buildScene(olivine, { ...DEFAULT_SPEC, atomMaterial, arrowMaterial }), DEFAULT_VIEW);
  const soft = draw("soft");
  const circles = (svg: string): string[] => [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.-]+)"/g)].map((m) => m.slice(1).join(" "));

  it("soft is the look there was before, and every surface draws the same atoms at the same places and sizes", () => {
    expect(soft).toBe(renderSvg(buildScene(olivine), DEFAULT_VIEW));
    for (const m of MATERIALS) expect(circles(draw(m))).toEqual(circles(soft));
  });

  it("flat has no shading; glossy, metal and glass add a highlight spot to every sphere; glass is see-through", () => {
    const atoms = buildScene(olivine).spheres.length + buildScene(olivine).legend.length;
    expect(draw("flat")).not.toContain("<radialGradient id=\"g-");
    for (const m of ["glossy", "metal", "glass"] as const) expect(draw(m).match(/class="gloss"/g)?.length).toBe(atoms);
    expect(soft).not.toContain('class="gloss"');
    expect(draw("glass")).toMatch(/<radialGradient id="g-[0-9a-f]+"[^>]*><stop offset="0" stop-color="#[0-9a-f]{6}" stop-opacity="0.1"\/>/);
    expect(draw("glass")).toContain('<g fill-opacity="0.45"><path class="wedge"'); // pies too
    // Metal: light comes back at the rim (the last stop is lighter than the one before it).
    const stops = /<radialGradient id="g-[0-9a-f]+"[^>]*>(.*?)<\/radialGradient>/.exec(draw("metal"))![1]!.match(/stop-color="#[0-9a-f]{6}"/g)!;
    const light = (stop: string): number => [1, 3, 5].reduce((sum, i) => sum + parseInt(stop.slice(13 + i - 1, 15 + i - 1), 16), 0);
    expect(stops.length).toBe(6);
    expect(light(stops[5]!)).toBeGreaterThan(light(stops[4]!));
  });

  it("the arrows' surface is set separately, and applies to the axis arrows too", () => {
    const metalArrows = draw("soft", "metal");
    expect(circles(metalArrows)).toEqual(circles(soft));
    const axisStops = (svg: string): number => /<linearGradient id="axis-a-shaft"[^>]*>(.*?)<\/linearGradient>/.exec(svg)![1]!.match(/<stop /g)!.length;
    expect(axisStops(soft)).toBe(4);
    expect(axisStops(metalArrows)).toBe(6);
    expect(draw("soft", "glass")).toMatch(/<g class="axes-outline"[^>]*fill-opacity="0.45"/);
    // The letters of the axes stay solid.
    for (const m of draw("soft", "glass").matchAll(/<text [^>]*font-style="italic"[^>]*>/g)) expect(m[0]).toContain('fill-opacity="1"');
  });
});

describe("colour and size", () => {
  it("defaults, then the user's choices", () => {
    const base = buildScene(olivine, DEFAULT_SPEC);
    expect(base.styles["O"]).toEqual({ colour: defaultColour("O"), radius: defaultRadius("O"), name: "O" });
    const mean = 0.878 * defaultRadius("Fe") + 0.122 * defaultRadius("Mg");
    expect(base.styles["Fe/Mg@0.878,0.122"]!.radius).toBeCloseTo(mean, 12);

    const looks = { O: { colour: "#ff0000", radius: 0.3 }, Fe: { colour: "#00ff00" }, "Fe/Mg": { radius: 0.9, name: "M" } };
    const scene = buildScene(olivine, { ...DEFAULT_SPEC, looks });
    expect(scene.styles["O"]).toEqual({ colour: "#ff0000", radius: 0.3, name: "O" });
    const pie = scene.styles["Fe/Mg@0.878,0.122"]!;
    expect(pie.radius).toBe(0.9);
    expect(pie.name).toBe("M");
    expect(pie.wedges!.map((w) => w.colour)).toEqual(["#00ff00", defaultColour("Mg")]);
    expect(renderSvg(scene, DEFAULT_VIEW)).toContain('stop-color="#ff0000"');
  });

  it("a hidden species is left out, with its bonds, and no neighbours are added for it", () => {
    const rules = [{ centre: "Fe/Mg", neighbour: "O", max: 2.4, complete: true }, { centre: "Si", neighbour: "O", max: 1.8, complete: false }];
    const all = buildScene(olivine, { ...DEFAULT_SPEC, bonds: rules });
    const noO = buildScene(olivine, { ...DEFAULT_SPEC, bonds: rules, looks: { O: { hidden: true } } });
    expect(all.sticks.length).toBeGreaterThan(0);
    expect(noO.spheres.some((s) => s.species === "O")).toBe(false);
    expect(noO.sticks.length).toBe(0);
    expect(noO.legend.map((e) => e.name)).toEqual(["Si", "Fe/Mg"]);
    expect(noO.spheres.length).toBe(all.spheres.filter((s) => s.species !== "O").length);
  });

  it("changing a look moves no atom", () => {
    const a = buildScene(olivine, DEFAULT_SPEC).spheres.map((s) => s.centre);
    const b = buildScene(olivine, { ...DEFAULT_SPEC, looks: { O: { radius: 1.2 }, "Fe/Mg": { name: "M" } } }).spheres.map((s) => s.centre);
    expect(b).toEqual(a);
  });
});
