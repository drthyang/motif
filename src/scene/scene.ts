/**
 * The scene: what is drawn and how it is styled, as plain data (JSON-safe).
 * Positions are cartesian, in angstrom. The scene knows nothing about the view.
 */
import { fractionalToCartesian } from "../structure/cell";
import type { CellAtom, Component, Structure, Vec3 } from "../structure/types";
import { defaultColour, defaultRadius } from "./elementStyle";
import { atomsAndBonds, type BondRule } from "./bonds";
import { BOUNDARY_TOLERANCE, ONE_CELL, type Range } from "./select";

/** One sector of a pie sphere. */
export interface Wedge {
  readonly colour: string;
  /** Share of the full circle, 0 to 1. The wedges of a sphere add up to 1. */
  readonly fraction: number;
  /** The element, or "vacancy" for the empty share of a partly occupied place. */
  readonly element: string;
}

export interface SphereStyle {
  /** Base colour "#rrggbb"; the shading is derived from it. For a pie sphere, the colour of its first wedge. */
  readonly colour: string;
  /** Radius in angstrom. */
  readonly radius: number;
  /** Name shown to the user: the element symbol, or the name given to a shared site. */
  readonly name?: string;
  /** Present for a pie sphere: sectors drawn clockwise from the top, in file order. */
  readonly wedges?: readonly Wedge[];
}

export interface Sphere {
  /** Key into Scene.styles. */
  readonly style: string;
  /** What sits here ("Fe", or "Fe/Mg" for a shared site): the name bond rules use. */
  readonly species?: string;
  readonly label: string;
  /** Fractional coordinates (for reading off; the drawing uses `centre`). */
  readonly frac?: Vec3;
  readonly centre: Vec3;
  /** True for an atom outside the chosen range, shown to complete a bond rule. */
  readonly added?: boolean;
  /** Magnetic moment in Bohr magnetons, as a vector in the same cartesian axes as `centre`. */
  readonly moment?: Vec3;
}

/** An arrow drawn through an atom, centred on it (a magnetic moment). */
export interface Arrow {
  /** Index into Scene.spheres. */
  readonly sphere: number;
  /** From tail to tip, in angstrom: the direction is the moment's, the length is its size times the chosen scale. */
  readonly vector: Vec3;
}

/** A stick between two spheres. */
export interface Stick {
  /** Indices into Scene.spheres. */
  readonly i: number;
  readonly j: number;
  /** Index of the bond rule that made it. */
  readonly rule: number;
  /** Centre-to-centre distance in angstrom. */
  readonly length: number;
}

export interface Scene {
  readonly spheres: readonly Sphere[];
  readonly sticks: readonly Stick[];
  /** Unit-cell edges, each a pair of end points in angstrom. */
  readonly cellEdges: readonly (readonly [Vec3, Vec3])[];
  readonly styles: Readonly<Record<string, SphereStyle>>;
  /** The point kept at the middle of the drawing. */
  readonly centre: Vec3;
  /** Radius of a ball around `centre` that holds everything drawn: the drawing scale comes from it, so rotating never rescales. */
  readonly extent: number;
  /** Moment arrows. Empty when the structure has no moments or they are switched off. */
  readonly arrows: readonly Arrow[];
  readonly arrowColour: string;
  /** Legend entries, in file order: one per name. Empty when the legend is off. */
  readonly legend: readonly LegendEntry[];
  /** The directions of the cell axes a, b, c as unit vectors in angstrom space. Empty when the axes are off. */
  readonly axes: readonly Axis[];
  readonly warnings: readonly string[];
}

export interface LegendEntry {
  /** Key into Scene.styles: the sphere drawn beside the name. */
  readonly style: string;
  readonly name: string;
}

export interface Axis {
  readonly name: "a" | "b" | "c";
  readonly direction: Vec3;
}

/** Unit vectors along the cell edges a, b, c (not a*, b*, c*: for an oblique cell they are not perpendicular). */
export function cellAxes(structure: Structure): Axis[] {
  return (["a", "b", "c"] as const).map((name, i) => {
    const frac: [number, number, number] = [0, 0, 0];
    frac[i] = 1;
    const v = fractionalToCartesian(structure.cell, frac);
    const n = Math.hypot(v[0], v[1], v[2]);
    return { name, direction: [v[0] / n, v[1] / n, v[2] / n] };
  });
}

/** What the user has chosen to show. Plain data: it can be saved and loaded again. */
export interface SceneSpec {
  readonly range: Range;
  readonly bonds: readonly BondRule[];
  /** Draw the outline of every whole unit cell inside the range. */
  readonly showCell: boolean;
  /**
   * The user's changes to the default look, keyed by element symbol or by species ("Fe/Mg").
   * `colour` applies to an element (also inside a pie); `radius` and `name` to a species.
   */
  readonly looks: Readonly<Record<string, Look>>;
  /** Draw the unoccupied share of a partly occupied place as a pale wedge. */
  readonly showVacancy: boolean;
  /** Draw the magnetic moments as arrows. */
  readonly showMoments: boolean;
  /** Length in angstrom of the arrow of the largest moment in the structure; the others are in proportion. */
  readonly momentLength: number;
  readonly momentColour: string;
  /** Draw a row of spheres with their names under the structure. */
  readonly showLegend: boolean;
  /** Draw the a, b, c arrows under the structure. */
  readonly showAxes: boolean;
}

export interface Look {
  readonly colour?: string;
  readonly radius?: number;
  readonly name?: string;
}

export const VACANCY_COLOUR = "#ffffff";

export const DEFAULT_SPEC: SceneSpec = { range: ONE_CELL, bonds: [], showCell: true, looks: {}, showVacancy: true, showMoments: true, momentLength: 3, momentColour: "#c2343c", showLegend: true, showAxes: true };

/** Colour of an element: the user's, else the default. */
export function elementColour(element: string, looks: Readonly<Record<string, Look>>): string {
  return looks[element]?.colour ?? defaultColour(element);
}

/** Radius of a species in angstrom: the user's, else the default (for a shared site, the occupancy-weighted mean of its elements). */
export function speciesRadius(species: string, components: readonly Component[], looks: Readonly<Record<string, Look>>): number {
  const chosen = looks[species]?.radius;
  if (chosen !== undefined) return chosen;
  const total = components.reduce((sum, c) => sum + c.occupancy, 0);
  if (!(total > 0)) return defaultRadius(components[0]?.element ?? species);
  return components.reduce((sum, c) => sum + (c.occupancy / total) * defaultRadius(c.element), 0);
}

/** The style of one atom, and a key that is the same for atoms that look the same. */
function styleOf(atom: CellAtom, spec: SceneSpec): { key: string; style: SphereStyle } {
  const radius = speciesRadius(atom.species, atom.components, spec.looks);
  const name = spec.looks[atom.species]?.name ?? atom.species;
  const colour = elementColour(atom.components[0]!.element, spec.looks);
  const vacant = spec.showVacancy ? Math.max(0, 1 - atom.occupancy) : 0;
  if (atom.components.length === 1 && vacant < 0.005) return { key: atom.species, style: { colour, radius, name } };
  // A pie: each element's share of the circle is its occupancy; without the vacancy wedge the shares are scaled to fill the circle.
  const total = vacant >= 0.005 ? 1 : atom.occupancy;
  const wedges: Wedge[] = atom.components.map((c) => ({ colour: elementColour(c.element, spec.looks), fraction: c.occupancy / total, element: c.element }));
  if (vacant >= 0.005) wedges.push({ colour: VACANCY_COLOUR, fraction: vacant, element: "vacancy" });
  const key = `${atom.species}@${wedges.map((w) => w.fraction.toFixed(3)).join(",")}`;
  return { key, style: { colour, radius, name, wedges } };
}

/**
 * The edges of every whole unit cell that lies inside the range (cells n..n+1 with integer n),
 * each edge once. A range thinner than one cell along some axis (a slab) holds no whole cell.
 */
export function cellEdgesInRange(structure: Structure, range: Range): [Vec3, Vec3][] {
  const tol = BOUNDARY_TOLERANCE;
  const first = [0, 1, 2].map((i) => Math.ceil(range.from[i]! - tol));
  const last = [0, 1, 2].map((i) => Math.floor(range.to[i]! + tol) - 1); // origin of the last whole cell
  const edges = new Map<string, [Vec3, Vec3]>();
  for (let i = first[0]!; i <= last[0]!; i++) for (let j = first[1]!; j <= last[1]!; j++) for (let k = first[2]!; k <= last[2]!; k++) {
    for (let axis = 0; axis < 3; axis++) {
      // The four edges of this cell that run along `axis`.
      for (const [u, v] of [[0, 0], [0, 1], [1, 0], [1, 1]] as const) {
        const start = [i, j, k];
        start[(axis + 1) % 3]! += u;
        start[(axis + 2) % 3]! += v;
        const end = [...start];
        end[axis]! += 1;
        const key = `${start.join(",")}>${axis}`;
        if (!edges.has(key)) {
          edges.set(key, [fractionalToCartesian(structure.cell, start as unknown as Vec3), fractionalToCartesian(structure.cell, end as unknown as Vec3)]);
        }
      }
    }
  }
  return [...edges.values()];
}

/** A moment given along the unit vectors of a, b, c, as a vector in cartesian axes (same units, Bohr magnetons). */
export function momentToCartesian(structure: Structure, moment: Vec3): Vec3 {
  const [a, b, c] = cellAxes(structure).map((x) => x.direction) as [Vec3, Vec3, Vec3];
  return [0, 1, 2].map((i) => moment[0] * a[i]! + moment[1] * b[i]! + moment[2] * c[i]!) as unknown as Vec3;
}

/** Size of the largest moment in the file, in Bohr magnetons (0 when there is none). */
export function largestMoment(structure: Structure): number {
  let largest = 0;
  for (const s of structure.sites) {
    if (!s.moment) continue;
    const m = momentToCartesian(structure, s.moment);
    largest = Math.max(largest, Math.hypot(m[0], m[1], m[2]));
  }
  return largest;
}

/** One sphere per atom in the chosen range (plus neighbours added by bond rules), sticks for the bonds, and the cell outline. */
export function buildScene(structure: Structure, spec: SceneSpec = DEFAULT_SPEC): Scene {
  const { atoms, bonds, warnings } = atomsAndBonds(structure, spec.range, spec.bonds);
  const styles: Record<string, SphereStyle> = {};
  const spheres: Sphere[] = atoms.map((atom) => {
    const { key, style } = styleOf(atom, spec);
    styles[key] ??= style;
    const moment = atom.moment ? momentToCartesian(structure, atom.moment) : undefined;
    return { style: key, species: atom.species, label: atom.label, frac: atom.frac, centre: atom.cart, ...(atom.added ? { added: true } : {}), ...(moment ? { moment } : {}) };
  });
  // Arrow length in proportion to the moment; the largest moment of the whole structure (not only of the
  // atoms shown) sets the scale, so changing the range never changes an arrow's length.
  const arrows: Arrow[] = [];
  const largest = largestMoment(structure);
  let hidden = 0;
  if (spec.showMoments && largest > 0) {
    spheres.forEach((s, index) => {
      if (!s.moment) return;
      const k = spec.momentLength / largest;
      const vector: Vec3 = [s.moment[0] * k, s.moment[1] * k, s.moment[2] * k];
      if (Math.hypot(vector[0], vector[1], vector[2]) / 2 <= styles[s.style]!.radius) hidden++;
      arrows.push({ sphere: index, vector });
    });
  }
  const arrowNote = hidden > 0 ? [`${hidden} moment arrow${hidden > 1 ? "s are" : " is"} shorter than the atom and cannot be seen. Increase the arrow length or reduce the atom's radius.`] : [];
  const cellEdges = spec.showCell ? cellEdgesInRange(structure, spec.range) : [];
  // Middle of the bounding box of everything drawn.
  const points = [...spheres.map((s) => s.centre), ...cellEdges.flat()];
  const mid = (i: 0 | 1 | 2): number => {
    const v = points.map((p) => p[i]);
    return v.length ? (Math.min(...v) + Math.max(...v)) / 2 : 0;
  };
  const centre: Vec3 = [mid(0), mid(1), mid(2)];
  const reach = (p: Vec3): number => Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]);
  let extent = 1;
  for (const s of spheres) extent = Math.max(extent, reach(s.centre) + styles[s.style]!.radius);
  for (const a of arrows) extent = Math.max(extent, reach(spheres[a.sphere]!.centre) + Math.hypot(a.vector[0], a.vector[1], a.vector[2]) / 2);
  for (const p of cellEdges.flat()) extent = Math.max(extent, reach(p));
  // One legend entry per name, in the order the species first appear in the file.
  const legend: LegendEntry[] = [];
  if (spec.showLegend) {
    const first = new Map<string, { style: string; site: number }>();
    spheres.forEach((s, index) => {
      const name = styles[s.style]!.name ?? s.style;
      const site = atoms[index]!.siteIndex;
      const seen = first.get(name);
      if (!seen || site < seen.site) first.set(name, { style: s.style, site });
    });
    for (const [name, { style }] of [...first].sort((p, q) => p[1].site - q[1].site)) legend.push({ style, name });
  }
  const axes = spec.showAxes ? cellAxes(structure) : [];
  return { spheres, sticks: bonds, cellEdges, styles, centre, extent, arrows, arrowColour: spec.momentColour, legend, axes, warnings: [...warnings, ...arrowNote] };
}
