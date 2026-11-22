import { orthogonalizationMatrix, mulVec } from "./cell";
import { applyOperation, wrapFractional } from "./symmetry";
import type { CellAtom, Structure, Vec3 } from "./types";

/**
 * Two images of one site closer than this (in angstrom) are the same atom:
 * the site lies on a symmetry element. Coordinates rounded in the file
 * (0.3333 for 1/3) put such images a few thousandths of an angstrom apart.
 */
export const SAME_ATOM_DISTANCE = 0.05;
/** Merged images further apart than this are reported, so rounding in the file is visible. */
const REPORT_DISTANCE = 0.005;

export interface Expansion {
  /** Every atom of one unit cell, fractional coordinates in [0, 1). */
  readonly atoms: readonly CellAtom[];
  /** Plain-language notes about anything unusual met on the way. */
  readonly warnings: readonly string[];
}

/** Apply every symmetry operation to every site and keep the distinct atoms of one unit cell. */
export function expandToUnitCell(structure: Structure): Expansion {
  const m = orthogonalizationMatrix(structure.cell);
  // Distance between two fractional points, taking the nearest lattice image.
  const separation = (p: Vec3, q: Vec3): number => {
    const d = [0, 1, 2].map((i) => {
      const x = p[i]! - q[i]!;
      return x - Math.round(x);
    }) as unknown as Vec3;
    const c = mulVec(m, d);
    return Math.hypot(c[0], c[1], c[2]);
  };
  const atoms: CellAtom[] = [];
  const warnings: string[] = [];
  structure.sites.forEach((site, siteIndex) => {
    const images: Vec3[] = [];
    let widestMerge = 0;
    for (const op of structure.operations) {
      const p = wrapFractional(applyOperation(op, site.frac));
      const near = images.map((q) => separation(p, q));
      const closest = near.length ? Math.min(...near) : Infinity;
      if (closest < SAME_ATOM_DISTANCE) widestMerge = Math.max(widestMerge, closest);
      else images.push(p);
    }
    if (widestMerge > REPORT_DISTANCE) {
      warnings.push(
        `${site.label}: symmetry images up to ${widestMerge.toFixed(3)} A apart were taken as one atom (rounded coordinates on a special position).`,
      );
    }
    if (site.statedMultiplicity !== undefined && site.statedMultiplicity !== images.length) {
      warnings.push(`${site.label}: the file states multiplicity ${site.statedMultiplicity}, but the symmetry operations give ${images.length} atoms per cell.`);
    }
    for (const frac of images) {
      atoms.push({ siteIndex, label: site.label, element: site.element, occupancy: site.occupancy, frac });
    }
  });
  return { atoms, warnings };
}
