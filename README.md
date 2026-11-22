# MOTIF

Clean vector figures of crystal structures, made in the browser from a CIF or mCIF file.

In crystallography the *motif* is the group of atoms repeated at every lattice point.

- Runs entirely in the browser. The file you drop on the page never leaves your machine.
- The figure is a vector drawing (shaded spheres, bonds, unit cell), not a 3D-rendered scene.
  Drag to rotate; the drawing updates.
- Export SVG (editable in Keynote or Illustrator) and PNG at a chosen width or scale,
  with an optional transparent background. The PNG is rendered from the same SVG.

## Run it

```
npm install
npm run dev      # the page, at the local address it prints
npm test         # the checks, a few seconds
npm run build    # a static site in dist/
```

Built with TypeScript, Vite and React. The CIF reader and symmetry code are MOTIF's own
(adapted from the author's MATERIA) and are checked against gemmi: `scripts/gemmi_reference.py`
writes the reference atom lists in `tests/reference/`.

## Conventions

- Cartesian axes: *a* along x, *b* in the xy plane, *c*\* along z (as in gemmi and the PDB).
- The view is a proper rotation, never a reflection, so a structure is never drawn mirrored.
  Screen x is right, y is up, z is towards the viewer; the projection is orthographic.
- The symmetry operations are taken from the file and checked to form a complete group.
  A file that gives only a space-group symbol is refused, not guessed.
- What is shown is a range of fractional coordinates along *a*, *b*, *c*. By default an atom on the
  boundary of the range is drawn at both ends (a cell looks complete); the other setting draws each
  atom once per cell. An atom within 0.001 of a limit counts as on it.
- Sites of the file that put different elements at the same place (within 0.05 Å) are one atom,
  a *shared site*, named by its elements ("Fe/Mg") until the user renames it. It is drawn as a pie
  sphere: wedges clockwise from the top in file order, each spanning 360° × its occupancy. A partly
  vacant place gets a pale wedge for the vacant share (this can be switched off).
- Bonds: a rule names two elements and a longest distance. A rule may also add the neighbours just
  outside the range, so that every centre atom shown has all its neighbours. A bond is drawn from
  surface to surface.
- The unit-cell outline is drawn for every whole cell inside the range (none for a slab).
- The structure is fitted to the canvas in each view. While dragging, the placement of the moment
  the drag began is kept, and the figure is refitted on release.
- Legend and axes share a band under the structure. The axis arrows are the directions of the cell
  edges *a*, *b*, *c*; an arrow tilted out of the screen is drawn shorter, and one seen end on gets
  no letter. Lettering: Avenir Next / Avenir (macOS), else Helvetica Neue, Arial. Text stays live
  text in the SVG; on a system without Avenir the letters look different, the drawing does not.
- Magnetic CIF: the magnetic group is every product of an operation and a centring translation,
  each with its time reversal; the list is checked to be a group with consistent signs. Moments are
  read as components along the unit vectors of *a*, *b*, *c* in Bohr magnetons (the `crystalaxis`
  form, the only one read). A moment is carried to a symmetry-equivalent atom as an axial vector,
  odd under time reversal: m' = (time reversal) × det(R) × R m. If two operations bring different
  moments to the same atom, the page says that the moment is not allowed by the site symmetry.
  Modulated (incommensurate) structures are refused.
- Arrow length is proportional to the moment; the largest moment in the file gets the chosen length.
- Highlights belong to a bond rule. Its bonds form connected groups (chains, nets), numbered by
  the position of their middle along *a*, then *b*, then *c*, so the numbering does not depend on
  the view. A band is a wide translucent stroke behind one group or all of them; with one group
  chosen, the rule's other atoms and bonds are drawn pale. "Fill triangles" fills every three
  mutually bonded atoms (a kagome net). Each rule has its own bond colour and thickness.
- A species can be hidden: its atoms, its bonds and any neighbours added for it are left out.
- The view can be set by the cell axis that points up, a turn about it and a tilt.
- Arrows (the user's rule, for step 6 and later): a magnetic moment is drawn as an arrow passing
  through its atom, centred on it. An atomic displacement (a distortion mode, not yet a planned
  step) is drawn as an arrow starting at the centre of its atom.
- Symmetry images of one site closer than 0.05 Å are one atom (a site on a symmetry element).

## Steps of the first version

| # | Step | Status |
|---|------|--------|
| 1 | Read a CIF and draw the atoms; rotate; export SVG and PNG | done |
| 2 | Choose what is shown: how many cells, or a slab | done |
| 3 | Bonds by distance for chosen element pairs; the unit cell | done |
| 4 | Colour and size per element; pie spheres for mixed sites | done |
| 5 | Legend and axis triad | built |
| 6 | mCIF: magnetic moments as arrows | built |
| 7 | Highlights: a band along a chain, filled polygons | built |
| 8 | Interface pass: bring the page in line with MATERIA's look, and improve on it | after the main features |

Each step is checked against an independent reference before the next one starts.

Examples and screenshots in this repository use published structures only.
