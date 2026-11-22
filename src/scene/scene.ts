/**
 * The scene: what is drawn and how it is styled, as plain data (JSON-safe).
 * Positions are cartesian, in angstrom. The scene knows nothing about the view.
 */
import { fractionalToCartesian } from "../structure/cell";
import type { Structure, Vec3 } from "../structure/types";
import { defaultColour, defaultRadius } from "./elementStyle";
import { ONE_CELL, atomsInRange, type Range } from "./select";

export interface SphereStyle {
  /** Base colour "#rrggbb"; the shading is derived from it. */
  readonly colour: string;
  /** Radius in angstrom. */
  readonly radius: number;
}

export interface Sphere {
  /** Key into Scene.styles. */
  readonly style: string;
  readonly label: string;
  /** Fractional coordinates (for reading off; the drawing uses `centre`). */
  readonly frac?: Vec3;
  readonly centre: Vec3;
}

export interface Scene {
  readonly spheres: readonly Sphere[];
  readonly styles: Readonly<Record<string, SphereStyle>>;
  /** The point kept at the middle of the drawing. */
  readonly centre: Vec3;
  /** Radius of a ball around `centre` that holds every sphere: the drawing scale comes from it, so rotating never rescales. */
  readonly extent: number;
  readonly warnings: readonly string[];
}

/** What the user has chosen to show. Plain data: it can be saved and loaded again. */
export interface SceneSpec {
  readonly range: Range;
}

export const DEFAULT_SPEC: SceneSpec = { range: ONE_CELL };

/** One sphere per atom in the chosen range. */
export function buildScene(structure: Structure, spec: SceneSpec = DEFAULT_SPEC): Scene {
  const { atoms, warnings } = atomsInRange(structure, spec.range);
  const styles: Record<string, SphereStyle> = {};
  const spheres: Sphere[] = atoms.map((atom) => {
    styles[atom.element] ??= { colour: defaultColour(atom.element), radius: defaultRadius(atom.element) };
    return { style: atom.element, label: atom.label, frac: atom.frac, centre: fractionalToCartesian(structure.cell, atom.frac) };
  });
  // Middle of the atoms' bounding box. (Step 3 draws the unit cell; the centre is reviewed then.)
  const mid = (i: 0 | 1 | 2): number => {
    const v = spheres.map((s) => s.centre[i]);
    return v.length ? (Math.min(...v) + Math.max(...v)) / 2 : 0;
  };
  const centre: Vec3 = [mid(0), mid(1), mid(2)];
  let extent = 1;
  for (const s of spheres) {
    const d = Math.hypot(s.centre[0] - centre[0], s.centre[1] - centre[1], s.centre[2] - centre[2]);
    extent = Math.max(extent, d + styles[s.style]!.radius);
  }
  return { spheres, styles, centre, extent, warnings };
}
