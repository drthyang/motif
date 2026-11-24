# Example structures

Every file here is a published structure, or written or generated for MOTIF from one. COD files come from the
Crystallography Open Database (COD, https://www.crystallography.net/cod/), which places its data in the public
domain; each keeps its COD header with the original reference.

## Feature examples

The app lists these first: as buttons on the start page, and in the Examples menu under "Features". Each is a
file below plus the settings that show its feature, given in `features.json`. The settings apply only when the
example is opened from that list; opening the same file by hand gives the plain defaults.

| Example | File | What is set |
|---------|------|-------------|
| Atomic structure | `quartz_COD-9009666.cif` | nothing: quartz with the bonds MOTIF suggests (Si–O) |
| Magnetic structure | `MnF2-antiferromagnet_handwritten.mcif` | nothing: MnF2 with its moments along +*c* and −*c* |
| Orbitals | `perovskite-SrTiO3_COD-9006864.cif` | one TiO6 octahedron (cells −0.5 to 0.5 along *a*, *b*, *c*), Sr hidden, the two e_g orbitals of Ti (dz², dx²−y²), pointing at the O atoms, size 2.4 Å (the farthest point of the surface from the nucleus) |
| RMC configuration, folded | `SrTiO3-supercell_generated.rmc6f` | the 6 × 6 × 6 configuration folded into one averaged cell |

The format of `features.json` is in [docs/CONVENTIONS.md](../docs/CONVENTIONS.md#feature-examples).

## All files

| File | Structure | Source |
|------|-----------|--------|
| `silicon_COD-9008565.cif` | silicon, diamond structure | COD 9008565 |
| `halite-NaCl_COD-9008678.cif` | rock salt | COD 9008678 |
| `perovskite-SrTiO3_COD-9006864.cif` | cubic perovskite (tausonite) | COD 9006864 |
| `quartz_COD-9009666.cif` | quartz, hexagonal axes | COD 9009666 |
| `CoSn-type-kagome_handwritten.cif` | CoSn structure type, a kagome net of Co; written by hand for MOTIF from the textbook description (illustrative cell lengths) | none |
| `MnF2-antiferromagnet_handwritten.mcif` | MnF2, moments along ±*c*; written by hand for MOTIF from the textbook description (illustrative numbers) | none |
| `olivine-FeMg_COD-1541262.cif` | olivine with two sites shared by Fe and Mg | COD 1541262 |
| `BaTiO3-ferroelectric-distortion_COD-2100858.cif` | BaTiO3, tetragonal P4mm, as the polar mode GM4- of the cubic perovskite: ISODISTORT's mode decomposition of COD 2100858 against the cubic cell of 2100862 (Buttner & Maslen 1992) | COD 2100858 |
| `SrTiO3-supercell_generated.rmc6f` | an illustrative RMCProfile configuration of cubic SrTiO3, made for MOTIF (see below) | generated from COD 9006864 |

## The generated RMC configuration

`SrTiO3-supercell_generated.rmc6f` is made for MOTIF to show folding. It is **not a fit to any data**.

- Cell and sites: cubic SrTiO3, COD 9006864 (Mitchell, Chakhmouradian & Woodward 2000), *a* = 3.90528 Å.
- Supercell: 6 × 6 × 6 cells, 1080 atoms (216 Sr, 216 Ti, 648 O), with site numbers and cell indices.
- Each atom is moved from its site by a random displacement, Gaussian with a standard deviation of 0.08 Å
  along each Cartesian axis, from the fixed seed 20261123, so the file is the same every time it is made.
- Made by `python3 scripts/make_rmc_example.py`, run from the repository.

Checked: folded, the file gives the five sites of cubic SrTiO3, each averaged to within 0.02 Å of the
published site (`tests/features.test.ts`). An independent plain average in Python (2026-11-23) gave offsets of
0.005 to 0.018 Å and spreads (rms along each axis) of 0.079 to 0.082 Å, as expected for 216 copies of a site
displaced by 0.08 Å.
