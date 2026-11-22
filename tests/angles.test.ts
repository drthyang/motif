import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CANVAS, layoutAll, pxPerAngstrom, renderSvg } from "../src/render/svg";
import { DEFAULT_VIEW, viewFromAngles } from "../src/render/view";
import { angleDegrees, type AngleRule } from "../src/scene/angles";
import type { BondRule } from "../src/scene/bonds";
import { buildScene, DEFAULT_SPEC, type Scene } from "../src/scene/scene";
import { readCif } from "../src/structure/readCif";

const structure = (file: string) => readCif(readFileSync(`examples/${file}`, "utf8"));
const bond = (centre: string, neighbour: string, max: number, complete = true): BondRule => ({ centre, neighbour, max, complete });
const mark = (centre: string, ends: [string, string], min = 0, max = 180, more: Partial<AngleRule> = {}): AngleRule => ({ centre, ends, min, max, ...more });

describe("angle between two bonds", () => {
  it("by hand: right angle, straight angle, 60 degrees, and the tetrahedral angle acos(-1/3)", () => {
    expect(angleDegrees([0, 0, 0], [1, 0, 0], [0, 2, 0])).toBeCloseTo(90, 12);
    expect(angleDegrees([0, 0, 0], [1, 0, 0], [-3, 0, 0])).toBeCloseTo(180, 12);
    expect(angleDegrees([1, 1, 1], [2, 1, 1], [1.5, 1 + Math.sqrt(3) / 2, 1])).toBeCloseTo(60, 12);
    expect(angleDegrees([0, 0, 0], [1, 1, 1], [1, -1, -1])).toBeCloseTo((Math.acos(-1 / 3) * 180) / Math.PI, 12);
  });

  interface Case {
    example: string;
    centre: string;
    end: string;
    max: number;
    sizes: number[];
    anglesPerCentre: number[];
  }
  for (const c of JSON.parse(readFileSync("tests/reference/angles.json", "utf8")) as Case[]) {
    it(`against gemmi: ${c.end}-${c.centre}-${c.end} in ${c.example}: ${c.sizes.join(", ")} degrees`, () => {
      // With the neighbours outside the range added, every centre in the range has all its bonds.
      const scene = buildScene(structure(c.example), { ...DEFAULT_SPEC, bonds: [bond(c.centre, c.end, c.max)], angles: [mark(c.centre, [c.end, c.end])] });
      const kind = scene.angleKinds.find((k) => k.centre === c.centre && k.ends[0] === c.end && k.ends[1] === c.end)!;
      const inRange = scene.spheres.map((s, i) => ({ s, i })).filter(({ s }) => s.species === c.centre && !s.added);
      // Each centre in the range carries the full number of angles, and their sizes are the reference's.
      const atCentres = scene.sectors.filter((x) => inRange.some(({ i }) => i === x.apex));
      expect(c.anglesPerCentre.length).toBe(1);
      const straight = c.sizes.includes(180);
      if (!straight) expect(atCentres.length).toBe(inRange.length * c.anglesPerCentre[0]!);
      const sizes = [...new Set(atCentres.map((x) => Math.round(x.degrees * 10) / 10))].sort((p, q) => p - q);
      expect(sizes).toEqual(c.sizes);
      for (const size of kind.sizes) expect(c.sizes.some((r) => Math.abs(r - size) < 0.11)).toBe(true);
    });
  }

  it("silicon: every angle is the tetrahedral angle, 109.47 degrees, six per atom", () => {
    const scene = buildScene(structure("silicon_COD-9008565.cif"), { ...DEFAULT_SPEC, range: { from: [0, 0, 0], to: [1, 1, 1], boundary: "once" }, bonds: [bond("Si", "Si", 2.5)], angles: [mark("Si", ["Si", "Si"])] });
    const inRange = scene.spheres.map((s, i) => ({ s, i })).filter(({ s }) => !s.added);
    expect(inRange.length).toBe(8);
    for (const { i } of inRange) expect(scene.sectors.filter((x) => x.apex === i).length).toBe(6);
    for (const x of scene.sectors) expect(x.degrees).toBeCloseTo(109.4712, 3);
  });
});

describe("choosing which angles are marked", () => {
  const perovskite = structure("perovskite-SrTiO3_COD-9006864.cif");
  const spec = { ...DEFAULT_SPEC, bonds: [bond("Ti", "O", 2.1)] };

  it("only the chosen kind, only inside the range of sizes", () => {
    const all = buildScene(perovskite, { ...spec, angles: [mark("Ti", ["O", "O"])] });
    // An octahedron: 12 right angles and 3 straight ones per Ti; 8 Ti in the cell with boundary atoms repeated.
    expect(all.sectors.filter((x) => Math.abs(x.degrees - 90) < 1e-6).length).toBe(8 * 12);
    expect(all.sectors.filter((x) => Math.abs(x.degrees - 180) < 1e-6).length).toBe(8 * 3);
    const right = buildScene(perovskite, { ...spec, angles: [mark("Ti", ["O", "O"], 89, 91)] });
    expect(right.sectors.length).toBe(8 * 12);
    expect(buildScene(perovskite, { ...spec, angles: [mark("O", ["Ti", "Ti"], 89, 91)] }).sectors.length).toBe(0); // Ti-O-Ti is straight
    expect(buildScene(perovskite, { ...spec, angles: [mark("Sr", ["O", "O"])] }).sectors.length).toBe(0); // no Sr-O bonds drawn
    expect(all.angleKinds.map((k) => `${k.ends[0]}-${k.centre}-${k.ends[1]}`).sort()).toEqual(["O-Ti-O", "Ti-O-Ti"]);
    // The distribution the user picks from: how many angles of each size.
    const octahedron = all.angleKinds.find((k) => k.centre === "Ti")!;
    expect(octahedron.sizes).toEqual([90, 180]);
    expect(octahedron.counts).toEqual([8 * 12, 8 * 3]);
    expect(octahedron.count).toBe(8 * 15);
  });

  it("no bonds, no angles; marking an angle moves and removes nothing", () => {
    expect(buildScene(perovskite, { ...DEFAULT_SPEC, angles: [mark("Ti", ["O", "O"])] }).sectors).toEqual([]);
    const plain = buildScene(perovskite, spec);
    const marked = buildScene(perovskite, { ...spec, angles: [mark("Ti", ["O", "O"], 89, 91)] });
    expect(marked.spheres).toEqual(plain.spheres);
    expect(marked.sticks).toEqual(plain.sticks);
  });
});

describe("drawing a marked angle", () => {
  // Three atoms in the plane of the screen: apex at the origin, ends along +x and at 60 degrees.
  const scene: Scene = {
    spheres: [
      { style: "X", label: "apex", centre: [0, 0, 0] },
      { style: "X", label: "a", centre: [2, 0, 0] },
      { style: "X", label: "b", centre: [1, 0, Math.sqrt(3)] },
    ],
    sticks: [],
    cellEdges: [],
    stickStyles: [],
    ruleInfo: [],
    bands: [],
    polygons: [],
    sectors: [{ apex: 0, a: 1, b: 2, degrees: 60, colour: "#f08c1e", opacity: 0.45, radius: 1, label: true, rule: 0 }],
    angleKinds: [],
    styles: { X: { colour: "#808080", radius: 0.3 } },
    centre: [0, 0, 0],
    extent: 3,
    arrows: [],
    arrowColour: "#000000",
    letterWeight: 800,
    legend: [],
    axes: [],
    warnings: [],
  };
  const front = viewFromAngles(0, 0); // x to the right, z up, seen face on

  it("the sector spans exactly the angle, between the atom's surface and the chosen radius", () => {
    const drawn = layoutAll(scene, front, DEFAULT_CANVAS);
    const sector = drawn.find((d) => d.kind === "sector")!;
    if (sector.kind !== "sector") throw new Error();
    const apex = drawn.find((d) => d.kind === "sphere" && d.label === "apex")!;
    if (apex.kind !== "sphere") throw new Error();
    const scale = pxPerAngstrom(scene, front, DEFAULT_CANVAS);
    const points = sector.points.split(" ").map((p) => p.split(",").map(Number) as [number, number]);
    // Polar coordinates about the apex (y up).
    const polar = points.map(([x, y]) => ({ r: Math.hypot(x - apex.x, y - apex.y) / scale, angle: (Math.atan2(apex.y - y, x - apex.x) * 180) / Math.PI }));
    for (const p of polar) {
      expect(p.angle).toBeGreaterThan(-0.2);
      expect(p.angle).toBeLessThan(60.2);
      expect(Math.abs(p.r - 1) < 0.01 || Math.abs(p.r - 0.3) < 0.01).toBe(true); // on the outer arc or on the atom's surface
    }
    expect(Math.min(...polar.map((p) => p.angle))).toBeCloseTo(0, 0);
    expect(Math.max(...polar.map((p) => p.angle))).toBeCloseTo(60, 0);
    // The label sits on the bisector, outside the arc.
    const label = sector.label!;
    expect(label.text).toBe("60.0°");
    expect((Math.atan2(apex.y - label.y, label.x - apex.x) * 180) / Math.PI).toBeCloseTo(30, 6);
    expect(Math.hypot(label.x - apex.x, label.y - apex.y) / scale).toBeGreaterThan(1);
  });

  it("is drawn translucent in the chosen colour, with the number on top; a straight angle is not drawn", () => {
    const svg = renderSvg(scene, front);
    expect(svg).toContain('class="angle" points=');
    expect(svg).toContain('fill="#f08c1e" fill-opacity="0.45"');
    expect(svg.indexOf('class="angle-label"')).toBeGreaterThan(svg.lastIndexOf("<circle"));
    const straight = { ...scene, sectors: [{ ...scene.sectors[0]!, degrees: 180 }] };
    expect(renderSvg(straight, front)).not.toContain('class="angle"');
    const unlabelled = { ...scene, sectors: [{ ...scene.sectors[0]!, label: false }] };
    expect(renderSvg(unlabelled, DEFAULT_VIEW)).not.toContain("angle-label");
  });
});
