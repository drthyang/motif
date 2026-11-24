# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tsung-Han Yang
"""
Writes examples/SrTiO3-supercell_generated.rmc6f: an illustrative RMCProfile configuration made for MOTIF.

It is not a fit to any data. The cell and sites are those of cubic SrTiO3 (COD 9006864, Mitchell,
Chakhmouradian & Woodward 2000, a = 3.90528 A); the supercell is 6 x 6 x 6 cells (1080 atoms); every atom is moved
from its site by a random displacement, Gaussian with the same standard deviation SIGMA (angstrom) along each
cartesian axis, from a fixed seed, so the file is the same every time it is made. Folded back into one cell,
each site's average lies within a few thousandths of an angstrom of the published site.

Run from the repository: python3 scripts/make_rmc_example.py
"""
import random

A = 3.90528  # angstrom, COD 9006864
N = 6  # cells along each axis
SIGMA = 0.08  # angstrom, illustrative
SEED = 20261123
SITES = [  # element, site number, fractional position in one cell
    ("Sr", 1, (0.5, 0.5, 0.5)),
    ("Ti", 2, (0.0, 0.0, 0.0)),
    ("O", 3, (0.5, 0.0, 0.0)),
    ("O", 4, (0.0, 0.5, 0.0)),
    ("O", 5, (0.0, 0.0, 0.5)),
]
OUT = "examples/SrTiO3-supercell_generated.rmc6f"


def main() -> None:
    rng = random.Random(SEED)
    lines = []
    n = 0
    for i in range(N):
        for j in range(N):
            for k in range(N):
                for element, site, (x, y, z) in SITES:
                    n += 1
                    # Fractional coordinates in the supercell, each displaced by SIGMA / (N A) in fraction.
                    f = [(c + cell + rng.gauss(0.0, SIGMA) / A) / N for c, cell in ((x, i), (y, j), (z, k))]
                    f = [v % 1.0 for v in f]
                    lines.append(f"{n:6d}   {element:2s} [{site}]  {f[0]:.6f}  {f[1]:.6f}  {f[2]:.6f}   {site} {i} {j} {k}")
    size = A * N
    header = [
        "(Version 6f format configuration file)",
        "Metadata title:      SrTiO3, illustrative configuration made for MOTIF (not a fit to data)",
        "Metadata comment:    cubic SrTiO3 (COD 9006864), 6x6x6 supercell, Gaussian displacements of 0.08 A, seed 20261123",
        "Number of types of atoms:   3",
        "Atom types present:         Sr Ti O",
        "Number of each atom type:   216 216 648",
        f"Number of atoms:            {n}",
        f"Supercell dimensions:       {N} {N} {N}",
        f"Cell (Ang/deg):    {size:.5f} {size:.5f} {size:.5f} 90.00000 90.00000 90.00000",
        "Lattice vectors (Ang):",
        f"   {size:.5f}   0.00000   0.00000",
        f"   0.00000   {size:.5f}   0.00000",
        f"   0.00000   0.00000   {size:.5f}",
        "Atoms:",
    ]
    with open(OUT, "w") as out:
        out.write("\n".join(header + lines) + "\n")
    print(f"wrote {OUT}: {n} atoms")


if __name__ == "__main__":
    main()
