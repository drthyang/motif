# MOTIF

Clean vector figures of crystal structures, made in the browser from a CIF or mCIF file.

In crystallography the *motif* is the group of atoms repeated at every lattice point.

- Runs entirely in the browser. The file you drop on the page never leaves your machine.
- The figure is a vector drawing (shaded spheres, bonds, unit cell), not a 3D-rendered scene.
  Drag to rotate; the drawing updates.
- Export SVG (editable in Keynote or Illustrator) and PNG at a chosen width or scale,
  with an optional transparent background. The PNG is rendered from the same SVG.

Status: set-up only. No code yet; the stack is being agreed.

## Steps of the first version

| # | Step | Status |
|---|------|--------|
| 1 | Read a CIF and draw the atoms; rotate; export SVG and PNG | not started |
| 2 | Choose what is shown: how many cells, or a slab | not started |
| 3 | Bonds by distance for chosen element pairs; the unit cell | not started |
| 4 | Colour and size per element; pie spheres for mixed sites | not started |
| 5 | Legend and axis triad | not started |
| 6 | mCIF: magnetic moments as arrows | not started |
| 7 | Highlights: a band along a chain, filled polygons | not started |

Each step is checked against an independent reference before the next one starts.

Examples and screenshots in this repository use published structures only.
