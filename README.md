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
- Symmetry images of one site closer than 0.05 Å are one atom (a site on a symmetry element).

## Steps of the first version

| # | Step | Status |
|---|------|--------|
| 1 | Read a CIF and draw the atoms; rotate; export SVG and PNG | done |
| 2 | Choose what is shown: how many cells, or a slab | built, awaiting the user's check |
| 3 | Bonds by distance for chosen element pairs; the unit cell | not started |
| 4 | Colour and size per element; pie spheres for mixed sites | not started |
| 5 | Legend and axis triad | not started |
| 6 | mCIF: magnetic moments as arrows | not started |
| 7 | Highlights: a band along a chain, filled polygons | not started |
| 8 | Interface pass: bring the page in line with MATERIA's look, and improve on it | after the main features |

Each step is checked against an independent reference before the next one starts.

Examples and screenshots in this repository use published structures only.
