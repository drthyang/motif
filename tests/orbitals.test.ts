// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderSvg } from "../src/render/svg";
import { DEFAULT_VIEW } from "../src/render/view";
import { ORBITALS, orbitalById, orbitalFrame, orbitalSurface } from "../src/scene/orbitals";
import { buildScene, DEFAULT_ORBITAL_COLOURS, DEFAULT_SPEC } from "../src/scene/scene";
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
    const scene = buildScene(srtio3, { ...DEFAULT_SPEC, orbitals: [{ species: "Ti", orbitals: ["dz2", "dxy"], size: 1.6, colours: DEFAULT_ORBITAL_COLOURS, opacity: 1 }] });
    const ti = scene.spheres.filter((s) => s.species === "Ti").length;
    expect(scene.orbitals!.length).toBe(2 * ti);
    const svg = renderSvg(scene, DEFAULT_VIEW);
    expect((svg.match(/class="orbital"/g) ?? []).length).toBeGreaterThan(1000);
    expect(buildScene(srtio3).orbitals).toBeUndefined();
  });
});
