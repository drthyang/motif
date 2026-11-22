import { orthogonalizationMatrix, mulVec } from "./cell";
import { applyOperation, wrapFractional } from "./symmetry";
import type { SymmetryOperation } from "./types";
import type { CellAtom, Structure, Vec3 } from "./types";

/**
 * Two images of one site closer than this (in angstrom) are the same atom:
 * the site lies on a symmetry element. Coordinates rounded in the file
 * (0.3333 for 1/3) put such images a few thousandths of an angstrom apart.
 */
export const SAME_ATOM_DISTANCE = 0.05;
/** Merged images further apart than this are reported, so rounding in the file is visible. */
const REPORT_DISTANCE = 0.005;

/**
 * A magnetic moment carried from a site to its image by a symmetry operation.
 * A moment is an axial vector that changes sign under time reversal, so
 *   m' = (time reversal) x det(R) x R m.
 * R acts on components along the cell vectors a, b, c; the file gives components along the
 * unit vectors of a, b, c (in Bohr magnetons), so each component is divided by its cell edge
 * before R is applied and multiplied by it afterwards.
 */
export function transformMoment(op: SymmetryOperation, moment: Vec3, edges: Vec3): Vec3 {
  const r = op.rotation;
  const det =
    r[0][0] * (r[1][1] * r[2][2] - r[1][2] * r[2][1]) -
    r[0][1] * (r[1][0] * r[2][2] - r[1][2] * r[2][0]) +
    r[0][2] * (r[1][0] * r[2][1] - r[1][1] * r[2][0]);
  const sign = det * (op.timeReversal ?? 1);
  const f = mulVec(r, [moment[0] / edges[0], moment[1] / edges[1], moment[2] / edges[2]]);
  // "+ 0" turns -0 into 0.
  return [sign * f[0] * edges[0] + 0, sign * f[1] * edges[1] + 0, sign * f[2] * edges[2] + 0];
}

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
  const edges: Vec3 = [structure.cell.a, structure.cell.b, structure.cell.c];
  interface Place {
    moment?: Vec3;
    siteIndex: number;
    labels: string[];
    components: { element: string; occupancy: number }[];
    frac: Vec3;
  }
  const places: Place[] = [];
  const differing = new Set<string>();
  const warnings: string[] = [];
  structure.sites.forEach((site, siteIndex) => {
    const images: Vec3[] = [];
    const moments: (Vec3 | undefined)[] = [];
    let widestMerge = 0;
    let momentClash = 0;
    for (const op of structure.operations) {
      const p = wrapFractional(applyOperation(op, site.frac));
      const m = site.moment ? transformMoment(op, site.moment, edges) : undefined;
      const near = images.map((q) => separation(p, q));
      const closest = near.length ? Math.min(...near) : Infinity;
      if (closest < SAME_ATOM_DISTANCE) {
        widestMerge = Math.max(widestMerge, closest);
        // Two operations bring the site to the same atom: they must also bring the same moment.
        const first = moments[near.indexOf(closest)];
        if (m && first) momentClash = Math.max(momentClash, Math.hypot(m[0] - first[0], m[1] - first[1], m[2] - first[2]));
      } else {
        images.push(p);
        moments.push(m);
      }
    }
    if (site.moment && momentClash > 0.01 + 0.01 * Math.hypot(...site.moment)) {
      warnings.push(
        `${site.label}: the moment in the file is not allowed by the magnetic symmetry of its site (two operations give moments ${momentClash.toFixed(2)} Bohr magnetons apart). The arrows drawn for it may be wrong.`,
      );
    }
    if (widestMerge > REPORT_DISTANCE) {
      warnings.push(
        `${site.label}: symmetry images up to ${widestMerge.toFixed(3)} A apart were taken as one atom (rounded coordinates on a special position).`,
      );
    }
    if (site.statedMultiplicity !== undefined && site.statedMultiplicity !== images.length) {
      warnings.push(`${site.label}: the file states multiplicity ${site.statedMultiplicity}, but the symmetry operations give ${images.length} atoms per cell.`);
    }
    images.forEach((frac, n) => {
      const moment = moments[n];
      // An earlier site already at this place: the two share it.
      const shared = places.find((q) => q.siteIndex !== siteIndex && separation(q.frac, frac) < SAME_ATOM_DISTANCE);
      if (!shared) {
        places.push({ siteIndex, labels: [site.label], components: [{ element: site.element, occupancy: site.occupancy }], frac, ...(moment ? { moment } : {}) });
        return;
      }
      // Elements sharing a place: the place shows the first moment given; differing moments are reported.
      if (moment && !shared.moment) shared.moment = moment;
      else if (moment && shared.moment && Math.hypot(moment[0] - shared.moment[0], moment[1] - shared.moment[1], moment[2] - shared.moment[2]) > 0.01) {
        differing.add(`${shared.labels.join("/")}/${site.label}: the elements sharing this place have different moments; the first one is drawn.`);
      }
      if (!shared.labels.includes(site.label)) shared.labels.push(site.label);
      const same = shared.components.find((c) => c.element === site.element);
      if (same) same.occupancy += site.occupancy;
      else shared.components.push({ element: site.element, occupancy: site.occupancy });
    });
  });
  const overfull = new Set<string>(differing);
  const atoms: CellAtom[] = places.map((p) => {
    const occupancy = p.components.reduce((sum, c) => sum + c.occupancy, 0);
    const label = p.labels.join("/");
    if (occupancy > 1.005) overfull.add(`${label}: the occupancies at this place add up to ${occupancy.toFixed(3)}, more than 1.`);
    return { siteIndex: p.siteIndex, label, species: p.components.map((c) => c.element).join("/"), components: p.components, occupancy, frac: p.frac, ...(p.moment ? { moment: p.moment } : {}) };
  });
  return { atoms, warnings: [...warnings, ...overfull] };
}
