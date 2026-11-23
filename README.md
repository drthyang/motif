# MOTIF

Crystal structure visualizer.

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
build, so the page makes no request to any other site. The page loads it under a private name, so that
it does not count as installed when it is chosen for the figure. The CIF reader and symmetry code are MOTIF's own
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
- Bonds are drawn as round rods (surface: soft, flat, glossy, metal or glass; a thin outline can
  be switched on, off by default at the user's choice), in two halves that meet in the middle. A half that points at the viewer comes out of
  its atom's face with a rounded foot; a half that points away is cut by the atom's outline.
  Above 1,500 bonds they are plain strokes, which draw much faster.
- Bonds: a rule names two elements and a longest distance. A rule may also add the neighbours just
  outside the range, so that every centre atom shown has all its neighbours. A bond is drawn from
  surface to surface.
- The unit-cell outline is drawn for every whole cell inside the range (none for a slab).
- The structure is fitted to the canvas in each view. While dragging, the placement of the moment
  the drag began is kept, and the figure is refitted on release.
- The figure's canvas is 1440 px wide and takes the shape of its frame on the page, so the figure
  uses the whole frame and nothing is cut off at an unseen edge inside it (the user's choice,
  2026-11-22). Or it has a size on paper, width and height in cm or in (the user's choice,
  2026-11-23): the drawing is then 1440 units wide with that shape, the SVG states the size
  (`width="8.5cm"`), so a drawing program places it at exactly that size, and the PNG is that size at
  a chosen dpi (300 by default), with the dpi written in the file. The page shows the whole canvas,
  as large as the frame allows. A shape can be chosen in either case (1:1, 5:4, 4:3, 3:2, √2:1, 16:10,
  16:9, 2:1, landscape or portrait); with a size on paper the height then follows the width and the
  width the height.
- Text sizes (legend names, axis letters, angle labels) can each be given in pt, and are then exact
  in the saved figure, whatever the legend or axes size and the paper size. Left empty, a text size
  follows the legend or axes size as before. Without a size on paper, 1 px of the figure counts as
  1 pt (as Keynote and Illustrator place an SVG). Zoom and move act on the structure; the legend and axes stay put and are drawn
  over a structure that reaches them. Zoom: Ctrl/⌘ + wheel, pinch, + and − keys, or the
  buttons; move: Shift + drag, middle-button drag, arrow keys; fit again: double-click, 0, or
  "Fit"; "Box" then a drag zooms to a rectangle (Esc cancels). A plain wheel scrolls the page.
  One quiet line under the figure names the main controls (Drag turn, ⌥ roll, ⇧ move, ⌘ zoom,
  Double-click fit; Alt and Ctrl off a Mac), with the details in each one's tooltip; the one in use,
  or whose key is held, is lit. The "?" hides the line.
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
  from a list (macOS fonts, and free ones from Google Fonts, IBM Plex and DejaVu; those not installed
  are marked) or typed by name; it must be a font of the computer (the PNG is drawn from the SVG
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
  circle where it pierces the surface (an ellipse when seen at an angle).
- The thickness of the arrows' rod can be set; the cone at the tip keeps its proportion to it,
  and its size can be set separately as a multiple of that proportion (also for the axis arrows).
- The moment arrows, and the axis arrows, each have a thin darker outline, which can be switched off
  (on by default, the user's choice).
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
- Surfaces: the atoms, and separately the arrows (moment arrows and axis arrows together), can be
  drawn soft (the default), flat, glossy, metal or glass. These are vector shading only (gradient
  stops, a highlight spot, opacity), so the figure stays an editable SVG; a glass sphere shows
  what is behind it, and a slider sets how solid the glass is (one setting for all glass; 75 % by default). The GPU preview shown while a large structure moves does not draw
  the surfaces.
- When a file is opened MOTIF suggests bonds (`src/scene/autoBonds.ts`; can be switched off): each
  kind of cation to its nearest anions, or a single element to itself, first shell only, with the
  neighbours outside the range added. A pair that would give an atom more than eight bonds is
  left out, and a structure with no anions and several elements gets none. The page says which
  bonds it added. This is a drawing aid, not a statement about bonding.
- The unit cell is drawn with the edges in front of the middle of the structure solid and those
  behind it paler and dashed, so the box reads as a solid; all dashed or all solid can be chosen,
  and the line width set.
- The page: a view toolbar over the figure and four tabs (the user's layout, 2026-11-23):
  Info (what the file says), Structure (what is drawn: the cells shown, which elements, bonds,
  angles, whether moments are shown), Visual (how it looks: presets, surfaces and outlines, colours
  and sizes of atoms, bonds, angle marks and moment arrows, the unit-cell lines, legend, axes,
  lettering) and Layout (canvas size and shape, view direction, scale, saved views, dragging, large
  structures). A bond or angle rule is set up under Structure and styled under Visual. The style
  presets (Slide, Paper, Glossy, Metal, Glass) set surfaces, outlines, lettering weight and legend
  sizes together.
- A species can be hidden: its atoms, its bonds and any neighbours added for it are left out.
- A file opens with c up, a towards the viewer on the left and b to the right, seen a little from
  above (turn -120, tilt 15): all three axes read well and none is a stub (the user's choice).
- The view (`src/render/camera.ts`; plan from the camera research of 2026-11-22, approved by the
  user). The renderer takes a rotation matrix; for people the view is four numbers read from it,
  so they are always true: the cell axis that is up, turn about it (positive brings the front to
  the right), tilt (positive looks from above, -90 to 90) and roll about the line of sight
  (anticlockwise, applied last). They are shown under the figure as one line that can be copied
  and pasted back, with the nearest low-index direction and how far off the view is.
  - Drag: turntable by default (left-right turns about the up axis, up-down tilts and stops at
    +-90, the up axis stays upright; a circle of the mouse does not roll the figure); Alt + drag
    rolls; a free mode remains.
  - "Look along [u v w]" or "normal to (h k l)": the direction points at the viewer. Up is the
    given direction's part perpendicular to the line of sight; by default c, or b when looking
    along c. Buttons for a, b, c, a*, b*, c*, "other side" and "turn 90".
  - Releasing a drag within 4 degrees of a direction with indices up to 2 snaps onto it by the
    smallest turn (can be switched off).
  - Saved views are the four numbers, kept in the browser, so a view means the same axes in
    another structure; a switch keeps the view when another file is loaded.
  - Scale: fitted to each view (default), steady at every angle, or a fixed number of px per A.
  - A change of view by a click is shown as a short turn on screen (can be switched off; skipped
    when the system asks for reduced motion). It is never part of the saved figure.
- An axis arrow that points mostly into or out of the page is drawn at least 0.45 of the full
  length, in its true direction on screen, so that it stays readable (as in the user's slide
  figures); this can be switched off, and every arrow is then the exact projection.
- The size of the legend and the size of the axis arrows (length, thickness, head and letters
  together) can each be set as a multiple of the usual size.
- The legend can follow the size of the structure: its largest sphere as large as that atom is
  drawn, letters in proportion (within limits), so it scales with the zoom.
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
| 10 | Camera: view as numbers, turntable drag, crystal directions, snapping, saved views, steady scale, animated turn | built, awaiting the user's check |
| 8 | Interface pass: bring the page in line with MATERIA's look, and improve on it | second pass built (tabs, toolbar over the figure, example buttons), awaiting the user's check |
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
