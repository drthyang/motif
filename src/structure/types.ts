export type Vec3 = readonly [number, number, number];
export type Mat3 = readonly [Vec3, Vec3, Vec3];

/** Unit cell: lengths in angstrom, angles in degrees. */
export interface Cell {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
}

/** x' = rotation . x + translation, in fractional coordinates. */
export interface SymmetryOperation {
  readonly rotation: Mat3;
  readonly translation: Vec3;
  /** As written in the file, e.g. "-x,y+1/2,-z". */
  readonly xyz: string;
  /** Magnetic time reversal: +1 or -1. Absent means +1 (not magnetic). */
  readonly timeReversal?: 1 | -1;
}

/** One row of the file's atom list (a site of the asymmetric unit). */
export interface Site {
  readonly label: string;
  /** Element symbol, e.g. "Fe"; "D" for deuterium. */
  readonly element: string;
  /** Fractional coordinates as given in the file. */
  readonly frac: Vec3;
  readonly occupancy: number;
  /** The multiplicity the file states for this site, when it states one. */
  readonly statedMultiplicity?: number;
}

/** What a CIF says: cell, symmetry operations, sites. Nothing about drawing. */
export interface Structure {
  readonly name: string;
  readonly cell: Cell;
  /** Space-group symbol as written in the file (for display only). */
  readonly spaceGroupName?: string;
  /** Every operation of the space group, as listed in the file. */
  readonly operations: readonly SymmetryOperation[];
  readonly sites: readonly Site[];
}

/** One atom of the unit cell, produced from a site by one symmetry operation. */
export interface CellAtom {
  readonly siteIndex: number;
  readonly label: string;
  readonly element: string;
  readonly occupancy: number;
  /** Fractional coordinates wrapped into [0, 1). */
  readonly frac: Vec3;
}
