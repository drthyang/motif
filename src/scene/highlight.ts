/** Chains and triangles in the bonds of one rule: what the highlight band and the filled polygons are made from. */
import type { Bond, PlacedAtom } from "./bonds";

/**
 * The connected groups of atoms joined by the bonds of one rule (a chain, a net, a cluster),
 * each as a list of atom indices. Ordered by the position of their middle along a, then b, then c,
 * so that "chain 2" means the same chain however the figure is turned.
 */
export function connectedGroups(atoms: readonly PlacedAtom[], bonds: readonly Bond[]): number[][] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  for (const b of bonds) {
    for (const x of [b.i, b.j]) if (!parent.has(x)) parent.set(x, x);
    parent.set(find(b.i), find(b.j));
  }
  const groups = new Map<number, number[]>();
  for (const x of parent.keys()) {
    const root = find(x);
    const list = groups.get(root);
    if (list) list.push(x);
    else groups.set(root, [x]);
  }
  const middle = (group: number[]): number[] => [0, 1, 2].map((i) => Math.round((group.reduce((sum, x) => sum + atoms[x]!.frac[i]!, 0) / group.length) * 1e4));
  return [...groups.values()]
    .map((g) => g.sort((p, q) => p - q))
    .sort((p, q) => {
      const [mp, mq] = [middle(p), middle(q)];
      return mp[0]! - mq[0]! || mp[1]! - mq[1]! || mp[2]! - mq[2]! || p[0]! - q[0]!;
    });
}

/** Every set of three atoms that are all bonded to one another, as index triples i < j < k. */
export function triangles(bonds: readonly Bond[]): [number, number, number][] {
  const neighbours = new Map<number, Set<number>>();
  const link = (p: number, q: number): void => {
    const set = neighbours.get(p);
    if (set) set.add(q);
    else neighbours.set(p, new Set([q]));
  };
  for (const b of bonds) {
    link(b.i, b.j);
    link(b.j, b.i);
  }
  const out: [number, number, number][] = [];
  for (const b of bonds) {
    const [i, j] = b.i < b.j ? [b.i, b.j] : [b.j, b.i];
    for (const k of neighbours.get(i)!) if (k > j && neighbours.get(j)!.has(k)) out.push([i, j, k]);
  }
  return out;
}
