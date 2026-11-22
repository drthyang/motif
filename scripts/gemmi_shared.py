# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-Han Yang

"""Write tests/reference/shared.json: for the olivine example, every distinct place in the unit cell
and what gemmi says sits there (elements and occupancies). Independent check of how MOTIF merges
the sites of a file that share one place.
Run from the repo root:  python3 scripts/gemmi_shared.py
"""
import json
import gemmi

name = "olivine-FeMg_COD-1541262"
st = gemmi.make_small_structure_from_block(gemmi.cif.read_file(f"examples/{name}.cif").sole_block())
places = {}
for s in st.get_all_unit_cell_sites():
    f = s.fract.wrap_to_unit()
    p = st.cell.orthogonalize(f)
    key = tuple(round(v, 3) for v in (p.x, p.y, p.z))
    places.setdefault(key, {"cart": [p.x, p.y, p.z], "components": {}})["components"][s.element.name] = s.occ
json.dump({"example": name, "places": list(places.values())}, open("tests/reference/shared.json", "w"), indent=1)
print(len(places), "places")
