# Example structures

Every file here is a published structure, or written or generated for MOTIF from one. COD files come from the
Crystallography Open Database (COD, https://www.crystallography.net/cod/), which places its data in the public
domain; each keeps its COD header with the original reference.

## Feature examples

These five are the only examples the app offers: as five numbered cards (01 to 05) on the start page, and in
the Examples menu. Each is a file below plus the settings that show its feature, given in `features.json`. The
settings apply only when the example is opened from the start page or the menu; opening the same file by hand
gives the plain defaults.

| Example | File | What is set |
|---------|------|-------------|
| Atomic structure | `quartz_COD-9009666.cif` | nothing: quartz with the bonds MOTIF suggests (Si–O) |
| Magnetic structure | `MnF2-antiferromagnet_handwritten.mcif` | nothing: MnF2 with its moments along +*c* and −*c* |
| Distortion mode | `SrTiO3-octahedral-rotation_COD-2310687.cif` | one TiO2 layer, 2 × 2 cells (cells 0 to 2 along *a* and *b*, −0.01 to 0.01 along *c*), seen down *c*: the octahedra turned about *c* by the mode R4+ |
| Orbital order | `LaMnO3-orbital-order_COD-1006141.cif` | one MnO2 layer, 2 × 2 cells (cells 0 to 2 along *a* and *b*, −0.06 to 0.06 along *c*), seen down *c*, bonds not completed outside the slab; dz² on each Mn along its own longest Mn–O bond (size 1.9 Å), pz on each O along the line through its two Mn (size 0.9 Å, green and gold) |
| RMC configuration | `SrTiO3-supercell_generated.rmc6f` | the 6 × 6 × 6 configuration, opened folded into one averaged cell |

Only one TiO2 layer is shown in the distortion-mode example: seen down *c*, the layers at *z* = 0 and *z* = 1/2,
whose octahedra turn in opposite senses, would lie on top of each other.

The format of `features.json` is in [docs/CONVENTIONS.md](../docs/CONVENTIONS.md#feature-examples).

## All files

The files not used by a feature example are not listed in the app; they are kept because the tests use them,
and can still be opened with **Open file…**.

| File | Structure | Source |
|------|-----------|--------|
| `silicon_COD-9008565.cif` | silicon, diamond structure | COD 9008565 |
| `halite-NaCl_COD-9008678.cif` | rock salt | COD 9008678 |
| `perovskite-SrTiO3_COD-9006864.cif` | cubic perovskite (tausonite) | COD 9006864 |
| `quartz_COD-9009666.cif` | quartz, hexagonal axes | COD 9009666 |
| `CoSn-type-kagome_handwritten.cif` | CoSn structure type, a kagome net of Co; written by hand for MOTIF from the textbook description (illustrative cell lengths) | none |
| `MnF2-antiferromagnet_handwritten.mcif` | MnF2, moments along ±*c*; written by hand for MOTIF from the textbook description (illustrative numbers) | none |
| `olivine-FeMg_COD-1541262.cif` | olivine with two sites shared by Fe and Mg | COD 1541262 |
| `LaMnO3-orbital-order_COD-1006141.cif` | LaMnO3, orthorhombic Pbnm, 298 K (Rodríguez-Carvajal et al. 1998), unchanged from the COD | COD 1006141 |
| `SrTiO3-octahedral-rotation_COD-2310687.cif` | SrTiO3, tetragonal I4/mcm, as the mode R4+ of the cubic perovskite: ISODISTORT's mode decomposition (see below) | COD 2310687 |
| `BaTiO3-ferroelectric-distortion_COD-2100858.cif` | BaTiO3, tetragonal P4mm, as the polar mode GM4- of the cubic perovskite: ISODISTORT's mode decomposition of COD 2100858 against the cubic cell of 2100862 (Buttner & Maslen 1992) | COD 2100858 |
| `SrTiO3-supercell_generated.rmc6f` | an illustrative RMCProfile configuration of cubic SrTiO3, made for MOTIF (see below) | generated from COD 9006864 |

## The distortion-mode example

`SrTiO3-octahedral-rotation_COD-2310687.cif` is SrTiO3 below 105 K (I4/mcm) written as a distortion of the cubic
perovskite. Its header gives all of this.

- Distorted structure: K. Tsuda & M. Tanaka, Acta Cryst. A 51, 7–19 (1995), doi:10.1107/S010876739400560X;
  COD 2310687 (I4/mcm, *a* = 5.511 Å, *c* = 7.796 Å, O2 at *x* = 0.2451).
- Parent: COD 9006864 (cubic, *a* = 3.90528 Å); only its cell and sites are used.
- Mode decomposition: ISODISTORT 6.12.2, method 4, basis (1,1,0), (−1,1,0), (0,0,2), automatic origin. The COD
  file's charged type symbols (Sr+2, Ti+4, O-2) were written Sr, Ti, O so that ISODISTORT could match the atoms
  with the parent; nothing else was changed, and ISODISTORT's output follows unchanged.
- One displacive mode, R4+(a,0,0)[O:d:dsp]Eu, amplitude −0.07654 and norm 0.06402, so O2_dx = −0.00490, the
  published shift. Each O2 moves 0.0049 × √2 × 5.5229 Å = 0.0383 Å in the *ab* plane, at right angles to its
  Ti–O bond, so the octahedra turn by about 1.1° about *c*, in opposite senses in the *z* = 0 and *z* = 1/2
  layers. Sr, Ti and O1 do not move. The file's two strain modes (GM1+ and GM3+) are not drawn.

Checked in `tests/distortion.test.ts`: the mode amplitude; Sr, Ti and O1 at rest; each O2 moved 0.0383 Å, flat
in the *ab* plane; the turn about a Ti at *z* = 1/2 exactly opposite to that at *z* = 0. The symmetry expansion
is checked against a gemmi reference (20 atoms, `tests/reference/`). The shift, its length and the angle were
also worked by hand (2026-11-23): 0.07654 × 0.06402 = 0.00490; atan(0.0383 / 1.9526) = 1.12°, with 1.9526 Å half the Ti–Ti distance.

BaTiO3 (`BaTiO3-ferroelectric-distortion_COD-2100858.cif`) is no longer a feature example; it stays here
because `tests/distortion.test.ts` uses it.

## The orbital-order example

`LaMnO3-orbital-order_COD-1006141.cif` is COD 1006141, unchanged: J. Rodríguez-Carvajal et al., Phys. Rev. B 57,
R3189 (1998), doi:10.1103/PhysRevB.57.R3189; Pbnm, 298 K. What it shows was chosen by the user (2026-11-23):
each atom's orbital along its own bonds, and O 2p along each Mn–O–Mn line.

- Each Mn carries dz² with its *z* along its longest Mn–O bond (the orbital rule's "longest bond to O").
- Each O carries pz with its *z* along the line through its two Mn ("line through two").
- One MnO2 layer is shown, seen down *c*; bond rules do not add atoms outside the slab (`completeBonds: false`).

Checked against a hand calculation from the published sites (`tests/orbitals.test.ts`): the Mn–O bonds are
1.906, 1.968 (apical) and 2.180 Å. The long bond about Mn (1/2, 0, 0) is ±(1.249, 1.762, 0.295) Å and about
Mn (0, 1/2, 0) is ±(1.249, −1.762, −0.295) Å, so it alternates in the *ab* plane; its tilt of 0.295 Å out of the
plane is opposite in the *z* = 0 and *z* = 1/2 layers. The p axis of the apical O1 is along *c*, that of O2 lies in
the *ab* plane. The symmetry expansion is checked against a gemmi reference (20 atoms, `tests/reference/`). The
bond lengths and vectors were also recomputed by hand on 2026-11-23 from the file's cell, sites and operations.

The cubic SrTiO3 file (COD 9006864) is no longer an orbital example; it stays because other tests and the
generated RMC configuration use it.

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
