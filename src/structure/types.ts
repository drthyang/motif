// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

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
  /** Magnetic moment in Bohr magnetons, as components along the unit vectors of the cell edges a, b, c (the mCIF "crystalaxis" form). */
  readonly moment?: Vec3;
  /**
   * Displacement from the parent (high-symmetry) structure, in fractional coordinates of the file's cell,
   * from the displacive modes switched on (see Distortion). Absent when the file describes none.
   */
  readonly displacement?: Vec3;
}

/** One displacive mode of an ISODISTORT file. */
export interface DisplaciveMode {
  /** As written, e.g. "Pm-3m[0,0,0]GM4-(0,0,a)[Ti:a:dsp]T1u(a)". */
  readonly label: string;
  /** Amplitude in angstrom (ISODISTORT's convention: over the undistorted supercell). */
  readonly amplitude: number;
  /** Normalization factor: amplitude x norm is in fractional units. */
  readonly norm: number;
}

/**
 * The displacive distortion an ISODISTORT CIF describes. The fractional shift of a coordinate (a "delta") is
 *   delta_i = sum_j matrix[i][j] x amplitude_j x norm_j,
 * and each delta adds, with a coefficient, to coordinates of named sites.
 */
export interface Distortion {
  readonly modes: readonly DisplaciveMode[];
  /** matrix[i][j]: delta i from mode j. */
  readonly matrix: readonly (readonly number[])[];
  /** The deltas as the file states them (all modes at their amplitudes), for checking. */
  readonly deltas: readonly { readonly label: string; readonly value: number }[];
  /** Which site coordinate each delta moves: coordinate `axis` of site `site` changes by coefficient x delta. */
  readonly uses: readonly { readonly site: string; readonly axis: 0 | 1 | 2; readonly delta: number; readonly coefficient: number }[];
  /** The undistorted supercell (parent cell in the file's basis): fractional shifts become angstrom with it. */
  readonly undistortedCell: Cell;
  /** Kinds of mode in the file that are not drawn (strain, magnetic, ...), in words. */
  readonly notDrawn: readonly string[];
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
  /** True when the file is a magnetic CIF: the operations then carry time reversal and are the magnetic group. */
  readonly magnetic: boolean;
  /** Present for an ISODISTORT file with displacive modes. */
  readonly distortion?: Distortion;
}

export interface Component {
  readonly element: string;
  readonly occupancy: number;
}

/** One atom of the unit cell, produced from a site by one symmetry operation. */
export interface CellAtom {
  /** Index of the (first) site of the file that this atom comes from. */
  readonly siteIndex: number;
  readonly label: string;
  /**
   * What sits here: an element symbol ("Fe"), or for a place shared by several elements their
   * symbols joined in file order ("Fe/Mg"). Bond rules and styles refer to atoms by this.
   */
  readonly species: string;
  /** The elements at this place with their occupancies (one entry for an ordinary site). */
  readonly components: readonly Component[];
  /** Total occupancy of the place (below 1 when it is partly vacant). */
  readonly occupancy: number;
  /** Fractional coordinates wrapped into [0, 1). */
  readonly frac: Vec3;
  /** Magnetic moment of this atom in Bohr magnetons, as components along the unit vectors of a, b, c. */
  readonly moment?: Vec3;
  /** Displacement from the parent structure, in fractional coordinates of the file's cell (see Site). */
  readonly displacement?: Vec3;
}
