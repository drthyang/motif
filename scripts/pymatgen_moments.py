# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-Han Yang

"""Write tests/reference/moments_pymatgen.json: the magnetic moment of every atom of the unit cell,
computed by pymatgen (an independent program) from the magnetic CIFs in tests/fixtures and the
hand-written MnF2 example.

For each magnetic atom: its fractional position, its moment as components along the unit vectors
of a, b, c, the size of the moment, and its projection on each of the three cell-edge directions.
The last two do not depend on how a program places the crystal in cartesian space, so they check
the direction of the arrow in real space, not only the three numbers.

Needs pymatgen (not a dependency of MOTIF):  python -m venv v && v/bin/pip install pymatgen
Run from the repo root:  v/bin/python scripts/pymatgen_moments.py
"""
import glob, json, os, warnings
import numpy as np
from pymatgen.io.cif import CifParser
from pymatgen.electronic_structure.core import Magmom

warnings.filterwarnings("ignore")
out = {}
for path in sorted(glob.glob("tests/fixtures/*.mcif")) + ["examples/MnF2-antiferromagnet_handwritten.mcif"]:
    st = CifParser(path).parse_structures(primitive=False)[0]
    axes = [v / np.linalg.norm(v) for v in st.lattice.matrix]
    atoms = []
    for site in st:
        m = site.properties.get("magmom")
        if m is None:
            continue
        m = m if isinstance(m, Magmom) else Magmom(m)
        vec = np.array(m.global_moment, float)
        if np.linalg.norm(vec) < 1e-9:
            continue
        atoms.append({
            "frac": [float(x) % 1.0 for x in site.frac_coords],
            "moment": [float(x) for x in m.get_moment_relative_to_crystal_axes(st.lattice)],
            "size": float(np.linalg.norm(vec)),
            "along": [float(np.dot(vec, a)) for a in axes],
        })
    out[path] = atoms
    print(path, len(atoms), "magnetic atoms")
json.dump(out, open("tests/reference/moments_pymatgen.json", "w"), indent=1)
