/** Bond angles: for two bonds that meet at an atom, the angle between them, and which of them to mark in the figure. */
import type { Bond, PlacedAtom } from "./bonds";

/** Marks every angle end-centre-end, between two drawn bonds, whose size lies in a range. */
export interface AngleRule {
  /** Species at the apex of the angle. */
  readonly centre: string;
  /** Species at the two ends (in either order). */
  readonly ends: readonly [string, string];
  /** Range of angles marked, in degrees (both limits included). */
  readonly min: number;
  readonly max: number;
  /** Look of the mark: colour "#rrggbb", opacity 0 to 1, radius of the sector in angstrom. */
  readonly colour?: string;
  readonly opacity?: number;
  readonly radius?: number;
  /** Write the angle in degrees beside the mark. */
  readonly label?: boolean;
}

export const DEFAULT_ANGLE_LOOK = { colour: "#f08c1e", opacity: 0.45, radius: 0.9, label: true } as const;

/** One angle between two bonds meeting at `apex`. Indices into the atom list. */
export interface BondAngle {
  readonly apex: number;
  readonly a: number;
  readonly b: number;
  /** In degrees, 0 to 180. */
  readonly degrees: number;
}

/** The angle a-apex-b in degrees, from positions in angstrom. */
export function angleDegrees(apex: readonly number[], a: readonly number[], b: readonly number[]): number {
  const u = [a[0]! - apex[0]!, a[1]! - apex[1]!, a[2]! - apex[2]!];
  const v = [b[0]! - apex[0]!, b[1]! - apex[1]!, b[2]! - apex[2]!];
  const cos = (u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!) / (Math.hypot(u[0]!, u[1]!, u[2]!) * Math.hypot(v[0]!, v[1]!, v[2]!));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Every pair of drawn bonds that share an atom, with the angle between them. */
export function bondAngles(atoms: readonly PlacedAtom[], bonds: readonly Bond[]): BondAngle[] {
  const neighbours = new Map<number, number[]>();
  const link = (p: number, q: number): void => {
    const list = neighbours.get(p);
    if (list) {
      if (!list.includes(q)) list.push(q);
    } else neighbours.set(p, [q]);
  };
  for (const b of bonds) {
    link(b.i, b.j);
    link(b.j, b.i);
  }
  const out: BondAngle[] = [];
  for (const [apex, list] of neighbours) {
    for (let p = 0; p < list.length; p++) {
      for (let q = p + 1; q < list.length; q++) {
        out.push({ apex, a: list[p]!, b: list[q]!, degrees: angleDegrees(atoms[apex]!.cart, atoms[list[p]!]!.cart, atoms[list[q]!]!.cart) });
      }
    }
  }
  return out;
}

const sameEnds = (ends: readonly [string, string], p: string, q: string): boolean => (ends[0] === p && ends[1] === q) || (ends[0] === q && ends[1] === p);

/** The angles a rule marks. */
export function anglesOfRule(atoms: readonly PlacedAtom[], all: readonly BondAngle[], rule: AngleRule): BondAngle[] {
  return all.filter(
    (t) => atoms[t.apex]!.species === rule.centre && sameEnds(rule.ends, atoms[t.a]!.species, atoms[t.b]!.species) && t.degrees >= rule.min - 1e-9 && t.degrees <= rule.max + 1e-9,
  );
}

/** A kind of angle present among the drawn bonds (for example O-Si-O), with the sizes found, for the user to choose from. */
export interface AngleKind {
  readonly centre: string;
  readonly ends: readonly [string, string];
  readonly count: number;
  /** The distinct sizes, to 0.1 degree, smallest first. */
  readonly sizes: readonly number[];
}

export function angleKinds(atoms: readonly PlacedAtom[], all: readonly BondAngle[]): AngleKind[] {
  const kinds = new Map<string, { centre: string; ends: [string, string]; count: number; sizes: Set<number> }>();
  for (const t of all) {
    const ends = [atoms[t.a]!.species, atoms[t.b]!.species].sort() as [string, string];
    const centre = atoms[t.apex]!.species;
    const key = `${ends[0]}|${centre}|${ends[1]}`;
    const kind = kinds.get(key) ?? { centre, ends, count: 0, sizes: new Set<number>() };
    kind.count++;
    kind.sizes.add(Math.round(t.degrees * 10) / 10);
    kinds.set(key, kind);
  }
  return [...kinds.values()].map((k) => ({ centre: k.centre, ends: k.ends, count: k.count, sizes: [...k.sizes].sort((p, q) => p - q) }));
}
