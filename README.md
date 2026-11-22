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

Built with TypeScript, Vite and React; the page's font (IBM Plex Sans, OFL licence) is part of the
build, so the page makes no request to any other site. The CIF reader and symmetry code are MOTIF's own
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
- Zoom and move act on the structure inside its space; the legend and axes stay put, and a zoomed
  structure is cut off at the legend band. Zoom: Ctrl/⌘ + wheel, pinch, + and − keys, or the
  buttons; move: Shift + drag, middle-button drag, arrow keys; fit again: double-click, 0, or
  "Fit"; "Box" then a drag zooms to a rectangle (Esc cancels). A plain wheel scrolls the page.
  A switch says whether Save writes the zoomed view (the default; the user's answer of 2026-11-22,
  relayed by the hub) or the whole structure.
- Moving a large structure (1,200 drawn atoms and bonds or more; the number can be changed under
  View, and the preview switched off): while the view is changing, a
  drawing made by the graphics card (WebGL 2 in a worker, `src/preview`) stands in for the
  structure; the vector figure is drawn again about 0.2 s after the movement stops. The preview is
  given the same scene and places every atom with the same formula as the SVG (tested), and shades
  spheres the same way, pie spheres included, but it is simpler: arrows as bars, a plain cell, bonds
  with square ends, and no bands, filled triangles, angle marks or labels. Where two atoms overlap
  the preview shows the true intersection of the spheres, the SVG the nearer atom whole. It is never what is
  saved: Save always writes the vector figure. Small structures are simply redrawn as SVG, and so is
  everything in a browser that cannot draw in a worker (the page says so). `scripts/browser_check.cjs`
  checks in a real browser that the saved SVG is identical with the preview on, off and showing,
  that the two pictures of one view agree, and that the page works without worker drawing. The
  page shows the figure as two layers (structure; legend and axes) made by the same code as the
  saved figure. Measured on an Apple M5 Pro in Chromium, per frame while dragging, without and
  with the preview: 729 atoms 17 ms / 8 ms; 4,913 atoms 167 ms / 8 ms; 19,683 atoms 667 ms / 16 ms.
- Legend and axes share a band under the structure. The axis arrows are the directions of the cell
  edges *a*, *b*, *c*; an arrow tilted out of the screen is drawn shorter, and one seen end on gets
  no letter. Lettering: Avenir, then Avenir Next (macOS), else Helvetica Neue, Arial; the weight can be chosen (regular by default, the user's choice). The font can be chosen
  from a list or typed by name; it must be a font of the computer (the PNG is drawn from the SVG
  alone, which cannot use a font loaded by the page), and the page says when it is missing. Text stays live
  text in the SVG; on a system without Avenir the letters look different, the drawing does not.
- Magnetic CIF (reading approved by the user, 2026-11-22): the magnetic group is every product of an operation and a centring translation,
  each with its time reversal; the list is checked to be a group with consistent signs. Moments are
  read as components along the unit vectors of *a*, *b*, *c* in Bohr magnetons (the `crystalaxis`
  form, the only one read). A moment is carried to a symmetry-equivalent atom as an axial vector,
  odd under time reversal: m' = (time reversal) × det(R) × R m. If two operations bring different
  moments to the same atom, the page says that the moment is not allowed by the site symmetry.
  Modulated (incommensurate) structures are refused.
- A moment arrow is a thin round rod through the atom with a cone at its tip, shaded like the
  spheres. The half that points away from the viewer is drawn before the sphere, which cuts it
  with its own outline; the half that points towards the viewer is drawn after, from the small
  circle where it pierces the surface (an ellipse when seen at an angle), with a soft shadow.
- Arrow length is proportional to the moment; the largest moment in the file gets the chosen length.
- Highlights belong to a bond rule. Its bonds form connected groups (chains, nets), numbered by
  the position of their middle along *a*, then *b*, then *c*, so the numbering does not depend on
  the view. A band is a wide translucent stroke behind one group or all of them; with one group
  chosen, the rule's other atoms and bonds are drawn pale. "Fill triangles" fills every three
  mutually bonded atoms (a kagome net). Each rule has its own bond colour and thickness.
- A bond angle is the angle between two drawn bonds that meet at an atom. An angle rule names
  the atom at the apex and the two at the ends, and a range in degrees; every such angle in the
  range is marked with a translucent sector lying in the plane of the two bonds, between the
  surface of the apex atom and a chosen radius, and (optionally) its size to 0.1°. A straight
  angle (180°) has no plane and is not drawn.
- Each angle rule shows the distribution of its angle among the drawn bonds; pointing at a bar
  previews those angles in the figure, a click or a drag across bars keeps them marked.
- A bond rule can leave out neighbours it bonds to nothing, and (for bonds within one species)
  everything that is not part of a complete triangle. The wedge order of a shared site can be set.
- Moment directions are checked against pymatgen (`scripts/pymatgen_moments.py`), including the
  arrow's size and its projection on each cell edge, on hexagonal test structures with
  time-reversed operations (`tests/fixtures`).
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
| 5 | Legend and axis triad | built, awaiting the user's check |
| 6 | mCIF: magnetic moments as arrows | built, awaiting the user's check |
| 7 | Highlights: a band along a chain, filled polygons | built, awaiting the user's check |
| 8 | Interface pass: bring the page in line with MATERIA's look, and improve on it | first pass built, awaiting the user's check |
| 9 | Bond angles: a translucent sector between two bonds, with the angle written beside it | built, awaiting the user's check |

Each step is checked against an independent reference before the next one starts.

Examples and screenshots in this repository use published structures only.

## Licence

Copyright (C) 2026 Tsung-Han Yang.

MOTIF is free software under the GNU Affero General Public License, version 3 or later
(AGPL-3.0-or-later); the full text is in `LICENSE`. The licence covers the program, not the figures
made with it.

Parts of the CIF reader and the symmetry code are adapted from MATERIA, by the same author; those
files say so in their header. The page's font, IBM Plex Sans, is under the SIL Open Font License 1.1.
The example structures marked COD are from the Crystallography Open Database (public domain).
