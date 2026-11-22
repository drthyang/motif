"""Write tests/reference/ranges.json: the atoms inside several fractional ranges of each example.

Independent of MOTIF's code: gemmi gives the atoms of one cell; every lattice translation
in a wide block is then tried and tested against the range, one atom at a time.
Run from the repo root:  python3 scripts/gemmi_ranges.py
"""
import glob, itertools, json, os
import gemmi

TOL = 1e-3  # the same boundary tolerance MOTIF documents
CASES = [
    {"from": [0, 0, 0], "to": [1, 1, 1], "boundary": "both"},
    {"from": [0, 0, 0], "to": [1, 1, 1], "boundary": "once"},
    {"from": [0, 0, 0], "to": [2, 1, 1], "boundary": "once"},
    {"from": [-0.5, 0, 0.2], "to": [1.5, 1, 0.7], "boundary": "both"},
    {"from": [0, -1, 0.25], "to": [3, 0.5, 0.25], "boundary": "both"},
]

out = {}
for path in sorted(glob.glob("examples/*.cif")):
    st = gemmi.make_small_structure_from_block(gemmi.cif.read_file(path).sole_block())
    results = []
    for case in CASES:
        atoms = []
        for s in st.get_all_unit_cell_sites():
            f = s.fract.wrap_to_unit()
            for shift in itertools.product(range(-4, 6), repeat=3):
                x = [f.x + shift[0], f.y + shift[1], f.z + shift[2]]
                if case["boundary"] == "both":
                    ok = all(case["from"][i] - TOL <= x[i] <= case["to"][i] + TOL for i in range(3))
                else:
                    ok = all(case["from"][i] - TOL <= x[i] < case["to"][i] - TOL for i in range(3))
                if ok:
                    p = st.cell.orthogonalize(gemmi.Fractional(*x))
                    atoms.append({"element": s.element.name, "frac": x, "cart": [p.x, p.y, p.z]})
        results.append({**case, "atoms": atoms})
        print(os.path.basename(path), case, len(atoms))
    out[os.path.splitext(os.path.basename(path))[0]] = results
with open("tests/reference/ranges.json", "w") as fh:
    json.dump(out, fh)
