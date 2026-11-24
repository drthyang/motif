# MOTIF conventions

Every convention MOTIF follows, what was decided and when, and how each part is checked. For the app itself,
see the [README](../README.md).

- [Axes and handedness](#axes-and-handedness)
- [Reading files](#reading-files): CIF and symmetry, magnetic CIF, distortion modes, RMCProfile configurations
- [What is drawn](#what-is-drawn): range, bonds, highlights, bond angles, orbitals
- [How it looks](#how-it-looks): surfaces, bonds, unit cell, arrows, legend and axes, lettering
- [Figure size, text and saving](#figure-size-text-and-saving)
- [View and camera](#view-and-camera)
- [The page](#the-page): tabs, saved settings, feature examples, large structures
- [How each part is checked](#how-each-part-is-checked)
- [Steps of the first version](#steps-of-the-first-version)
- [Building and testing](#building-and-testing)

## Axes and handedness

- Cartesian axes: *a* along x, *b* in the xy plane, *c*\* along z (as in gemmi and the PDB).
- The view is a proper rotation, never a reflection, so a structure is never drawn mirrored.
  Screen x is right, y is up, z is towards the viewer; the projection is orthographic.

## Reading files

### CIF and symmetry

- The symmetry operations are taken from the file and checked to form a complete group.
  A file that gives only a space-group symbol is refused, not guessed.
- Symmetry images of one site closer than 0.05 Å are one atom (a site on a symmetry element).
- Sites of the file that put different elements at the same place (within 0.05 Å) are one atom,
  a *shared site*, named by its elements ("Fe/Mg") until the user renames it. It is drawn as a pie
  sphere: wedges clockwise from the top in file order, each spanning 360° × its occupancy. A partly
  vacant place gets a pale wedge for the vacant share (this can be switched off). The wedge order of a
  shared site can be set.

### Magnetic CIF

- Reading approved by the user (2026-11-22). The magnetic group is every product of an operation and a
  centring translation, each with its time reversal; the list is checked to be a group with consistent signs.
- Moments are read as components along the unit vectors of *a*, *b*, *c* in Bohr magnetons (the `crystalaxis`
  form, the only one read).
- A moment is carried to a symmetry-equivalent atom as an axial vector, odd under time reversal:
  m' = (time reversal) × det(R) × R m. If two operations bring different moments to the same atom, the page
  says that the moment is not allowed by the site symmetry.
- Modulated (incommensurate) structures are refused.
- Checked against pymatgen (`scripts/pymatgen_moments.py`): moment directions, including the arrow's size and
  its projection on each cell edge, on hexagonal test structures with time-reversed operations
  (`tests/fixtures`).

### Distortion modes (ISODISTORT CIFs)

- Reading approved by the user (2026-11-23). An ISODISTORT CIF (iso.byu.edu) is read as the distorted
  structure it lists, plus its displacive modes.
- Each site's displacement from the parent is the sum over the modes switched on of matrix x amplitude x norm
  (fractional units, checked against the file's own `_iso_deltacoordinate_value`), added to the coordinates its
  `_iso_coordinate_formula` names, made angstrom with the undistorted supercell (the parent cell in the file's
  basis), and carried to equivalent atoms as a polar vector, d' = R d.
- The largest displacement gets the chosen arrow length (1.5 A from the atom's centre unless changed).
- Displacement arrows are styled apart from moment arrows, so the two never look alike: green, a thicker rod
  (0.26 A) and a smaller cone (0.6 of the usual proportion), each changeable (the user's choice, 2026-11-23).
- Strain, magnetic, rotational and occupancy modes are not drawn; the page says when a file has them.
- A site with no free coordinate (its `_atom_site_fract_symmform` is 0,0,0) stays where it is (2026-11-23).
  ISODISTORT still writes such a site a coordinate formula naming a shift it never lists (for example
  "1/2 + Sr1_dx"). Formulas on every other site are read strictly.
- Checked by hand against the published BaTiO3 coordinates (`tests/distortion.test.ts`), and against the
  published octahedral turn of SrTiO3 I4/mcm (COD 2310687): each O2 moves 0.0383 Å in the *ab* plane, Sr, Ti
  and O1 stay, and the turns of neighbouring layers are opposite.

### RMCProfile configurations (.rmc6f)

- Read as P1: the identity is the only operation and every atom of the supercell is its own site.
- Fractional coordinates are along the file's lattice vectors; the cell is rebuilt from their lengths and
  angles (the file's "Cell" line, which must agree with them), so the crystal is the same, turned rigidly
  into MOTIF's axes.
- Left-handed lattice vectors are refused (they would be drawn mirrored), and so is a file with an unreadable
  atom line, a non-finite coordinate or a wrong atom count, rather than drawn with atoms missing.
- Vacancies (`Va`) are left out and counted.
- The atom-line grammar is adapted from the author's RMCProfile Workbench.

**Folding into one cell**, as RMCProfile Workbench does. An RMC configuration opens as its whole supercell (the
user's choice, 2026-11-23); a quick switch over the figure, "RMC: Supercell | Fold", shown only for an RMC
configuration, reads it again folded or whole (also in the Structure tab):

- Each atom is moved into one cell (supercell fraction x N, its fractional part).
- The copies of a site are grouped by the file's site numbers (the crystallographic site of the unit cell;
  by distance, 0.5 A, in a file without them).
- The site is drawn at the plain average of its copies (the user's choice, 2026-11-23). Each copy's position
  in its own cell is (supercell fraction x N) minus its unit-cell indices, so a copy just below a corner
  reads -0.002, not 0.998; a copy whose cell lies across the supercell's boundary is taken back by one
  supercell length.
- A file without cell indices is averaged as RMCProfile Workbench does (circular mean as a centre, plus the
  mean offset of the copies from it); on a real configuration the two agree to 1e-14.
- Each element's share of the copies is its occupancy (vacancies count), so a site shared by two elements is
  a pie sphere.
- The Info tab gives the largest rms spread of a site's copies.
- In a folded cell an atom within 0.01 of a limit of the range counts as on it (0.001 elsewhere), so a site
  averaged to 0.9988 is drawn at both edges, at its measured position (the user's choice, 2026-11-23).

### Other formats (2026-11-23)

`src/structure/readStructure.ts` chooses the reader by the file's name (and, where names are shared, its
content); the format's short name shows over the figure at the left. Each reader is checked in
`tests/formats.test.ts`: quartz and halite are written in the format from the CIF's unit cell (gemmi-checked),
with the lattice turned to an arbitrary orientation where the format is Cartesian, read back and compared atom
by atom with the CIF.

- **VASP** POSCAR, CONTCAR, `.vasp`: one scale factor (negative: the volume) or three; VASP 5 species names
  (POTCAR names such as `Fe_pv` read as Fe); a VASP 4 file only when its comment line names the elements;
  Selective dynamics; Direct or Cartesian.
- **XYZ** and **extended XYZ**: `Lattice="..."` gives the cell and `Properties=` the columns; without a lattice
  the atoms are a molecule. The first frame only.
- **SHELX** `.res`, `.ins`: CELL, LATT (centring; positive adds the inversion), SYMM, SFAC, FVAR; a coordinate
  or sof written as 10 + v is v; sof 10m + p is p fv(m), -(10m + p) is p (1 - fv(m)); Q peaks and everything
  after HKLF or END left out. The operations are generated from SYMM, the inversion and the centring, and must
  close into a group.
- **PDB** `.pdb`, `.ent`: CRYST1 and ATOM/HETATM (first model). A PDB file names its space group only by symbol and
  MOTIF builds symmetry only from listed operations, so only P 1 is drawn as a crystal; any other file is drawn as
  the model it lists, and the page says the space group was not applied.
- **Quantum ESPRESSO** pw.x input: ibrav = 0 only (other ibrav values use QE's own lattice formulas and are
  refused), CELL_PARAMETERS and ATOMIC_POSITIONS in alat, bohr, angstrom or crystal, ATOMIC_SPECIES for elements.
- **CASTEP** `.cell`: LATTICE_CART or LATTICE_ABC; POSITIONS_FRAC or POSITIONS_ABS (ang, bohr or nm).
- **FHI-aims** `geometry.in`: lattice_vector, atom, atom_frac; no lattice vectors: a molecule.
- **XSF**: CRYSTAL with PRIMVEC and PRIMCOORD; ATOMS for a molecule; animated files refused.
- Common to all: lattice vectors become lengths and angles in MOTIF's axes (the same crystal turned rigidly);
  a left-handed set is refused (it would be drawn mirrored); elements are symbols or atomic numbers, and
  anything else is refused rather than guessed (`Ox` is not oxygen). 1 bohr = 0.529177210903 Å.
- **A molecule** (atoms with no cell) sits in an orthogonal box 10 Å larger on every side than its atoms, so
  its copies in neighbouring boxes are too far away to bond; the unit-cell outline is switched off for it.
  The automatic bonds are made for crystals (cation to anion), so in a molecule some bonds (C–H, for example)
  must be added by hand.

## What is drawn

### Range of cells

- What is shown is a range of fractional coordinates along *a*, *b*, *c*. By default an atom on the
  boundary of the range is drawn at both ends (a cell looks complete); the other setting draws each
  atom once per cell. An atom within 0.001 of a limit counts as on it.
- The unit-cell outline is drawn for every whole cell inside the range (none for a slab).
- A species can be hidden: its atoms, its bonds and any neighbours added for it are left out.
- A range may hold up to 100,000 atoms (the user's limit). Grouping bonds into chains is near linear
  (union-find), so a supercell of that size with its bonds is built in well under a second.

### Bonds

- A *bond rule* names two elements and a longest distance. A rule may also add the neighbours just
  outside the range, so that every centre atom shown has all its neighbours. A bond is drawn from
  surface to surface.
- A bond rule can leave out neighbours it bonds to nothing, and (for bonds within one species)
  everything that is not part of a complete triangle.
- When a file is opened MOTIF suggests bonds (`src/scene/autoBonds.ts`; can be switched off): each
  kind of cation to its nearest anions, or a single element to itself, first shell only, with the
  neighbours outside the range added. A pair that would give an atom more than eight bonds is
  left out, and a structure with no anions and several elements gets none. The page says which
  bonds it added. This is a drawing aid, not a statement about bonding.

### Highlights: chains and filled triangles

- Highlights belong to a bond rule. Its bonds form connected groups (chains, nets), numbered by
  the position of their middle along *a*, then *b*, then *c*, so the numbering does not depend on
  the view.
- A *band* is a wide translucent stroke behind one group or all of them; with one group chosen, the rule's
  other atoms and bonds are drawn pale.
- "Fill triangles" fills every three mutually bonded atoms (a kagome net). The fill is cut to the gap its
  atoms and bonds leave: each side runs half a bond width inside its bond and each corner follows the atom's
  outline, so it meets them at any angle and covers none of them (it reaches 0.4 px under them, where it is
  hidden, so no hairline shows).
- Filled bond triangles take the pale tint of their atoms unless a colour is chosen for them.
- Each rule has its own bond colour and thickness.

### Coordination polyhedra (2026-11-24)

The user's choices, 2026-11-24 (commit e016d7f):

- **From a bond rule.** "Polyhedra round X" on a bond rule draws, round each centre atom inside the range, the
  convex hull of the neighbours the rule bonds it to (TiO6 octahedra, SiO4 tetrahedra). Faces in one plane are
  merged into one face (corners within 0.01 Å of a face's plane lie in it), so a cube has 6 square faces.
  Neighbours all in one plane give a flat polygon; fewer than three, or all on a line, give nothing
  (`src/scene/polyhedra.ts`).
- **Corners are complete.** The neighbours outside the range are always added, as "complete" does; while
  polyhedra are on, that checkbox shows checked and cannot be changed.
- **Looks.** Glass by default; Solid and Line art can be chosen.
  - Glass: see-through faces (55 % solid by default, set with "faces % solid") shaded by the light, every edge
    drawn, the centre atom inside.
  - Solid: opaque shaded front faces with their edges; the centre atom is hidden.
  - Line art: white front faces, visible edges in ink, hidden edges thin and dashed; the centre atom is hidden.
- **Colour.** The centre atom's colour, or one chosen (↺ resets it). A shared site (Fe/Mg in olivine) takes its
  elements' colours mixed by occupancy.
- **Bonds inside.** The rule's own bonds inside the polyhedra are left out, unless "Also draw the X–Y bonds
  inside" is ticked.
- **Depth.** Each polyhedron is drawn as one unit at its centre's depth: back faces and edges, then the centre
  atom, the bonds inside and the pieces of cell edges inside, then the front faces and edges
  (`layoutPolyhedra` in `src/render/svg.ts`). A face is at the back when its outward normal points away from the
  viewer. Exact clipping where a polyhedron passes through atoms other than its own may come later.
- **Corner atoms cut exactly** (the user's request, 2026-11-24, commit acb71ee). A corner atom is drawn twice:
  whole, before every polyhedron it is a corner of, so their faces cover the part of it behind them; and again
  after all of them, cut to the part of its near surface in front of them. A point of that near surface is in
  front of a polyhedron when it lies outside the plane of one of the polyhedron's faces that turn to the viewer
  and meet at the corner, or when the line of sight misses the polyhedron (outside its outline on screen). Such a
  plane passes through the atom's centre, so it cuts the atom in a great circle, seen as a half-ellipse. This
  assumes the planes of faces away from the corner are farther from it than the atom's radius, which holds for
  real atoms and polyhedra. Until then a corner atom was drawn whole at its own depth, and the faces and edges
  of a polyhedron drawn after it ran across it to its centre.
- The rule's summary line counts them by shape ("18 octahedra"). The assistant can switch polyhedra on or off
  and set their look and colour (`change_bonds`); `describe_figure` gives each rule's polyhedra ("off" or the
  look).
- **Speed.** The RMC 6 × 6 × 6 supercell gives 251 octahedra: 71 ms for the scene and 56 ms for the SVG. The GPU
  preview leaves polyhedra out while the view moves, as it does filled triangles.
- **Checked** (`tests/polyhedra.test.ts`):
  - the hulls of an octahedron (8 faces, 12 edges, Euler's formula), a cube (6 square faces), a tetrahedron and
    a square (flat);
  - counts and corner distances against gemmi:
    - cubic SrTiO3 (COD 9006864), 2 × 2 × 1 cells: 18 octahedra, Ti–O = *a*/2 = 1.953 Å;
    - quartz, 2 × 2 × 1 cells: 20 tetrahedra, Si–O 1.607 and 1.611 Å;
    - olivine, one cell: 4 SiO4 and 19 (Fe,Mg)O6;
    - LaMnO3, one layer: 12 octahedra, Mn–O 1.906, 1.968 and 2.180 Å;
  - an octahedron seen down [111]: 4 back faces before the Ti, 4 front faces after; in line art 3 dashed edges
    and 9 solid;
  - the cut of corner atoms, by ray casting against the octahedron |*x*| + |*y*| + |*z*| ≤ *a*/2 of cubic SrTiO3 in
    the default view: at every sample point of all six O discs more than a pixel from the cut's edge (over 1000
    points, over 200 each in front and behind), the drawn cut agrees with whether the atom's surface is in front.

  The SrTiO3 numbers were also worked by hand (2026-11-24): Ti sits at the origin, so cells 0 to 2, 0 to 2, 0 to 1
  hold 3 × 3 × 2 = 18 Ti, and Ti–O = 3.90528 / 2 = 1.9526 Å. So was the LaMnO3 count: in the slab −0.06 to
  0.06 along *c* only the Mn at *z* = 0 lie, at (½, 0, 0) and (0, ½, 0) and their translations, which in cells
  0 to 2 along *a* and *b* number 2 × 3 + 3 × 2 = 12.

### Bond angles

- A bond angle is the angle between two drawn bonds that meet at an atom. An *angle rule* names
  the atom at the apex and the two at the ends, and a range in degrees; every such angle in the
  range is marked with a translucent sector lying in the plane of the two bonds, between the
  surface of the apex atom and a chosen radius, and (optionally) its size to 0.1°. A straight
  angle (180°) has no plane and is not drawn.
- Each angle rule shows the distribution of its angle among the drawn bonds; pointing at a bar
  previews those angles in the figure, a click or a drag across bars keeps them marked.

### Orbitals

Structure tab; the user's choices of 2026-11-23.

- **What is drawn.** s, p, d and the general f set (fz³, fxz², fyz², fxyz, fz(x²−y²), fx(x²−3y²), fy(3x²−y²))
  on the atoms of a chosen species, as a schematic: the isosurface |ψ| = isovalue × max|ψ| of a hydrogen-like
  ψ = R(r)·Y with R ∝ r^l e^(−r/n), n = l + 1 (1s, 2p, 3d, 4f), its farthest point at the chosen size, its
  lobes coloured by the sign of Y. A low isovalue gives full lobes, a high one slim lobes (the small ring of
  dz² vanishes above 0.5, where its |ψ| never reaches). Each surface is computed once per orbital and isovalue
  and shared by every atom and redraw.
- **Axes.** MOTIF's (x along a, y in the a–b plane, z along c*), or a local frame with z along [u v w] and x
  along a second direction.
- **Axes from each atom's bonds** (the orbital rule's "local z"; the user's choice, 2026-11-23, so that an
  orbital order shows). z is taken from the atom's own bonds to a chosen species, within its first shell (out
  to 1.25 times the nearest of that species): "longest bond to" puts z along the atom's longest such bond,
  "line through two" along the line through its two nearest atoms of that species (as for an O between two
  metals). Checked on LaMnO3 against a hand calculation from the published sites (`tests/orbitals.test.ts`;
  [examples/README.md](../examples/README.md#the-orbital-order-example)).
- **A lobe.** Each lobe is drawn as one smooth shape: its outline seen from the viewer (the convex hull of the
  projected points of its surface, resampled evenly and drawn as a smooth curve; a lobe is nearly convex, so
  only a slight dent is filled). An ordinary lobe is drawn running into the nucleus, as in the textbook
  picture (the isosurface of a p, d or f orbital stops short of it, its radial part being zero there).
- **A ring** (the band of dz², the cones of fz³) keeps its own shape, filled with a gradient as atoms are,
  see-through (60 % by default), at the depth of its centre. It is cut into 12 segments, shaded with one
  gradient for the whole ring, and drawn as one see-through layer (so its halves never lie over one another).
- **Orbitals and atoms cut through one another as solids** (2026-11-23). In the orthographic view a point of
  an orbital lies in front of an atom's visible surface exactly when, about that atom's centre, it is nearer
  the viewer and outside the atom's radius. A lobe (or a whole ring) is drawn once behind every atom within
  its reach that it overlaps on screen, and again after each such atom, clipped to the atom's disc and to the
  region where the lobe lies in front of the sphere. That region comes from the orbital as a solid, not from
  its mesh: along the line of sight through each point of a grid over the disc (one point per 4 units of the
  drawing, 8 to 24 each way) the largest |ψ| / level − 1 in front of the sphere is found (12 samples, then a
  golden-section refinement), and its zero contour is traced by marching squares and drawn as a smooth curve,
  so where a lobe meets an atom the edge is smooth. Atoms beyond an orbital's reach are ordered by depth as
  usual.
- **No orbitals while the view moves** (2026-11-24, commit 1cd3e18). While the view moves the page draws the
  structure without its orbitals: atoms, bonds and cell stay in their places (the same scene, the orbitals
  left out). The orbitals come back once the view is still, and are in every saved figure. Until then a draft
  was drawn while moving, with the edge found on a coarser grid; the renderer keeps that option (`draft`), but
  the page no longer uses it. Surfaces are kept once placed, and atoms of one rule share one outline moved to
  each atom (the view is orthographic), so a still view only projects them: on the 8 Ti atoms of the SrTiO₃
  example, dz² and dxy together took about 41 ms to draw in full (measured with the draft, 2026-11-23).
  Checked (`tests/orbitals.test.ts`): the scene drawn while moving has the same atoms, bonds and cell in the
  same places, and no orbitals.
- **Surfaces.** Soft, flat, glossy, or mesh (grid lines, drawn face by face, slower); colour schemes for the
  two lobes, or own colours.
- **Checked** (`tests/orbitals.test.ts`): the harmonics are mutually orthogonal over the sphere; the solid is
  zero on every point of the drawn surface away from a lobe's rim and positive just inside; a lobe inside its
  atom is never drawn over it, and one that reaches out is drawn over it only on the near side; marching
  squares returns a disc's rim.

## How it looks

### Surfaces

- The atoms, and separately the arrows (moment arrows and axis arrows together), can be drawn soft (the
  default), flat, glossy, metal or glass. These are vector shading only (gradient stops, a highlight spot,
  opacity), so the figure stays an editable SVG.
- A glass sphere shows what is behind it, and a slider sets how solid the glass is (one setting for all
  glass; 75 % by default).
- The GPU preview shown while a large structure moves does not draw the surfaces.

### Bonds

- Bonds are drawn as round rods (surface: soft, flat, glossy, metal or glass; a thin outline can be switched
  on, off by default at the user's choice), in two halves that meet in the middle. A half that points at the
  viewer comes out of its atom's face with a rounded foot; a half that points away is cut by the atom's
  outline. Above 1,500 bonds they are plain strokes, which draw much faster.
- Each bond rule can be drawn in one colour or in atom colours (each half in the colour of the atom it starts
  from), and as a solid, dashed or dotted line. Dashes are 2.5 rod widths long with gaps of 1.5, dots one rod
  width across and apart; the pattern fills the length between the two atoms' surfaces exactly and is the
  same seen from either end. With more than 1,500 bonds the plain strokes carry the same pattern.

### Unit cell

- The unit cell is drawn with the edges in front of the middle of the structure solid and those
  behind it paler and dashed, so the box reads as a solid; all dashed or all solid can be chosen,
  and the line width set.

### Arrows

- **The rule** (the user's, for step 6 and later): a magnetic moment is drawn as an arrow passing through its
  atom, centred on it. An atomic displacement (a distortion mode) is drawn as an arrow starting at the centre
  of its atom.
- A file's vectors (moments of an mCIF, displacements of an ISODISTORT file) can be drawn in either style,
  as moments (through the atom, centred) or as displacements (from the atom's centre, their own colour and
  thickness): Structure tab, Arrows (the user's choice, 2026-11-23). Each file starts in its own kind.
- A moment arrow is a thin round rod through the atom with a cone at its tip, shaded like the
  spheres. The half that points away from the viewer is drawn before the sphere, which cuts it
  with its own outline; the half that points towards the viewer is drawn after, from the small
  circle where it pierces the surface (an ellipse when seen at an angle).
- Arrow length is proportional to the moment; the largest moment in the file gets the chosen length.
- A moment arrow's tail side is 80 % of its head side by default (adjustable, 100 % = exactly centred): the
  cone narrows to a point, so an exactly centred arrow looks longer on its tail side. The head side always
  runs half the chosen length from the atom's centre (the user's choice, 2026-11-23).
- The thickness of the arrows' rod can be set; the cone at the tip keeps its proportion to it,
  and its size can be set separately as a multiple of that proportion (also for the axis arrows).
- The moment arrows, and the axis arrows, each have a thin darker outline, which can be switched off
  (on by default, the user's choice).

### Legend and axes

- Legend and axes share a band under the structure.
- The axis arrows are the directions of the cell edges *a*, *b*, *c*; an arrow tilted out of the screen is
  drawn shorter, and one seen end on gets no letter. By default *a*, *b*, *c* are a muted red, green and blue
  (arrow and letter alike); each colour can be changed, or all three drawn grey.
- An axis arrow that points mostly into or out of the page is drawn at least 0.45 of the full
  length, in its true direction on screen, so that it stays readable (as in the user's slide
  figures); this can be switched off, and every arrow is then the exact projection.
- The size of the legend and the size of the axis arrows (length, thickness, head and letters
  together) can each be set as a multiple of the usual size.
- The legend can follow the size of the structure: its largest sphere as large as that atom is
  drawn, letters in proportion (within limits), so it scales with the zoom. On by default (the user's choice,
  2026-11-23); off, the legend keeps its own size whatever the zoom.

### Lettering

- Open Sans by default, then Avenir, Avenir Next (macOS), Helvetica Neue, Arial; the weight can be chosen
  (regular by default, the user's choice).
- The font can be chosen from a list (macOS fonts, and free ones from Google Fonts, IBM Plex and DejaVu; those
  not installed are marked) or typed by name; it must be a font of the computer (the PNG is drawn from the SVG
  alone, which cannot use a font loaded by the page), and the page says when it is missing.
- Text stays live text in the SVG; on a system without Avenir the letters look different, the drawing does not.

## Figure size, text and saving

- **Default.** A figure opens at the size of a Nature single column, 89 mm wide, 4:3 (8.9 x 6.675 cm),
  lettered in Open Sans, with legend, axis letters and angle labels at 7 pt (Nature asks for 5 to 7 pt; the
  user's defaults, 2026-11-23).
- **Without a size on paper**, the figure's canvas is 1440 px wide and takes the shape of its frame on the
  page, so the figure uses the whole frame and nothing is cut off at an unseen edge inside it (the user's
  choice, 2026-11-22).
- **With a size on paper**, width and height in cm or in (the user's choice, 2026-11-23): the drawing is then
  1440 units wide with that shape, the SVG states the size (`width="8.5cm"`), so a drawing program places it
  at exactly that size, and the PNG is that size at a chosen dpi (300 by default), with the dpi written in
  the file.
- The page shows the whole canvas, as large as the frame allows.
- **Journal templates** (Layout tab, Canvas, "journal"; 2026-11-23). Choosing one sets the size on paper to
  the width the journal asks for, keeping the chosen shape, sets the legend, axis and angle text to the
  journal's size in pt, and shows the journal's limits. The choice is made in steps: publisher, journal, column
  (the user's wish); choosing a publisher or a journal takes its first column at once. Journals with the same
  widths and text are one template (the user's wish). Under "width" the figure takes the full width, 1/2, 1/3 or 1/4 of it (one panel in a row of
  two, three or four), rounded to 0.01 cm or in; the text keeps the journal's size. Values and their sources (each journal's own author
  pages, read 2026-11-23) are in the header of `src/ui/journals.ts`:

  | Journal | Widths | Text |
  |---------|--------|------|
  | Nature | 89 mm (single column), 120 mm (one and a half, of 120 to 136), 183 mm (double) | 7 pt (5 to 7 asked) |
  | Science | 5.7, 12.1, 18.4 cm (1, 2, 3 columns) | 7 pt (not smaller than 5) |
  | Physical Review | 8.5 cm (1 column), 17.8 cm (2 columns) | capitals and numerals 2 mm high |
  | ACS journals (JACS, Inorg. Chem., Chem. Mater.) | 3.33 in (single), 7 in (double) | 7 pt (at least 4.5) |
  | Nature Communications, Nature Materials, Nature Physics (one template) | 88 mm (single), 180 mm (double) | 7 pt (5 to 7 asked) |
  | RSC journals (Dalton Trans., CrystEngComm, J. Mater. Chem. A and C) | 8.3 cm (single), 17.1 cm (double) | 7 pt (no figure text size given) |
  | Elsevier journals (J. Solid State Chem., J. Alloys Compd.) | 90 mm (single), 140 mm (1.5), 190 mm (double) | 7 pt |
  | J. Phys.: Condens. Matter | 8.5 cm (single), 15 cm (double) | 8 pt (8 to 12 asked) |
  | American Mineralogist | 19 picas, 3.17 in (1 column); 39 picas, 6.5 in (2 columns) | 8 pt (at least 8) |
  | IUCr journals (Acta Cryst. B, C and E, IUCrJ, J. Appl. Cryst.) | 8.8 cm (1 column; no two-column width given) | capitals 2 mm high (1.5 to 3 mm asked) |

  Science gives two sets of widths; the user chose those of its "initial manuscript" page over the 3.5, 5.0
  and 7.3 in of another Science page. APS gives no number for two columns: 17.8 cm (7 in) is the REVTeX
  two-column page width; Physical Review B and Materials follow the general APS rules. The templates after
  the first four were added on 2026-11-23, each from the publisher's own page. For the IUCr journals that is the
  same text in every journal's Notes for authors (section 4.3, journals.iucr.org), read in the browser pane: the
  figure, lettering included, is narrower than one column (8.8 cm), with lettering "ideally 1.5–3 mm in height"
  after reduction to one column. Where a journal gives no text size, the
  template sets 7 pt: for Nature Communications the largest size of the Nature journals' guide, for RSC the size
  RSC gives for atom labels in chemical structures. The Elsevier template uses Elsevier's common artwork rules,
  as the journals' own guides could not be read; a journal may have rules beyond these. Not included, because
  their pages refuse automated access: Science Advances and Wiley's journals.
  For Physical Review and the IUCr journals the text size is 2 mm over the cap height of the chosen font
  (measured in the browser), rounded up to half a point: 8 pt in Open Sans. Checked in `tests/journals.test.ts`:
  the widths against the journals' numbers, and capitals at least 2 mm high whatever the font's cap height.
- **Shape.** A shape can be chosen in either case (1:1, 5:4, 4:3, 3:2, √2:1, 16:10, 16:9, 2:1, landscape or
  portrait); with a size on paper the height then follows the width and the width the height.
- **Text in pt.** Text sizes (legend names, axis letters, angle labels) can each be given in pt, and are then
  exact in the saved figure, whatever the legend or axes size and the paper size. Left empty, a text size
  follows the legend or axes size as before. Without a size on paper, 1 px of the figure counts as 1 pt (as
  Keynote and Illustrator place an SVG).
- When a text size is given in pt, the legend's spheres and gaps and the axis arrows follow it, keeping the
  proportions they were designed with (legend sphere radius 44 to letters 92; axis 140 to letters 76), and
  the band under the structure shrinks or grows with them; the size settings scale them relative to the text.
- **What Save writes.** A switch says whether Save writes the zoomed view (the default; the user's answer of
  2026-11-22, relayed by the hub) or the whole structure.

## View and camera

- **Opening view.** A file opens with c up, a towards the viewer on the left and b to the right, seen a little
  from above (turn -120, tilt 15): all three axes read well and none is a stub (the user's choice).
- **The view as numbers** (`src/render/camera.ts`; plan from the camera research of 2026-11-22, approved by
  the user). The renderer takes a rotation matrix; for people the view is four numbers read from it,
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
  - Preset views (the toolbar's "Views…" menu), each with c up and built from the cell's own axes:
    standard (the opening view), clinographic (the textbook crystal drawing: from in front of a,
    turned atan(1/3) = 18.43 degrees towards b and raised atan(1/6) = 9.46 degrees), isometric (along
    the sum of the unit vectors of a, b, c, so all three are equally foreshortened), along [110] and
    along [1-10].
  - A change of view by a click is shown as a short turn on screen (can be switched off; skipped
    when the system asks for reduced motion). It is never part of the saved figure.
- **Fitting.** The structure is fitted to the canvas in each view. While dragging, the placement of the moment
  the drag began is kept.
- **After a turn by dragging** (2026-11-23; the user disliked the size jumping when a drag ended), the figure
  keeps its scale, centred on the new outline, and shrinks only if it would not fit; a snap at the end of the
  drag keeps it too. Fit (double-click or the 0 key), Reset, a preset or typed view, opening a file, or
  changing the cells or the canvas fit it afresh.
- **Rulers** (2026-11-23; `src/ui/ruler.ts`, `tests/ruler.test.ts`). Along the top and left of the figure on the
  page, measuring the figure itself: in cm or in when it has a size on paper, else in px of the figure; the zoom
  does not change them. Ticks at least 5 screen px apart (mm and cm; eighths to whole inches; round px), labels
  on whole cm, whole inches or round px at least 34 px apart. The figure's size is written after the view line.
  On by default; Layout tab, Canvas, "Rulers beside the figure". A guide on the page only, never in a saved figure.
  With a size on paper, the unit where the rulers meet is a switch: the rulers and the size under the figure
  are then read in cm or in; the figure's own size and unit do not change.
- **Zoom and move** act on the structure; the legend and axes stay put and are drawn over a structure that
  reaches them. Zoom: Ctrl/⌘ + wheel, pinch, + and − keys, or the buttons; move: Shift + drag, middle-button
  drag, arrow keys; fit again: double-click, 0, or "Fit"; "Box" then a drag zooms to a rectangle (Esc
  cancels). A plain wheel scrolls the page.
- **Phones and tablets** (2026-11-23; `src/ui/touch.ts`, `tests/touch.test.ts`). One finger turns, as a drag
  does. Two fingers do three things at once, as in a map app: spreading them zooms about their middle, moving
  them moves the structure, and twisting them rolls the picture (clockwise twist, clockwise roll). The roll
  starts only after the fingers have turned 12° in one gesture, then catches up and follows them, so a pinch
  does not roll by accident. A double tap (two taps within 320 ms, each under 300 ms and 10 px) fits again. On a
  touch screen (no hover, coarse pointer) the controls line names these gestures, controls are 40 px high and
  inputs 16 px, so the page does not zoom when one is tapped. Below 600 px wide the header buttons and the
  toolbar each stay on one line that scrolls sideways, so the figure starts near the top of the screen.
- **The controls line.** One quiet line under the figure names the main controls (Drag turn, ⌥ roll, ⇧ move,
  ⌘ zoom, Double-click fit; Alt and Ctrl off a Mac), with the details in each one's tooltip; the one in use,
  or whose key is held, is lit. The "?" hides the line.

## The page

### Tabs

- A view toolbar over the figure and four tabs (the user's layout, 2026-11-23), five since the Assistant tab:
  - Info: what the file says.
  - Structure: what is drawn (the cells shown, which elements, bonds, angles, whether moments are shown).
  - Visual: how it looks (presets, surfaces and outlines, colours and sizes of atoms, bonds, angle marks and
    moment arrows, the unit-cell lines, legend, axes, lettering).
  - Layout: canvas size and shape, view direction, scale, saved views, dragging, large structures.
  - Assistant (since 2026-11-24): the assistant's connection and conversation (see "Assistant" below).
- A bond or angle rule is set up under Structure and styled under Visual.
- Above the figure: Open file…, the Examples menu and, while a structure is open, Close, which closes it and
  returns to the start page (2026-11-23).
- The quick styles (soft shading; flat colour, outlined; glossy highlight; metallic; clear glass atoms) set
  surfaces, outlines, lettering weight and legend sizes together.
- Tab icon (the user's choice, 2026-11-24, commit bf6bd71): an M and a T sharing a stem, slanted 12°, in the
  page's ink (#1b1a18), white on a dark tab bar (`prefers-color-scheme`). Drawn for MOTIF as one SVG path, not
  taken from any font or logo. `public/favicon.svg`, linked from `index.html`; the build copies it beside the
  page and links it as `./favicon.svg`. Checked: it reads at 16 and 32 px on light and dark tab bars.
  Safari does not take an SVG tab icon, so since e084351 `public/` also holds `favicon-32.png` (32 px),
  `favicon.ico` (16, 32 and 48 px) and `apple-touch-icon.png` (180 px): the same mark in ink on a white rounded
  tile, since a PNG cannot turn white on a dark tab bar. `index.html` links the 32 px PNG, then the SVG (which
  Chrome and Firefox use), then the Apple touch icon.
- Page colour (the user's choice, 2026-11-24): a 14 px dot in the current accent at the right of the header, just
  left of Open file… (since 83562f4; first a closed section, Layout › Page colour, in 1c365d6, moved because the
  user found it unrelated to the figure's layout, then beside the MOTIF word mark in cb9f2f4). A click opens a
  small row of the six colours under the dot, placed against the window so that on a phone, where the header's
  buttons scroll sideways, it is not cut off; choosing one applies it and closes the row, as do Escape and a click
  elsewhere (`src/ui/ThemeCue.tsx`). The six accents: Lemon (#fff27a, the default and the stylesheet's own),
  Marigold, Apricot, Mint, Sky and Lilac. The accent colours the page only: the main buttons, the assistant
  drawer's header, the example cards under the pointer, the active control hint and notices. Figures never change.
  The choice is kept in this browser (`localStorage` "motif.theme") and applied before the page is first drawn;
  choosing Lemon clears it. Code in `src/ui/theme.ts`. Checked (`tests/theme.test.ts`): Lemon matches the accent
  in `app.css`, and the page's ink (#1b1a18) has a contrast of at least 7:1 (WCAG AAA) on every accent and on its
  hover shade.

### Saved settings

- A person's preferences, by name, kept in the browser, and exported to or imported from a small JSON file
  (`*.motif-settings.json`, format version 1). Layout tab.
- They hold everything under Visual and Layout (surfaces, outlines, element colours and radii, arrows,
  unit-cell lines, legend, axes, lettering, canvas size and shape, dpi, scale, dragging), the saved views, and
  whether bonds are added on opening; not the structure (cells shown, bond and angle rules, distortion modes,
  the current view).
- One of them can be chosen to open the page with; element colours and radii from loaded settings carry over
  to each file opened.
- A setting the page does not know, or a value it does not accept, is left out and named.

### Feature examples

- The page offers only the *feature examples* (2026-11-23): five equal cards on the start page, numbered 01 to
  05 (one row where there is room, one column on a phone), and the Examples menu. Each is a structure file in
  `examples/` and the settings that show its feature. The other files in `examples/` are not listed; they stay
  because the tests use them. The list is
  `examples/features.json`, read by `src/ui/examples.ts`; [examples/README.md](../examples/README.md) describes
  each one.
- An entry has a `title`, a `file` (which must be in `examples/`) and a `note` (a few words shown on the card and
  in the menu),
  and may add:
  - `orbitals`: a list of `{ species, orbitals: [...], size, colours, zFrom }`, the orbitals drawn on the atoms
    of a species; optional are their size in Å (more than 0 and at most 20), `colours` (two `#rrggbb`, for the
    two signs) and `zFrom` (`{ neighbour, mode }`, mode `longest` or `bridge`: the local z from each atom's
    bonds, as under Orbitals);
  - `polyhedra`: a list of `{ centre, neighbour, upTo }`, coordination polyhedra round each `centre` atom with
    its `neighbour` atoms as corners, in the default look; the bond rule between the two is used if MOTIF
    suggested one, else one is added up to `upTo` Å (more than 0.1 and at most 10);
  - `hide`: a list of species left out of the figure;
  - `cells`: six numbers, the range shown, from *a*, *b*, *c* then to *a*, *b*, *c* (each "from" below its "to");
  - `fold`: `true` for an RMC configuration to be folded into one averaged cell;
  - `completeBonds`: `false` so that the bond rules do not add atoms outside the cells shown;
  - `along`: three whole numbers [u v w], not all zero, the direction the view looks along (pointing at the
    viewer), with *c* up, or *b* (then *a*) when *c* lies along the line of sight.
- An entry with no title or file, a file not in `examples/`, or a malformed setting is refused with its number.
- The settings apply only when the example is opened from the start page or the Examples menu; opening the same
  file by hand gives the plain defaults.
- The first card was "Atomic structure" (quartz) until 2026-11-24, when the user asked for a polyhedron example
  instead: first cubic SrTiO3 with its TiO6 octahedra (e016d7f), then, by the user's choice the same day, one
  layer of LaMnO3 seen down *c*, whose MnO6 octahedra are tilted and stretched by Jahn–Teller (8ed3cbd).
- Checked (`tests/features.test.ts`): each example opens and shows its feature (12 octahedra for the
  polyhedra one, moments for the magnetic one, orbitals on every atom of the species named), and the RMC example opens as its supercell and folds into the five sites of cubic SrTiO3,
  each within 0.02 Å of the published site.

### Large structures

- Moving a large structure (1,200 drawn atoms and bonds or more; orbitals do not count, since 1cd3e18 they
  are not drawn while moving; the number can be changed under View, and the preview switched off): while the view is changing, a drawing made by the graphics card (WebGL 2 in a
  worker, `src/preview`) stands in for the structure; the vector figure is drawn again about 0.2 s after the
  movement stops.
- The preview is given the same scene and places every atom with the same formula as the SVG (tested), and
  shades spheres the same way, pie spheres included, but it is simpler: arrows as bars, a plain cell, bonds
  with square ends, and no bands, filled triangles, polyhedra, angle marks or labels. Where two atoms overlap the preview
  shows the true intersection of the spheres, the SVG the nearer atom whole.
- It is never what is saved: Save always writes the vector figure. Small structures are simply redrawn as
  SVG, and so is everything in a browser that cannot draw in a worker (the page says so).
- The worker draws only into the canvas it was given. Close takes that canvas off the page, so the next
  structure opened gets a new canvas and a new worker (since 1cd3e18; before, a large structure opened after
  a Close showed an empty frame while moving).
- The page shows the figure as two layers (structure; legend and axes) made by the same code as the saved
  figure.
- Measured on an Apple M5 Pro in Chromium, per frame while dragging, without and with the preview: 729 atoms
  17 ms / 8 ms; 4,913 atoms 167 ms / 8 ms; 19,683 atoms 667 ms / 16 ms.

### Assistant (2026-11-24)

The user says how the figure should look, and the assistant changes it through the page's own controls, then says
where each control is, so the user learns where to find it.

- **Where it is** (the user's choice, 2026-11-24, commit 661f335): a drawer at the foot of the side panel, under
  every tab but Assistant, and the Assistant tab. Nothing is drawn over the figure. Shut, the drawer is a one-line
  bar ("Assistant", the connection, ▴); open, it holds Setup (switches to the Assistant tab), New chat, the
  conversation (at most about a third of the window high, scrolling) and an input. Open or shut is kept in this
  browser. The Assistant tab holds the connection setup (always shown) and the whole conversation, with its own
  input; the drawer is hidden while that tab is open. The drawer stays at the bottom of the side panel on every
  tab, however short; on a narrow screen, where the page scrolls, it sticks to the bottom of the screen while the
  panel is in view (310e03e). Only the drawer's header bar is coloured, in the page's accent (see "Page colour"
  under Tabs); the conversation and input below it are plain white (06915a4). Both show the one conversation
  (`src/ui/useAssistant.ts`; the drawer is `AssistantDrawer` in `src/ui/AssistantPanel.tsx`). A chatbox over the figure's lower right corner
  (f8b5708) came first and was removed because it covered the figure.
- **Models** (the user's choice): Claude, OpenAI or Gemini with the user's own API key, sent from the browser
  straight to that provider (Anthropic, OpenAI or Google); or a local model on Ollama or LM Studio, on which nothing
  leaves the computer. With a key, what the tools read about the figure (cell, elements, settings) goes to that
  provider with the user's words; the page says so. Each key, and the choice, stay in this browser. The local-server
  code is MATERIA's (`src/agent/localServer.ts`, `ollama.ts`, `ollamaNative.ts`, `lmstudio.ts`), so a local model
  runs with a 32k context and the same SDK.
- **OpenAI and Gemini** (f8b5708): both through their Chat Completions API, Gemini at its OpenAI-compatible
  address (`generativelanguage.googleapis.com/v1beta/openai`). One translation (`src/agent/openaiCompatible.ts`, no
  new dependency) turns the exchange's messages into a chat completion and the answer back: instructions as the
  system message, tools as functions with the same schema, each tool answer tied to its call. The provider's chat
  models are listed with the key, or a model's name can be typed. Gemini's thinking models return a signature with
  each tool call; it is sent back unchanged with that call. Not yet tried against the real OpenAI or Gemini
  services (no paid calls).
- **Scope** (the user's choice): look and layout only. Tools (`src/agent/tools.ts`): describe_figure, find_setting,
  change_settings (the page's saved-settings list, through its own checks), set_element, add_bonds, change_bonds,
  remove_bonds, set_view, set_cells, use_journal. No opening files, no saving figures.
- **Catalogue** (`src/agent/catalogue.ts`): every setting with its place ("Visual › Bonds"), what it does and the
  values it takes. A test holds it to the page's own list and every place to a section of the page.
- **One exchange** (`src/agent/assistant.ts`): the user's words, then tool calls carried out on the page, until the
  model answers in words, at most 12 calls; Stop ends it. Each tool answer names only the place of what changed.
- **Journal words** (`matchJournal` in `src/ui/journals.ts`): publishers by name or initials (APS, ACS), columns as
  "one column", "single", "double", "1.5 columns", widths as "full", "half", "third", "quarter".
- **Checked:** tools against a stand-in page, the exchange with a scripted model (`tests/agentTools.test.ts`,
  `tests/assistant.test.ts`); the OpenAI/Gemini translation both ways, with a stand-in server
  (`tests/openaiCompatible.test.ts`), and in the browser with a stand-in Gemini server inside the page, through
  which a request from the drawer under the Visual tab turned the quartz O atoms red; and a trial of ten requests on a local model, the page's state read after each
  (`scripts/assistant_trial.cjs`, `?probe` in the address; a 2-minute limit per request, 30 minutes in all).
  No paid API calls in development. Results on the user's local models (2026-11-24, after the fixes below):

  | Model | Server | Passed | Time per request |
  |-------|--------|--------|------------------|
  | gemma4:26b | Ollama | 10 of 10 | 3–20 s |
  | qwen-local (35B) | Ollama | 10 of 10 | 5–28 s |
  | qwen3:32b | Ollama | 10 of 10 (request 10 rerun after its fixes) | 30–110 s (it thinks first) |
  | gemma-4-26b-a4b-qat | LM Studio | 10 of 10 (request 5 rerun) | 2–16 s |
  | qwen3.8-27b | LM Studio | 10 of 10 (request 5 rerun) | 8–22 s |
  | muse-glimmer (28B) | LM Studio | 10 of 10 | 30–105 s |
  | gemma-4-e4b (4B) | LM Studio | 7 of 10 | 2–8 s |

  A 4B model is not reliable enough: it skipped part of a request, or asked before acting. Bugs the trials found and
  fixed: an LM Studio model loaded with too small a context (now loaded with 32k first, MATERIA's helper); a value
  refused for its form (8 for "8") is retried in its natural form, and the error shows what was sent; setting search
  split words only on spaces ("text,size" found nothing); "1/2" given as the column was read as "1 column" and full
  width applied while the assistant said half (now a share given as the column is the width, and the tool answer
  states what was applied); a journal named as its publisher was not found; an exchange that changed nothing now
  says so ("Nothing on the figure was changed."), since a small model can claim a change it did not make.

## How each part is checked

Each step is checked against an independent reference before the next one starts.

| Part | Checked against | Where |
|------|-----------------|-------|
| CIF reader and symmetry expansion | gemmi: `scripts/gemmi_reference.py` writes the reference atom lists | `tests/reference/` |
| Magnetic moments | pymatgen, on hexagonal structures with time-reversed operations | `scripts/pymatgen_moments.py`, `tests/fixtures` |
| Distortion modes | hand calculations from the published BaTiO3 and SrTiO3 I4/mcm coordinates | `tests/distortion.test.ts` |
| Journal templates | the widths and text rules on the journals' author pages | `tests/journals.test.ts` |
| Orbitals | orthogonality of the harmonics; the solid against the drawn surface; cuts against atoms | `tests/orbitals.test.ts` |
| Coordination polyhedra | hulls of regular solids (Euler's formula); counts and corner distances against gemmi; the drawing order seen down [111] | `tests/polyhedra.test.ts` |
| GPU preview | the same atom placement as the SVG; in a real browser, the saved SVG is identical with the preview on, off and showing, the two pictures of one view agree, and the page works without worker drawing | `scripts/browser_check.cjs` |

## Steps of the first version

| # | Step | Status |
|---|------|--------|
| 1 | Read a CIF and draw the atoms; rotate; export SVG and PNG | done |
| 2 | Choose what is shown: how many cells, or a slab | done |
| 3 | Bonds by distance for chosen element pairs; the unit cell | done |
| 4 | Colour and size per element; pie spheres for mixed sites | done |
| 5 | Legend and axis triad | done (reviewed in use by the user, 2026-11-23) |
| 6 | mCIF: magnetic moments as arrows | done (reviewed in use, 2026-11-23) |
| 7 | Highlights: a band along a chain, filled polygons | done (reviewed in use, 2026-11-23) |
| 8 | Interface: four tabs (Info, Structure, Visual, Layout), toolbar over the figure, one text scale | done (reviewed in use, 2026-11-23) |
| 9 | Bond angles: a translucent sector between two bonds, with the angle written beside it | done (reviewed in use, 2026-11-23) |
| 10 | Camera: view as numbers, turntable drag, crystal directions, snapping, saved and preset views | done (reviewed in use, 2026-11-23) |
| 11 | Distortion modes from ISODISTORT CIFs; arrows drawn as moments or displacements | done (2026-11-23) |
| 12 | RMCProfile configurations (.rmc6f): the whole supercell as P1, or folded into one averaged cell | done (2026-11-23) |
| 13 | Figure size on paper, aspect ratios, text in pt (defaults: Nature single column, 4:3, 7 pt) | done (2026-11-23) |
| 14 | Saved settings: named, kept in the browser, exported and imported as a file | done (2026-11-23) |
| 15 | Bond styles: atom colours, dashed and dotted; filled triangles cut to the gap | done (2026-11-23) |
| 16 | Coordination polyhedra from a bond rule: glass, solid or line art | done (2026-11-24) |

Examples and screenshots in this repository use published structures only.

## Building and testing

```
npm install
npm run dev      # the page, at the local address it prints
npm test         # the checks, a few seconds
npm run build    # a static site in dist/
```

Built with TypeScript, Vite and React; the page's font (IBM Plex Sans, OFL licence) is part of the
build, so the page makes no request to any other site. The page loads it under a private name, so that
it does not count as installed when it is chosen for the figure. The CIF reader and symmetry code are MOTIF's
own (adapted from the author's MATERIA) and are checked against gemmi: `scripts/gemmi_reference.py`
writes the reference atom lists in `tests/reference/`.
