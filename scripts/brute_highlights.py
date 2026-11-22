"""Write tests/reference/highlights.json: bonds, triangles and connected groups counted by brute force.

Independent of MOTIF's code: gemmi gives the atoms of one cell; atoms in the range are placed by
trying every lattice translation; every pair is tested for a bond, every triple for a triangle,
and the groups are found by flood fill.
Run from the repo root:  python3 scripts/brute_highlights.py
"""
import itertools, json, math
import gemmi

TOL = 1e-3
CASES = [
    ("CoSn-type-kagome_handwritten.cif", [0, 0, 0], [2, 2, 0], "Co", 2.7),
    ("CoSn-type-kagome_handwritten.cif", [0, 0, 0], [3, 2, 1], "Co", 2.7),
    ("halite-NaCl_COD-9008678.cif", [0, 0, 0], [1, 1, 1], "Na", 4.0),
    ("silicon_COD-9008565.cif", [0, 0, 0], [2, 1, 1], "Si", 2.5),
    ("MnF2-antiferromagnet_handwritten.mcif", [0, 0, 0], [1, 1, 3], "Mn", 3.4),
]
out = []
for name, lo, hi, element, dmax in CASES:
    st = gemmi.make_small_structure_from_block(gemmi.cif.read_file(f"examples/{name}").sole_block())
    if name.endswith(".mcif"):
        # gemmi does not read magnetic operations; the two Mn of this cell are written out by hand.
        cell_atoms = [(0, 0, 0), (0.5, 0.5, 0.5)]
    else:
        cell_atoms = [tuple(s.fract.wrap_to_unit().tolist()) for s in st.get_all_unit_cell_sites() if s.element.name == element]
    pts = []
    for f in cell_atoms:
        for n in itertools.product(range(-1, 5), repeat=3):
            x = [f[i] + n[i] for i in range(3)]
            if all(lo[i] - TOL <= x[i] <= hi[i] + TOL for i in range(3)):
                p = st.cell.orthogonalize(gemmi.Fractional(*x))
                pts.append((p.x, p.y, p.z))
    n = len(pts)
    bonded = [[0.1 < math.dist(pts[i], pts[j]) <= dmax for j in range(n)] for i in range(n)]
    bonds = sum(bonded[i][j] for i in range(n) for j in range(i + 1, n))
    tris = sum(1 for i, j, k in itertools.combinations(range(n), 3) if bonded[i][j] and bonded[j][k] and bonded[i][k])
    seen, groups = set(), []
    for start in range(n):
        if start in seen or not any(bonded[start]):
            continue
        stack, size = [start], 0
        seen.add(start)
        while stack:
            v = stack.pop(); size += 1
            for w in range(n):
                if bonded[v][w] and w not in seen:
                    seen.add(w); stack.append(w)
        groups.append(size)
    out.append({"example": name, "from": lo, "to": hi, "element": element, "max": dmax, "atoms": n, "bonds": bonds, "triangles": tris, "groups": sorted(groups)})
    print(out[-1])
json.dump(out, open("tests/reference/highlights.json", "w"), indent=1)
