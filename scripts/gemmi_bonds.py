# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-Han Yang

"""Write tests/reference/bonds.json: bonds by distance, found by trying every pair of atoms.

Independent of MOTIF's code: gemmi gives the atoms of one cell; atoms are placed by brute force
over a wide block of cells, and every pair is tested. With "complete", neighbour atoms outside the
range but within the distance of a centre atom inside it are added first.
Run from the repo root:  python3 scripts/gemmi_bonds.py
"""
import itertools, json, math
import gemmi

TOL = 1e-3
CASES = [
    ("halite-NaCl_COD-9008678", [0, 0, 0], [1, 1, 1], "Na", "Cl", 3.0, False),
    ("halite-NaCl_COD-9008678", [0, 0, 0], [1, 1, 1], "Na", "Cl", 3.0, True),
    ("silicon_COD-9008565", [0, 0, 0], [1, 1, 1], "Si", "Si", 2.5, False),
    ("silicon_COD-9008565", [0, 0, 0], [1, 1, 1], "Si", "Si", 2.5, True),
    ("perovskite-SrTiO3_COD-9006864", [0, 0, 0], [1, 1, 1], "Ti", "O", 2.1, False),
    ("perovskite-SrTiO3_COD-9006864", [0, 0, 0], [1, 1, 1], "Ti", "O", 2.1, True),
    ("perovskite-SrTiO3_COD-9006864", [0, 0, 0], [2, 1, 1], "Sr", "O", 2.9, True),
    ("quartz_COD-9009666", [0, 0, 0], [1, 1, 1], "Si", "O", 1.8, False),
    ("quartz_COD-9009666", [0, 0, 0], [1, 1, 1], "Si", "O", 1.8, True),
    ("quartz_COD-9009666", [-0.3, 0, 0.2], [1.6, 2, 0.7], "O", "Si", 1.8, True),
]

def block(st, element, lo, hi):
    """Atoms of one element with lo <= frac <= hi (with the tolerance), as (frac, cart)."""
    out = []
    for s in st.get_all_unit_cell_sites():
        if s.element.name != element:
            continue
        f = s.fract.wrap_to_unit()
        for n in itertools.product(range(-4, 7), repeat=3):
            x = (f.x + n[0], f.y + n[1], f.z + n[2])
            if all(lo[i] - TOL <= x[i] <= hi[i] + TOL for i in range(3)):
                p = st.cell.orthogonalize(gemmi.Fractional(*x))
                out.append((x, (p.x, p.y, p.z)))
    return out

results = []
for name, lo, hi, centre, neighbour, dmax, complete in CASES:
    st = gemmi.make_small_structure_from_block(gemmi.cif.read_file(f"examples/{name}.cif").sole_block())
    centres = block(st, centre, lo, hi)
    inside = block(st, neighbour, lo, hi)
    everywhere = block(st, neighbour, [-3, -3, -3], [5, 5, 5])
    bonds = {}
    added = set()
    for cf, cc in centres:
        for nf, nc in (everywhere if complete else inside):
            d = math.dist(cc, nc)
            if 0.1 < d <= dmax:
                is_inside = all(lo[i] - TOL <= nf[i] <= hi[i] + TOL for i in range(3))
                if not is_inside:
                    added.add(tuple(round(v, 4) for v in nc))
                mid = tuple(round((cc[i] + nc[i]) / 2, 4) for i in range(3))
                bonds[mid] = round(d, 6)  # a pair found from both ends (same element) has one midpoint
    results.append({
        "example": name, "from": lo, "to": hi, "centre": centre, "neighbour": neighbour, "max": dmax, "complete": complete,
        "bonds": [[*mid, d] for mid, d in sorted(bonds.items())], "added": len(added),
    })
    print(name, centre, neighbour, dmax, complete, "bonds", len(bonds), "added atoms", len(added))
json.dump(results, open("tests/reference/bonds.json", "w"))
