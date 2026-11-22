# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-Han Yang

"""Write tests/reference/angles.json: the distinct bond angles in three examples, to 0.1 degree.

Independent of MOTIF's code: gemmi gives the atoms of one cell; for every atom of the centre
element, its neighbours of the end element within the bond distance are found over all lattice
translations, and every pair of them gives one angle.
Run from the repo root:  python3 scripts/gemmi_angles.py
"""
import itertools, json, math
import gemmi

CASES = [
    ("quartz_COD-9009666.cif", "Si", "O", 1.8),   # O-Si-O, the tetrahedron
    ("quartz_COD-9009666.cif", "O", "Si", 1.8),   # Si-O-Si, the bridge
    ("olivine-FeMg_COD-1541262.cif", "Si", "O", 1.8),
    ("silicon_COD-9008565.cif", "Si", "Si", 2.5),
    ("CoSn-type-kagome_handwritten.cif", "Co", "Co", 2.7),
]
out = []
for name, centre, end, dmax in CASES:
    st = gemmi.make_small_structure_from_block(gemmi.cif.read_file(f"examples/{name}").sole_block())
    sites = [(s.element.name, s.fract.wrap_to_unit()) for s in st.get_all_unit_cell_sites()]
    sizes, per_centre = set(), set()
    for el, f in sites:
        if el != centre:
            continue
        c = st.cell.orthogonalize(f)
        near = []
        for el2, g in sites:
            if el2 != end:
                continue
            for n in itertools.product(range(-2, 3), repeat=3):
                p = st.cell.orthogonalize(gemmi.Fractional(g.x + n[0], g.y + n[1], g.z + n[2]))
                d = c.dist(p)
                if 0.1 < d <= dmax:
                    near.append(p)
        per_centre.add(len(near) * (len(near) - 1) // 2)
        for p, q in itertools.combinations(near, 2):
            u = [p.x - c.x, p.y - c.y, p.z - c.z]; v = [q.x - c.x, q.y - c.y, q.z - c.z]
            cos = sum(a * b for a, b in zip(u, v)) / (math.hypot(*u) * math.hypot(*v))
            sizes.add(round(math.degrees(math.acos(max(-1, min(1, cos)))), 1))
    out.append({"example": name, "centre": centre, "end": end, "max": dmax, "sizes": sorted(sizes), "anglesPerCentre": sorted(per_centre)})
    print(out[-1])
json.dump(out, open("tests/reference/angles.json", "w"), indent=1)
