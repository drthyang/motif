"""Write tests/reference/<example>.json: the atoms of one unit cell of each example, computed by gemmi.

An independent check of MOTIF's own CIF reader, symmetry expansion and cartesian axes.
Run from the repo root with a Python that has gemmi:  python3 scripts/gemmi_reference.py
"""
import glob, json, os
import gemmi

for path in sorted(glob.glob("examples/*.cif")):
    st = gemmi.make_small_structure_from_block(gemmi.cif.read_file(path).sole_block())
    cell = st.cell
    atoms = []
    for s in st.get_all_unit_cell_sites():
        f = s.fract.wrap_to_unit()
        p = cell.orthogonalize(f)
        atoms.append({"element": s.element.name, "label": s.label, "occ": s.occ, "frac": [f.x, f.y, f.z], "cart": [p.x, p.y, p.z]})
    out = {
        "gemmi": gemmi.__version__,
        "cell": [cell.a, cell.b, cell.c, cell.alpha, cell.beta, cell.gamma],
        "atoms": atoms,
    }
    name = os.path.splitext(os.path.basename(path))[0]
    with open(f"tests/reference/{name}.json", "w") as fh:
        json.dump(out, fh, indent=1)
    print(name, len(atoms), "atoms")
