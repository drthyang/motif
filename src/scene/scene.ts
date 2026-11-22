/**
 * The scene: what is drawn and how it is styled, as plain data (JSON-safe).
 * Positions are cartesian, in angstrom. The scene knows nothing about the view.
 */
import { fractionalToCartesian } from "../structure/cell";
import { expandToUnitCell } from "../structure/expand";
import type { Structure, Vec3 } from "../structure/types";
import { defaultColour, defaultRadius } from "./elementStyle";

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

/** Step 1: one unit cell, every atom with fractional coordinates in [0, 1), one sphere per site image. */
export function buildScene(structure: Structure): Scene {
  const { atoms, warnings } = expandToUnitCell(structure);
  const styles: Record<string, SphereStyle> = {};
  const spheres: Sphere[] = atoms.map((atom) => {
    styles[atom.element] ??= { colour: defaultColour(atom.element), radius: defaultRadius(atom.element) };
    return { style: atom.element, label: atom.label, centre: fractionalToCartesian(structure.cell, atom.frac) };
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
