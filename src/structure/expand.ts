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

/**
 * Apply every symmetry operation to every site and keep the distinct atoms of one unit cell.
 * Sites of the file that put different elements at the same place (a shared, or mixed, site)
 * become one atom with several components.
 */
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
  interface Place {
    siteIndex: number;
    labels: string[];
    components: { element: string; occupancy: number }[];
    frac: Vec3;
  }
  const places: Place[] = [];
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
      // An earlier site already at this place: the two share it.
      const shared = places.find((q) => q.siteIndex !== siteIndex && separation(q.frac, frac) < SAME_ATOM_DISTANCE);
      if (!shared) {
        places.push({ siteIndex, labels: [site.label], components: [{ element: site.element, occupancy: site.occupancy }], frac });
        continue;
      }
      if (!shared.labels.includes(site.label)) shared.labels.push(site.label);
      const same = shared.components.find((c) => c.element === site.element);
      if (same) same.occupancy += site.occupancy;
      else shared.components.push({ element: site.element, occupancy: site.occupancy });
    }
  });
  const overfull = new Set<string>();
  const atoms: CellAtom[] = places.map((p) => {
    const occupancy = p.components.reduce((sum, c) => sum + c.occupancy, 0);
    const label = p.labels.join("/");
    if (occupancy > 1.005) overfull.add(`${label}: the occupancies at this place add up to ${occupancy.toFixed(3)}, more than 1.`);
    return { siteIndex: p.siteIndex, label, species: p.components.map((c) => c.element).join("/"), components: p.components, occupancy, frac: p.frac };
  });
  return { atoms, warnings: [...warnings, ...overfull] };
}
