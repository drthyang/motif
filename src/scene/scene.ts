// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The scene: what is drawn and how it is styled, as plain data (JSON-safe).
 * Positions are cartesian, in angstrom. The scene knows nothing about the view.
 */
import { fractionalToCartesian, mulVec, orthogonalizationMatrix } from "../structure/cell";
import type { CellAtom, Component, Structure, Vec3 } from "../structure/types";
import { defaultColour, defaultRadius } from "./elementStyle";
import { angleKinds, anglesOfRule, bondAngles, DEFAULT_ANGLE_LOOK, type AngleKind, type AngleRule } from "./angles";
import { atomsAndBonds, type BondRule } from "./bonds";
import { mixHex } from "./elementStyle";
import { connectedGroups, prune, triangles } from "./highlight";
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
  /** Displacement from the parent structure in angstrom, in the same cartesian axes as `centre`. */
  readonly displacement?: Vec3;
}

/**
 * An arrow on an atom. A magnetic moment is drawn through the atom, centred on it; an atomic displacement
 * (a distortion mode) starts at the atom's centre (the user's rule).
 */
export interface Arrow {
  /** Index into Scene.spheres. */
  readonly sphere: number;
  /** "centre": the arrow starts at the atom's centre. Absent: it passes through the atom, centred on it. */
  readonly start?: "centre";
  /** Its own colour and rod thickness (angstrom), when not the scene's arrow style (displacements). */
  readonly colour?: string;
  readonly thickness?: number;
  /** Its cone relative to the usual proportion to the rod (displacements: smaller, so a thick short arrow keeps a shaft). */
  readonly headScale?: number;
  /** From tail to tip, in angstrom: the direction is the moment's, the length is its size times the chosen scale. */
  readonly vector: Vec3;
}

/**
 * How a surface is drawn. All are plain vector shading (gradients), not a rendered scene:
 * soft (the default, a gentle highlight), flat (one colour), glossy (a bright highlight spot),
 * metal (strong light and dark bands with a lit rim), glass (see-through, with a highlight).
 */
export type CellStyle = "depth" | "dashed" | "solid";
export type Material = "soft" | "flat" | "glossy" | "metal" | "glass";
export const MATERIALS: readonly Material[] = ["soft", "flat", "glossy", "metal", "glass"];

/** A stick between two spheres. */
export interface Stick {
  /** Indices into Scene.spheres. */
  readonly i: number;
  readonly j: number;
  /** Index of the bond rule that made it. */
  readonly rule: number;
  /** Centre-to-centre distance in angstrom. */
  readonly length: number;
  /** True for a bond outside the highlighted chain: drawn paler and thinner. */
  readonly pale?: boolean;
}

/** Look of the sticks of one bond rule. */
export interface StickStyle {
  readonly colour: string;
  /** Thickness in angstrom. */
  readonly width: number;
}

/** A soft band laid behind a chain: wide, translucent strokes along its bonds, drawn as one shape. */
export interface Band {
  /** Pairs of indices into Scene.spheres. */
  readonly segments: readonly (readonly [number, number])[];
  readonly colour: string;
  /** Width in angstrom. */
  readonly width: number;
  readonly opacity: number;
}

/** A filled polygon between atoms. */
export interface Polygon {
  /** Indices into Scene.spheres. */
  readonly corners: readonly number[];
  /** The bond rule whose bonds are its sides (their thickness sets how far the fill stays off them). */
  readonly rule?: number;
  readonly colour: string;
  readonly opacity: number;
}

/** A marked bond angle: a translucent sector between two bonds at their common atom. */
export interface Sector {
  /** Indices into Scene.spheres: the apex and the two ends. */
  readonly apex: number;
  readonly a: number;
  readonly b: number;
  /** The angle in degrees. */
  readonly degrees: number;
  readonly colour: string;
  readonly opacity: number;
  /** Radius of the sector in angstrom, measured from the centre of the apex atom. */
  readonly radius: number;
  readonly label: boolean;
  /** Index of the angle rule that made it. */
  readonly rule: number;
}

/** What a bond rule found: shown to the user beside the rule. */
export interface RuleInfo {
  /** Number of connected groups (chains, nets) its bonds form. */
  readonly groups: number;
  readonly triangles: number;
  /** Colour the filled triangles are drawn in (the chosen one, else the usual tint); null with no triangles. */
  readonly fillColour?: string | null;
}

export const DEFAULT_STICK: StickStyle = { colour: "#b4bbc1", width: 0.12 };
export const BAND_COLOUR = "#f3c26a";
/** How far a pale atom or bond is mixed towards white. */
export const PALE = 0.68;

export interface Scene {
  readonly spheres: readonly Sphere[];
  readonly sticks: readonly Stick[];
  /** Unit-cell edges, each a pair of end points in angstrom. */
  readonly cellEdges: readonly (readonly [Vec3, Vec3])[];
  /** One entry per bond rule of the spec, in the same order. */
  readonly stickStyles: readonly StickStyle[];
  readonly ruleInfo: readonly RuleInfo[];
  readonly bands: readonly Band[];
  readonly polygons: readonly Polygon[];
  /** Marked bond angles. */
  readonly sectors: readonly Sector[];
  /** The kinds of angle present among the drawn bonds, for the user to choose from. */
  readonly angleKinds: readonly AngleKind[];
  readonly styles: Readonly<Record<string, SphereStyle>>;
  /** The point kept at the middle of the drawing. */
  readonly centre: Vec3;
  /** Radius of a ball around `centre` that holds everything drawn: the drawing scale comes from it, so rotating never rescales. */
  readonly extent: number;
  /** Moment arrows. Empty when the structure has no moments or they are switched off. */
  readonly arrows: readonly Arrow[];
  readonly arrowColour: string;
  /** Thickness of the arrows' rods in angstrom (absent: the default). The head is in proportion. */
  readonly arrowThickness?: number;
  /** Size of the arrows' cone relative to its usual proportion to the rod (absent = 1); the same for the axis arrows. */
  readonly arrowHeadSize?: number;
  readonly axesHeadSize?: number;
  /** Colours of the a, b, c arrows and their letters (absent = all grey). */
  readonly axesColours?: readonly [string, string, string] | undefined;
  /** The surface of the atoms and of the arrows (absent = soft). */
  readonly atomMaterial?: Material;
  readonly arrowMaterial?: Material;
  /** How solid glass is, 0 to 1 (absent = 0.3). */
  readonly glassOpacity?: number;
  /** How the cell's edges are drawn, and their width in px (absent: all dashed, 4 px, as at first). */
  readonly cellStyle?: CellStyle;
  readonly cellWidth?: number;
  /**
   * The surface of the bonds and whether they are outlined. When `bondMaterial` is absent the bonds are drawn
   * as plain strokes (as the page does for a very large structure).
   */
  readonly bondMaterial?: Material;
  readonly bondOutline?: boolean;
  /** Short axis arrows are lengthened to stay readable (absent = yes). */
  readonly axesKeepReadable?: boolean;
  /** Outline the moment arrows; outline the axis arrows. */
  readonly arrowOutline?: boolean;
  readonly axesOutline?: boolean;
  /** Weight of the lettering. */
  readonly letterWeight: number;
  /** Font of the lettering (a font name; absent means the default list). */
  readonly fontFamily?: string;
  /** The legend is drawn at the scale of the structure. */
  readonly legendFollowsZoom?: boolean;
  /** Size of the legend and of the axis arrows, as multiples of their usual size (absent = 1). */
  readonly legendSize?: number;
  readonly axesSize?: number;
  /** Text sizes in pt (see `ptPerUnit` in the renderer); absent or null = in proportion to the legend or axes size. */
  readonly legendFontPt?: number | null;
  readonly axesFontPt?: number | null;
  readonly angleFontPt?: number | null;
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
  /** Bond angles to mark. They are angles between drawn bonds, so the bonds come first. */
  readonly angles: readonly AngleRule[];
  /** Draw the magnetic moments as arrows. */
  readonly showMoments: boolean;
  /** Draw the displacements of a distortion (an ISODISTORT file) as arrows from the atoms' centres. */
  readonly showDisplacements?: boolean;
  /** Length in angstrom of the arrow of the largest displacement; the others are in proportion. */
  readonly displacementLength?: number;
  /** Colour and rod thickness (angstrom) of the displacement arrows, apart from the moment arrows'. */
  readonly displacementColour?: string;
  readonly displacementThickness?: number;
  /** Length in angstrom of the arrow of the largest moment in the structure; the others are in proportion. */
  readonly momentLength: number;
  readonly momentColour: string;
  /** Thickness of the rod of a moment arrow, in angstrom. The cone at its tip is in proportion. */
  readonly momentThickness: number;
  /** Size of the cone at the tip of a moment arrow, and of an axis arrow, as multiples of the usual proportion to the rod (1 = usual). */
  readonly momentHeadSize: number;
  readonly axesHeadSize: number;
  /** Draw the a, b, c arrows each in its own colour (axesColours); otherwise all three are grey. */
  readonly axesColoured: boolean;
  readonly axesColours: readonly [string, string, string];
  /** The surface of the atoms, and of the arrows (moment arrows and axis arrows). */
  readonly atomMaterial: Material;
  readonly arrowMaterial: Material;
  /**
   * How the unit cell is drawn: "depth" (edges in front of the middle of the structure solid, edges behind it
   * paler and dashed, so the box reads as a solid), "dashed" (all dashed) or "solid"; and the line width in px.
   */
  readonly cellStyle: CellStyle;
  readonly cellWidth: number;
  /**
   * How solid glass is, 0 to 1: 0.3 is the usual glass, lower is clearer, 1 is no longer see-through.
   * It applies wherever the glass surface is chosen (atoms, bonds, arrows).
   */
  readonly glassOpacity: number;
  /** The surface of the bonds, and whether they have a thin darker outline. */
  readonly bondMaterial: Material;
  readonly bondOutline: boolean;
  /** Draw an axis arrow that points mostly into or out of the page at least 0.45 of the full length, so it stays readable. */
  readonly axesKeepReadable: boolean;
  /** Draw a thin darker outline around the moment arrows, and around the axis arrows, as the spheres have. */
  readonly momentOutline: boolean;
  readonly axesOutline: boolean;
  /** Weight of the lettering (legend, axes, angle labels): 400 regular, 500 medium, 800 heavy. */
  readonly letterWeight: number;
  /** Font of the lettering: the name of a font installed on the computer that shows the figure. */
  readonly fontFamily: string;
  /** Draw the legend's spheres at the size of the atoms in the figure (so the legend follows the zoom), its letters in proportion. */
  readonly legendFollowsZoom: boolean;
  /** Size of the legend and of the axis arrows, as multiples of their usual size (1 = usual). */
  readonly legendSize: number;
  readonly axesSize: number;
  /** Text sizes in pt of the legend names, the axis letters and the angle labels; null = automatic. */
  readonly legendFontPt: number | null;
  readonly axesFontPt: number | null;
  readonly angleFontPt: number | null;
  /** Draw a row of spheres with their names under the structure. */
  readonly showLegend: boolean;
  /** Draw the a, b, c arrows under the structure. */
  readonly showAxes: boolean;
}

export interface Look {
  /** For a species: leave its atoms out of the figure. */
  readonly hidden?: boolean;
  readonly colour?: string;
  readonly radius?: number;
  readonly name?: string;
  /** For a shared site: the order of its wedges, as element symbols. Elements not named keep their file order, after the named ones. */
  readonly order?: readonly string[];
}

export const VACANCY_COLOUR = "#ffffff";

/** Length in angstrom of the arrow of the largest displacement, unless chosen. */
export const DEFAULT_DISPLACEMENT_LENGTH = 1.5;
/** Displacement arrows look apart from moment arrows: green and thicker (the user's choice). */
export const DEFAULT_DISPLACEMENT_COLOUR = "#27a33a";
/** The cone of a displacement arrow, relative to the usual proportion to its rod. */
export const DISPLACEMENT_HEAD_SCALE = 0.6;
export const DEFAULT_DISPLACEMENT_THICKNESS = 0.26;

/** Usual colours of the a, b, c arrows: a muted red, green and blue, in that order. */
export const AXES_COLOURS: readonly [string, string, string] = ["#c4473f", "#3f8a4a", "#3567b0"];

export const DEFAULT_SPEC: SceneSpec = { range: ONE_CELL, bonds: [], showCell: true, looks: {}, showVacancy: true, angles: [], showMoments: true, momentLength: 3, momentColour: "#c2343c", momentThickness: 0.16, momentHeadSize: 1, axesHeadSize: 1, axesColoured: true, axesColours: AXES_COLOURS, momentOutline: true, axesOutline: true, axesKeepReadable: true, atomMaterial: "soft", arrowMaterial: "soft", bondMaterial: "soft", bondOutline: false, cellStyle: "depth", cellWidth: 3, glassOpacity: 0.75, letterWeight: 400, fontFamily: "Avenir", legendFollowsZoom: false, legendSize: 1, axesSize: 1, legendFontPt: null, axesFontPt: null, angleFontPt: null, showLegend: true, showAxes: true };

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
  const order = spec.looks[atom.species]?.order ?? [];
  const rank = (element: string): number => (order.includes(element) ? order.indexOf(element) : order.length);
  const components = atom.components.map((c, index) => ({ c, index })).sort((p, q) => rank(p.c.element) - rank(q.c.element) || p.index - q.index).map(({ c }) => c);
  const wedges: Wedge[] = components.map((c) => ({ colour: elementColour(c.element, spec.looks), fraction: c.occupancy / total, element: c.element }));
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

/** A displacement in fractional units of the file's cell, as angstrom in cartesian axes (with the undistorted supercell). */
export function displacementToCartesian(structure: Structure, d: Vec3): Vec3 {
  return mulVec(orthogonalizationMatrix(structure.distortion?.undistortedCell ?? structure.cell), d);
}

/** Size of the largest displacement in the file (with the modes switched on), in angstrom (0 when there is none). */
export function largestDisplacement(structure: Structure): number {
  let largest = 0;
  for (const s of structure.sites) {
    if (!s.displacement) continue;
    largest = Math.max(largest, Math.hypot(...displacementToCartesian(structure, s.displacement)));
  }
  return largest;
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
  const hiddenSpecies = new Set(Object.entries(spec.looks).filter(([, look]) => look.hidden).map(([species]) => species));
  const selected = atomsAndBonds(structure, spec.range, spec.bonds, hiddenSpecies);
  const { atoms, bonds } = prune(selected.atoms, selected.bonds, spec.bonds);
  const warnings = selected.warnings;
  const styles: Record<string, SphereStyle> = {};
  // Highlights: chains and triangles in the bonds of each rule.
  const stickStyles: StickStyle[] = spec.bonds.map((r) => ({ colour: r.colour ?? DEFAULT_STICK.colour, width: r.width ?? DEFAULT_STICK.width }));
  const ruleInfo: RuleInfo[] = [];
  const bandSpecs: { segments: [number, number][]; rule: number }[] = [];
  const polygonSpecs: { corners: number[]; rule: number }[] = [];
  const paleAtoms = new Set<number>();
  const paleBonds = new Set<number>();
  spec.bonds.forEach((rule, ruleIndex) => {
    const own = bonds.map((b, index) => ({ b, index })).filter(({ b }) => b.rule === ruleIndex);
    const groups = connectedGroups(atoms, own.map(({ b }) => b));
    const found = triangles(own.map(({ b }) => b));
    ruleInfo.push({ groups: groups.length, triangles: found.length });
    if (rule.fill) for (const t of found) polygonSpecs.push({ corners: t, rule: ruleIndex });
    if (!rule.band) return;
    const chosen = rule.chain !== undefined && rule.chain !== null && rule.chain >= 0 && rule.chain < groups.length ? rule.chain : null;
    groups.forEach((group, g) => {
      const members = new Set(group);
      const inGroup = own.filter(({ b }) => members.has(b.i));
      if (chosen === null || chosen === g) bandSpecs.push({ segments: inGroup.map(({ b }) => [b.i, b.j]), rule: ruleIndex });
      else for (const { index } of inGroup) paleBonds.add(index);
    });
    if (chosen !== null) {
      // Every atom of the rule's two species outside the highlighted group steps back.
      const keep = new Set(groups[chosen]);
      atoms.forEach((a, index) => {
        if ((a.species === rule.centre || a.species === rule.neighbour) && !keep.has(index)) paleAtoms.add(index);
      });
    }
  });
  const pale = (style: SphereStyle): SphereStyle => ({
    ...style,
    colour: mixHex(style.colour, "#ffffff", PALE),
    ...(style.wedges ? { wedges: style.wedges.map((w) => ({ ...w, colour: mixHex(w.colour, "#ffffff", PALE) })) } : {}),
  });
  const spheres: Sphere[] = atoms.map((atom, index) => {
    const base = styleOf(atom, spec);
    const [key, style] = paleAtoms.has(index) ? [`${base.key}~pale`, pale(base.style)] : [base.key, base.style];
    styles[key] ??= style;
    const moment = atom.moment ? momentToCartesian(structure, atom.moment) : undefined;
    const displacement = atom.displacement ? displacementToCartesian(structure, atom.displacement) : undefined;
    return { style: key, species: atom.species, label: atom.label, frac: atom.frac, centre: atom.cart, ...(atom.added ? { added: true } : {}), ...(moment ? { moment } : {}), ...(displacement ? { displacement } : {}) };
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
  // Displacements: from the atom's centre, the largest of the file at the chosen length.
  const largestShift = largestDisplacement(structure);
  if ((spec.showDisplacements ?? true) && largestShift > 0) {
    const k = (spec.displacementLength ?? DEFAULT_DISPLACEMENT_LENGTH) / largestShift;
    spheres.forEach((s, index) => {
      if (!s.displacement) return;
      const vector: Vec3 = [s.displacement[0] * k, s.displacement[1] * k, s.displacement[2] * k];
      if (Math.hypot(vector[0], vector[1], vector[2]) <= styles[s.style]!.radius) hidden++;
      arrows.push({
        sphere: index,
        vector,
        start: "centre",
        colour: spec.displacementColour ?? DEFAULT_DISPLACEMENT_COLOUR,
        thickness: spec.displacementThickness ?? DEFAULT_DISPLACEMENT_THICKNESS,
        headScale: DISPLACEMENT_HEAD_SCALE,
      });
    });
  }
  const arrowNote = hidden > 0 ? [`${hidden} arrow${hidden > 1 ? "s are" : " is"} shorter than the atom and cannot be seen. Increase the arrow length or reduce the atom's radius.`] : [];
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
  for (const a of arrows) extent = Math.max(extent, reach(spheres[a.sphere]!.centre) + Math.hypot(a.vector[0], a.vector[1], a.vector[2]) / (a.start === "centre" ? 1 : 2));
  for (const p of cellEdges.flat()) extent = Math.max(extent, reach(p));
  // One legend entry per name, in the order the species first appear in the file.
  const legend: LegendEntry[] = [];
  if (spec.showLegend) {
    const first = new Map<string, { style: string; site: number }>();
    spheres.forEach((s, index) => {
      const name = styles[s.style]!.name ?? s.style;
      const site = atoms[index]!.siteIndex;
      const seen = first.get(name);
      // The legend shows the full-strength sphere, not a paled one, when both are drawn.
      const better = !seen || (seen.style.endsWith("~pale") && !s.style.endsWith("~pale")) || (seen.style.endsWith("~pale") === s.style.endsWith("~pale") && site < seen.site);
      if (better) first.set(name, { style: s.style, site: seen ? Math.min(seen.site, site) : site });
      else if (site < seen.site) first.set(name, { style: seen.style, site });
    });
    for (const [name, { style }] of [...first].sort((p, q) => p[1].site - q[1].site)) legend.push({ style, name });
  }
  const axes = spec.showAxes ? cellAxes(structure) : [];
  const allAngles = bondAngles(atoms, bonds);
  const sectors: Sector[] = spec.angles.flatMap((rule, ruleIndex) =>
    anglesOfRule(atoms, allAngles, rule).map((t) => ({
      apex: t.apex,
      a: t.a,
      b: t.b,
      degrees: t.degrees,
      colour: rule.colour ?? DEFAULT_ANGLE_LOOK.colour,
      opacity: rule.opacity ?? DEFAULT_ANGLE_LOOK.opacity,
      radius: rule.radius ?? DEFAULT_ANGLE_LOOK.radius,
      label: rule.label ?? DEFAULT_ANGLE_LOOK.label,
      rule: ruleIndex,
    })),
  );
  const sticks: Stick[] = bonds.map((b, index) => (paleBonds.has(index) ? { ...b, pale: true } : b));
  const radiusOf = (index: number): number => styles[spheres[index]!.style]!.radius;
  const bands: Band[] = bandSpecs
    .filter((b) => b.segments.length > 0)
    .map((b) => ({ segments: b.segments, colour: BAND_COLOUR, width: 2.4 * Math.max(...b.segments.flat().map(radiusOf)), opacity: 0.5 }));
  const polygons: Polygon[] = polygonSpecs.map((p) => ({
    corners: p.corners,
    rule: p.rule,
    colour: spec.bonds[p.rule]!.fillColour ?? mixHex(styles[spheres[p.corners[0]!]!.style]!.colour, "#ffffff", 0.55),
    opacity: 0.55,
  }));
  polygons.forEach((p, k) => {
    const rule = polygonSpecs[k]!.rule;
    if (ruleInfo[rule] && ruleInfo[rule]!.fillColour === undefined) ruleInfo[rule] = { ...ruleInfo[rule]!, fillColour: p.colour };
  });
  return { spheres, sticks, cellEdges, stickStyles, ruleInfo, bands, polygons, sectors, angleKinds: angleKinds(atoms, allAngles), styles, centre, extent, arrows, arrowColour: spec.momentColour, arrowThickness: spec.momentThickness, arrowHeadSize: spec.momentHeadSize, axesHeadSize: spec.axesHeadSize, axesColours: spec.axesColoured ? spec.axesColours : undefined, arrowOutline: spec.momentOutline, axesOutline: spec.axesOutline, axesKeepReadable: spec.axesKeepReadable, atomMaterial: spec.atomMaterial, arrowMaterial: spec.arrowMaterial, bondMaterial: spec.bondMaterial, bondOutline: spec.bondOutline, cellStyle: spec.cellStyle, cellWidth: spec.cellWidth, glassOpacity: spec.glassOpacity, letterWeight: spec.letterWeight, fontFamily: spec.fontFamily, legendFollowsZoom: spec.legendFollowsZoom, legendSize: spec.legendSize, axesSize: spec.axesSize, legendFontPt: spec.legendFontPt, axesFontPt: spec.axesFontPt, angleFontPt: spec.angleFontPt, legend, axes, warnings: [...warnings, ...arrowNote] };
}
