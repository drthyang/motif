// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contourLoops, convexHull, DEFAULT_CANVAS, fitView, orbitalShade, orbitalSilhouettes, renderSvg } from "../src/render/svg";
import { DEFAULT_VIEW } from "../src/render/view";
import { ORBITALS, orbitalById, orbitalField, orbitalFrame, orbitalSurface, orbitalUnitSurface } from "../src/scene/orbitals";
import { bondAxis, buildScene, DEFAULT_ORBITAL_COLOURS, DEFAULT_SPEC, firstShell, ORBITAL_SCHEMES, withoutOrbitals } from "../src/scene/scene";
import type { Vec3 } from "../src/structure/types";
import { readCif } from "../src/structure/readCif";

const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const;

/** Integral over the sphere of f(x, y, z), by the midpoint rule in theta and phi (accurate for these polynomials). */
function integrate(f: (x: number, y: number, z: number) => number, nt = 200, np = 400): number {
  let sum = 0;
  for (let i = 0; i < nt; i++) {
    const t = (Math.PI * (i + 0.5)) / nt;
    for (let j = 0; j < np; j++) {
      const p = (2 * Math.PI * (j + 0.5)) / np;
      sum += f(Math.sin(t) * Math.cos(p), Math.sin(t) * Math.sin(p), Math.cos(t)) * Math.sin(t);
    }
  }
  return (sum * Math.PI * 2 * Math.PI) / (nt * np);
}

describe("orbitals: the real spherical harmonics", () => {
  it("1 s, 3 p, 5 d and 7 f, all mutually orthogonal over the sphere (so each set spans its l)", () => {
    expect([0, 1, 2, 3].map((l) => ORBITALS.filter((o) => o.l === l).length)).toEqual([1, 3, 5, 7]);
    const norms = ORBITALS.map((o) => integrate((x, y, z) => o.y(x, y, z) ** 2));
    ORBITALS.forEach((a, i) => {
      ORBITALS.forEach((b, j) => {
        if (j <= i) return;
        const overlap = integrate((x, y, z) => a.y(x, y, z) * b.y(x, y, z)) / Math.sqrt(norms[i]! * norms[j]!);
        expect(Math.abs(overlap), `${a.id} . ${b.id}`).toBeLessThan(1e-4);
      });
    });
  });

  it("lobes point where the textbook has them, with the right sign", () => {
    const y = (id: string, v: [number, number, number]) => orbitalById(id)!.y(...v);
    const d = Math.SQRT1_2;
    expect(y("px", [1, 0, 0])).toBeGreaterThan(0);
    expect(y("px", [-1, 0, 0])).toBeLessThan(0);
    expect(y("dx2-y2", [1, 0, 0])).toBeGreaterThan(0);
    expect(y("dx2-y2", [0, 1, 0])).toBeLessThan(0);
    expect(y("dxy", [d, d, 0])).toBeGreaterThan(0);
    expect(y("dxy", [1, 0, 0])).toBe(0); // a node along x
    expect(y("dz2", [0, 0, 1])).toBeGreaterThan(0);
    expect(y("dz2", [1, 0, 0])).toBeLessThan(0); // the ring
    expect(y("fz3", [0, 0, 1])).toBeGreaterThan(0);
    expect(y("fxyz", [1, 0, 0])).toBe(0);
  });

  it("the surface reaches exactly the chosen size, along the largest lobe, with that lobe's sign", () => {
    const faces = orbitalSurface(orbitalById("pz")!, 1.6, I);
    const far = Math.max(...faces.flatMap((f) => f.corners.map((c) => Math.hypot(...c))));
    expect(far).toBeCloseTo(1.6, 9);
    const top = faces.filter((f) => f.corners.some((c) => c[2] > 1.5));
    expect(top.every((f) => f.sign === 1)).toBe(true);
    const bottom = faces.filter((f) => f.corners.some((c) => c[2] < -1.5));
    expect(bottom.every((f) => f.sign === -1)).toBe(true);
  });

  it("an s orbital is a sphere; a higher isovalue gives slimmer lobes; a surface is computed once per orbital and isovalue", () => {
    for (const f of orbitalSurface(orbitalById("s")!, 1.2, I)) for (const c of f.corners) expect(Math.hypot(...c)).toBeCloseTo(1.2, 6);
    // Width of a pz lobe (largest distance from the z axis) relative to its length (largest z): smaller at a higher isovalue.
    const slim = (iso: number) => {
      const faces = orbitalSurface(orbitalById("pz")!, 1, I, iso);
      const pts = faces.flatMap((f) => f.corners);
      return Math.max(...pts.map((c) => Math.hypot(c[0], c[1]))) / Math.max(...pts.map((c) => c[2]));
    };
    expect(slim(0.6)).toBeLessThan(slim(0.3));
    expect(slim(0.3)).toBeLessThan(slim(0.1));
    expect(orbitalUnitSurface(orbitalById("dz2")!, 0.3)).toBe(orbitalUnitSurface(orbitalById("dz2")!, 0.3));
  });

  it("a local frame turns the orbital: with z along [1 1 0] of a cube, pz points along (1, 1, 0)/sqrt 2", () => {
    const frame = orbitalFrame({ a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 }, [1, 1, 0]);
    const faces = orbitalSurface(orbitalById("pz")!, 1, frame);
    let best = [0, 0, 0];
    for (const f of faces) for (const c of f.corners) if (Math.hypot(...c) > Math.hypot(...best)) best = [...c];
    const r = Math.hypot(...best);
    expect(Math.abs(best[0]! / r)).toBeCloseTo(Math.SQRT1_2, 2);
    expect(Math.abs(best[1]! / r)).toBeCloseTo(Math.SQRT1_2, 2);
    expect(best[2]! / r).toBeCloseTo(0, 2);
    // A right-handed frame.
    const [x, y, z] = frame;
    expect(x[1] * y[2] - x[2] * y[1]).toBeCloseTo(z[0], 12);
  });

  it("drawn on the atoms of a species, in the figure", () => {
    const srtio3 = readCif(readFileSync("examples/perovskite-SrTiO3_COD-9006864.cif", "utf8"));
    const scene = buildScene(srtio3, { ...DEFAULT_SPEC, orbitals: [{ species: "Ti", orbitals: ["dz2", "dxy"], size: 1.6, colours: DEFAULT_ORBITAL_COLOURS, opacity: 0.6 }] });
    const ti = scene.spheres.filter((s) => s.species === "Ti").length;
    expect(scene.orbitals!.length).toBe(2 * ti);
    const svg = renderSvg(scene, DEFAULT_VIEW);
    // One smooth see-through shape per lobe, its exact silhouette: dz2 has 2 lobes and a ring (one path, its hole cut
    // out), dxy 4 lobes. Each is drawn whole once; where it lies in front of an atom it is drawn again, clipped.
    const whole = svg.replace(/<g clip-path="url\(#[^)]*\)"><g clip-path="url\(#[^)]*\)">.*?<\/g><\/g>(<\/g>)?/g, "");
    expect((whole.match(/<path class="orbital-lobe"/g) ?? []).length).toBe((2 + 1 + 4) * ti);
    // A lobe carries its own opacity; a ring's segments share it in one group per atom.
    expect((whole.match(/<path class="orbital-lobe"[^>]* opacity="0.6"/g) ?? []).length).toBe((2 + 4) * ti);
    expect((whole.match(/<g class="orbital-ring" opacity="0.6">/g) ?? []).length).toBe(ti);
    expect(svg).not.toMatch(/class="orbital"/); // no small faces unless the mesh surface is chosen
    expect(buildScene(srtio3).orbitals).toBeUndefined();
  });

  it("while the view moves: the same atoms, bonds and cell in the same places, and no orbitals", () => {
    const srtio3 = readCif(readFileSync("examples/perovskite-SrTiO3_COD-9006864.cif", "utf8"));
    const scene = buildScene(srtio3, { ...DEFAULT_SPEC, orbitals: [{ species: "Ti", orbitals: ["dz2"], size: 1.6, colours: DEFAULT_ORBITAL_COLOURS, opacity: 0.6 }] });
    const bare = withoutOrbitals(scene);
    expect(bare.orbitals).toBeUndefined();
    expect(scene.orbitals!.length).toBeGreaterThan(0); // the scene itself keeps them
    expect(bare.spheres).toBe(scene.spheres);
    expect(bare.sticks).toBe(scene.sticks);
    expect([bare.centre, bare.extent]).toEqual([scene.centre, scene.extent]);
    const fit = fitView(scene, DEFAULT_VIEW, DEFAULT_CANVAS);
    const moving = renderSvg(bare, DEFAULT_VIEW, DEFAULT_CANVAS, fit, "structure");
    const still = renderSvg(scene, DEFAULT_VIEW, DEFAULT_CANVAS, fit, "structure");
    expect(moving).not.toMatch(/orbital/);
    expect(still).toMatch(/class="orbital-lobe"/);
    // Every atom is drawn, at the same place as in the still figure (which repeats some discs as clips for the orbitals).
    const circles = (svg: string) => [...new Set((svg.match(/<circle [^>]*cx="[^"]*" cy="[^"]*"/g) ?? []).map((c) => c.match(/cx="[^"]*" cy="[^"]*"/)![0]))].sort();
    expect(circles(moving).length).toBeGreaterThan(0);
    expect(circles(moving)).toEqual(circles(still));
    // A scene with no orbitals is returned unchanged.
    const plain = buildScene(srtio3);
    expect(withoutOrbitals(plain)).toBe(plain);
  });

  it("an orbital and an atom cut through one another as solids: a lobe shows on the atom only where it is in front", () => {
    // One atom alone, seen down z, so the + lobe of pz points at the viewer and the - lobe away.
    const one = readCif("data_one\n_cell_length_a 6\n_cell_length_b 6\n_cell_length_c 6\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n_symmetry_space_group_name_H-M 'P 1'\nloop_\n_symmetry_equiv_pos_as_xyz\nx,y,z\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nTi1 Ti 0.5 0.5 0.5\n");
    const down = [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const;
    for (const texture of ["soft", "flat", "mesh"] as const) {
      const draw = (size: number) => {
        const scene = buildScene(one, { ...DEFAULT_SPEC, orbitals: [{ species: "Ti", orbitals: ["pz"], size, colours: DEFAULT_ORBITAL_COLOURS, opacity: 0.6, texture }] });
        expect(scene.spheres.length).toBe(1);
        return { svg: renderSvg(scene, down), radius: scene.styles[scene.spheres[0]!.style]!.radius };
      };
      // A lobe that stays inside the atom is hidden by it: drawn once, before the atom, never over it.
      const { radius } = draw(1);
      const inside = draw(0.8 * radius).svg;
      expect(inside.lastIndexOf('class="orbital')).toBeLessThan(inside.indexOf("<circle "));
      expect(inside).not.toMatch(/clip-path/);
      // A lobe that reaches beyond the atom: the near lobe is drawn again over the atom, clipped to the atom's disc and
      // to the faces in front of the sphere; the far lobe is not.
      const out = draw(2.5 * radius).svg;
      const atom = out.indexOf("<circle ");
      const over = out.slice(atom).match(/<g clip-path="url\(#([^)]*)\)"><g clip-path="url\(#([^)]*)\)">/g) ?? [];
      expect(over.length).toBe(1);
      const disc = /<clipPath id="[^"]*"><circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"\/><\/clipPath>/.exec(out)!;
      const atomCircle = /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/.exec(out.slice(atom))!;
      expect(disc.slice(1)).toEqual(atomCircle.slice(1));
      if (texture === "flat") {
        // Only the + lobe (the near one, in the first colour) is drawn over the atom.
        const patch = out.slice(out.indexOf("<g clip-path", atom));
        expect(patch).toContain(`<path class="orbital-lobe"`);
        expect(patch.split("</g></g>")[0]).toContain(`fill="${DEFAULT_ORBITAL_COLOURS[0]}"`);
        expect(patch.split("</g></g>")[0]).not.toContain(`fill="${DEFAULT_ORBITAL_COLOURS[1]}"`);
      }
    }
  });

  it("the orbital as a solid: zero on every point of the drawn surface, positive inside, and each point in its lobe", () => {
    const frame = orbitalFrame({ a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 }, [1, 1, 0]);
    for (const id of ["pz", "dz2", "dxy", "fz3"]) {
      const field = orbitalField(orbitalById(id)!, 1.7, frame);
      const faces = orbitalSurface(orbitalById(id)!, 1.7, frame);
      let [on, rim] = [0, 0];
      for (const f of faces) {
        if (f.lobe === undefined) continue;
        const c = f.corners[0];
        const v = field.value(...c);
        // A corner where the lobe closes at its rim (no lobe in that direction; the surface folds shut at the peak
        // of R) lies just outside the solid; every other one is on the isosurface, with the solid just inside.
        expect(v, id).toBeLessThan(1e-9);
        if (v < -1e-9) {
          rim += 1;
          continue;
        }
        on += 1;
        expect(field.value(c[0] * 0.97, c[1] * 0.97, c[2] * 0.97), id).toBeGreaterThan(0);
      }
      expect(on, id).toBeGreaterThan(5 * rim);
      // The centre of a face's points lies in that face's lobe.
      for (const f of faces.filter((x) => x.lobe !== undefined).slice(0, 200)) {
        const m = [0, 1, 2].map((i) => f.corners.reduce((sum, c) => sum + c[i]!, 0) / 4) as [number, number, number];
        expect(field.lobe(...m)).toBe(f.lobe);
      }
    }
  });

  it("marching squares: a disc in the field comes back as one closed loop on its rim", () => {
    const n = 41;
    const v = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v[i * n + j] = 1 - Math.hypot(i - 20, j - 20) / 12;
    const loops = contourLoops(v, n);
    expect(loops.length).toBe(1);
    expect(loops[0]!.length).toBeGreaterThan(40);
    for (const [i, j] of loops[0]!) expect(Math.hypot(i - 20, j - 20)).toBeCloseTo(12, 1);
    // A ring (positive between radii 6 and 12) gives two loops, the hole drawn by the even-odd rule.
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) v[i * n + j] = 3 - Math.abs(Math.hypot(i - 20, j - 20) - 9);
    expect(contourLoops(v, n).length).toBe(2);
  });

  it("lobes: each orbital's outer surface splits into its lobes; a ring is cut into segments", () => {
    const lobes = (id: string, iso = 0.3) => new Set(orbitalUnitSurface(orbitalById(id)!, iso).flatMap((f) => (f.lobe === undefined ? [] : [f.lobe]))).size;
    expect(lobes("s")).toBe(1);
    expect(lobes("pz")).toBe(2);
    expect(lobes("dxy")).toBe(4);
    expect(lobes("dx2-y2")).toBe(4);
    expect(lobes("dz2")).toBe(2 + 12);
    expect(lobes("dz2", 0.6)).toBe(2); // above 0.5 the ring has no surface
    expect(lobes("fxyz")).toBe(8);
  });

  it("a lobe's outline is the convex hull of its points: corners kept, inner points and dents dropped", () => {
    const square = convexHull([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1], [1, 0.2], [0.5, 1.5]]);
    expect(square.length).toBe(4);
    expect(new Set(square.map((p) => p.join(",")))).toEqual(new Set(["0,0", "2,0", "2,2", "0,2"]));
  });

  it("surfaces: flat keeps the lobe's colour, soft and glossy shade it, mesh draws darker grid lines; schemes are valid pairs", () => {
    expect(orbitalShade("#3f7fd0", 0.1, "flat")).toBe("#3f7fd0");
    expect(orbitalShade("#3f7fd0", 0.1, "soft")).not.toBe(orbitalShade("#3f7fd0", 0.9, "soft"));
    expect(orbitalShade("#3f7fd0", 1, "glossy")).not.toBe(orbitalShade("#3f7fd0", 0.5, "glossy"));
    for (const scheme of ORBITAL_SCHEMES) for (const c of scheme.colours) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    const srtio3 = readCif(readFileSync("examples/perovskite-SrTiO3_COD-9006864.cif", "utf8"));
    const mesh = renderSvg(buildScene(srtio3, { ...DEFAULT_SPEC, orbitals: [{ species: "Ti", orbitals: ["pz"], size: 1.6, colours: DEFAULT_ORBITAL_COLOURS, opacity: 0.6, texture: "mesh" }] }), DEFAULT_VIEW);
    const face = /<polygon class="orbital"[^>]*fill="(#[0-9a-f]{6})" stroke="(#[0-9a-f]{6})"/.exec(mesh)!;
    expect(face[1]).not.toBe(face[2]); // grid lines in their own, darker colour
  });
});

describe("orbital frames from each atom's bonds: LaMnO3, Pbnm (COD 1006141)", () => {
  const lmo = readCif(readFileSync("examples/LaMnO3-orbital-order_COD-1006141.cif", "utf8"));
  const axis = (v: Vec3 | null) => {
    const n = Math.hypot(...v!);
    return v!.map((x) => x / n);
  };
  const parallel = (u: number[], v: number[]) => Math.abs(u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!);
  it("each Mn's longest Mn-O bond, 2.180 A, alternates between two directions in the ab plane (hand calculation from the published sites)", () => {
    // From the published O2 (0.7256, 0.3066, 0.0384) and a, b, c: about Mn (1/2, 0, 0) the long bonds are
    // +-(1.249, 1.762, 0.295) A; about Mn (0, 1/2, 0), +-(1.249, -1.762, -0.295) A.
    const at = (f: Vec3) => axis(bondAxis(lmo, f, "O", "longest"));
    expect(Math.hypot(...bondAxis(lmo, [0.5, 0, 0], "O", "longest")!)).toBeCloseTo(2.18, 2);
    expect(parallel(at([0.5, 0, 0]), axis([1.249, 1.762, 0.295]))).toBeGreaterThan(0.99999);
    expect(parallel(at([0, 0.5, 0]), axis([1.249, -1.762, -0.295]))).toBeGreaterThan(0.99999);
    // The two directions are far from parallel: the order alternates.
    expect(parallel(at([0.5, 0, 0]), at([0, 0.5, 0]))).toBeLessThan(0.4);
    expect(firstShell(lmo, [0.5, 0, 0], "O").length).toBe(6);
  });

  it("an O's p axis runs through its two Mn: along c for the apical O1, in the ab plane for O2; drawn on every atom", () => {
    expect(parallel(axis(bondAxis(lmo, [0.0745, 0.4874, 0.25], "Mn", "bridge")), [0, 0, 1])).toBeCloseTo(1, 9);
    expect(Math.abs(axis(bondAxis(lmo, [0.7256, 0.3066, 0.0384], "Mn", "bridge"))[2]!)).toBeLessThan(0.1);
    const scene = buildScene(lmo, { ...DEFAULT_SPEC, orbitals: [
      { species: "Mn", orbitals: ["dz2"], size: 1.7, colours: DEFAULT_ORBITAL_COLOURS, opacity: 0.6, zFrom: { neighbour: "O", mode: "longest" } },
      { species: "O", orbitals: ["pz"], size: 1, colours: DEFAULT_ORBITAL_COLOURS, opacity: 0.6, zFrom: { neighbour: "Mn", mode: "bridge" } },
    ] });
    const mn = scene.orbitals!.filter((o) => o.kind === "dz2");
    expect(mn.length).toBe(scene.spheres.filter((s) => s.species === "Mn").length);
    // In the ab plane the Mn orbitals take two directions, alternating (an axis up to its sign: turned so that its x
    // part is positive). Out of the plane each tilts by 0.295 / 2.180, one way at z = 0 and the other at z = 1/2, so
    // in all there are four.
    const flip = (z: Vec3) => z.map((x) => Math.sign(z[0]) * x);
    expect(new Set(mn.map((o) => flip(o.frame[2]).slice(0, 2).map((x) => x.toFixed(3)).join(","))).size).toBe(2);
    expect(new Set(mn.map((o) => flip(o.frame[2]).map((x) => x.toFixed(3)).join(","))).size).toBe(4);
    for (const o of mn) expect(Math.abs(o.frame[2][2])).toBeCloseTo(0.295 / 2.18, 2);
    for (const o of mn) {
      const [x, y, z] = o.frame;
      expect(x[1] * y[2] - x[2] * y[1]).toBeCloseTo(z[0], 9);
    }
    expect(renderSvg(scene, DEFAULT_VIEW)).toContain('class="orbital-lobe"');
  });
});

describe("orbital outline (the user's choice A, 2026-11-26)", () => {
  const srtio3 = readCif(readFileSync("examples/perovskite-SrTiO3_COD-9006864.cif", "utf8"));
  const spec = { ...DEFAULT_SPEC, orbitals: [{ species: "Ti", orbitals: ["dz2", "dxy"], size: 1.6, colours: DEFAULT_ORBITAL_COLOURS, opacity: 0.6 }] };
  const whole = (svg: string) => svg.replace(/<g clip-path="url\(#[^)]*\)"><g clip-path="url\(#[^)]*\)">.*?<\/g><\/g>(<\/g>)?/g, "");
  const outlines = (svg: string) => whole(svg).match(/<path class="orbital-outline"[^>]*>/g) ?? [];

  it("a ring's silhouette, traced from the orbital as a solid: seen face-on two circles (outer edge and hole), edge-on one loop", () => {
    const dz2 = orbitalById("dz2")!;
    const size = 1.6;
    const ring = new Set(orbitalSurface(dz2, size, I, undefined).flatMap((f) => (f.ring !== undefined && f.lobe !== undefined ? [f.lobe] : [])));
    expect(ring.size).toBe(12);
    const field = orbitalField(dz2, size, I);
    const scale = 100;
    const box = [-size * scale, -size * scale, size * scale, size * scale] as const;
    // Looking down the orbital's z axis (the view is the identity: screen x, y = x, y).
    const faceOn = orbitalSilhouettes({ field, size, view: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], scale }, [0, 0], box).loops(ring);
    expect(faceOn.length).toBe(2);
    for (const loop of faceOn) {
      const r = loop.map((p) => Math.hypot(p[0], p[1]));
      const mean = r.reduce((a, b) => a + b, 0) / r.length;
      // A circle, smooth: every point within 0.5 % of the mean radius (the segments' union is 3.4 % off at its chords).
      expect(Math.max(...r.map((x) => Math.abs(x / mean - 1)))).toBeLessThan(0.005);
    }
    // Looking along x, the ring is seen edge-on: no hole, one loop.
    const edgeOn = orbitalSilhouettes({ field, size, view: [[0, 1, 0], [0, 0, 1], [1, 0, 0]], scale }, [0, 0], box).loops(ring);
    expect(edgeOn.length).toBe(1);
    // A pz lobe seen from the side: its silhouette is smooth and mirror-symmetric about the z axis (screen y).
    const pz = orbitalById("pz")!;
    const pzField = orbitalField(pz, size, I);
    const upper = new Set(orbitalSurface(pz, size, I, undefined).filter((f) => f.lobe !== undefined && f.corners[0][2] > 0).map((f) => f.lobe!));
    const side = orbitalSilhouettes({ field: pzField, size, view: [[1, 0, 0], [0, 0, 1], [0, -1, 0]], scale }, [0, 0], box).loops(upper);
    expect(side.length).toBe(1);
    const pts = side[0]!;
    // Mirror each point in x: it lies on the curve within half a grid step.
    for (const p of pts.filter((_, i) => i % 7 === 0)) {
      const d = Math.min(...pts.map((q) => Math.hypot(q[0] + p[0], q[1] - p[1])));
      expect(d).toBeLessThan(1.5);
    }
  });

  it("a lobe is the isosurface as seen: near the nucleus at a low isovalue, standing off it at a high one (no cone to the nucleus)", () => {
    const pz = orbitalById("pz")!;
    const size = 1.6;
    const scale = 100;
    const box = [-size * scale, -size * scale, size * scale, size * scale] as const;
    const side = [[1, 0, 0], [0, 0, 1], [0, -1, 0]] as const; // the z axis up the screen
    const gap = (iso: number): number => {
      const upper = new Set(orbitalSurface(pz, size, I, iso).filter((f) => f.lobe !== undefined && f.corners[0][2] > 0).map((f) => f.lobe!));
      const loops = orbitalSilhouettes({ field: orbitalField(pz, size, I, iso), size, view: side as never, scale }, [0, 0], box).loops(upper);
      expect(loops.length).toBe(1);
      return Math.min(...loops[0]!.map((p) => Math.hypot(p[0], p[1]))) / (size * scale);
    };
    // Hand calculation, R = r e^(-r/2): the lobe's inner end along its axis lies at 0.036 of its reach at 0.3, at
    // 0.26 of it at 0.8 (where r e^(-r/2) = iso x 2/e, inner and outer roots).
    expect(gap(0.3)).toBeLessThan(0.06);
    expect(gap(0.8)).toBeGreaterThan(0.2);
    expect(gap(0.8)).toBeLessThan(0.3);
  });

  it("off by default: no outline, and the figure is as it was", () => {
    expect(outlines(renderSvg(buildScene(srtio3, spec), DEFAULT_VIEW))).toEqual([]);
    expect(buildScene(srtio3, spec).orbitalOutline).toBeUndefined();
  });

  it("on: one smooth closed path per lobe, and a ring as one band, in a darker tone of each lobe's colour or one colour", () => {
    const scene = buildScene(srtio3, { ...spec, orbitalOutline: { width: 2 } });
    const ti = scene.spheres.filter((s) => s.species === "Ti").length;
    const paths = outlines(renderSvg(scene, DEFAULT_VIEW));
    // dz2: 2 lobes and the ring's band (its outer edge, and its inner edge if the hole shows); dxy: 4 lobes.
    expect(paths.length).toBeGreaterThanOrEqual((2 + 1 + 4) * ti);
    expect(paths.length).toBeLessThanOrEqual((2 + 2 + 4) * ti);
    for (const p of paths) {
      expect(p).toMatch(/ d="M[-\d.,]+( C[-\d.,]+ [-\d.,]+ [-\d.,]+)+ Z" fill="none" stroke="#[0-9a-f]{6}" stroke-width="2" stroke-linejoin="round"/);
      expect(p).not.toMatch(/opacity/);
    }
    // Two lobe colours, each darkened; no lobe colour itself.
    const strokes = new Set(paths.map((p) => p.match(/stroke="(#[0-9a-f]{6})"/)![1]));
    expect(strokes.size).toBe(2);
    for (const c of DEFAULT_ORBITAL_COLOURS) expect(strokes.has(c.toLowerCase())).toBe(false);
    const one = outlines(renderSvg(buildScene(srtio3, { ...spec, orbitalOutline: { width: 5, colour: "#123456" } }), DEFAULT_VIEW));
    expect(one.length).toBe(paths.length);
    for (const p of one) expect(p).toMatch(/stroke="#123456" stroke-width="5"/);
  });

  it("cut with its lobe where the lobe lies in front of an atom: the clipped copy carries the outline too", () => {
    const svg = renderSvg(buildScene(srtio3, { ...spec, orbitalOutline: { width: 2 } }), DEFAULT_VIEW);
    const clipped = svg.match(/<g clip-path="url\(#[^)]*\)"><g clip-path="url\(#[^)]*\)">.*?<\/g><\/g>/g) ?? [];
    expect(clipped.length).toBeGreaterThan(0);
    expect(clipped.every((c) => c.includes('class="orbital-outline"'))).toBe(true);
  });
});
