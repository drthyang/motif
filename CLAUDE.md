# Working rules for MOTIF

MOTIF draws crystal structures from CIF/mCIF as vector figures, in the browser, with no server.

## Decisions that belong to the user

Architecture and physics decisions are the user's. Propose with a recommendation, ask an
explicit question, and wait. Never decide provisionally. Accuracy comes before speed.

## How work proceeds

- Since 2026-11-22 the user allows building through the plan without stopping after each step:
  MOTIF is a visualizer, not a scientific computation. Still stop and ask when something is a real
  scientific judgement (how a quantity in a file is to be interpreted, for example).

- One step at a time (the steps are in docs/CONVENTIONS.md). Before a step, state in a few lines what
  will be built and which conventions are chosen. After it, show the check (screenshot or
  exported figure, the one command that runs it, what is and is not verified) and stop until
  the user says to continue. Split a step that grows.
- The picture must be the structure. Check against something independent (gemmi in Python,
  a hand calculation, a published figure): symmetry expansion, atom positions, which atoms
  fall in the chosen cells or slab, bond distances, axis directions and handedness, and for
  mCIF the moment directions under the magnetic operations including time reversal.
  A wrong arrow or a mirrored cell is the failure to avoid.
- The SVG is the source of truth. PNG is rendered from that same SVG.
- Keep three parts apart: structure (file -> atoms, cell, symmetry, moments), scene (what is
  shown and how it is styled, as plain data that can be saved and reloaded), renderer
  (scene + view -> SVG).
- Few dependencies. Tests run in seconds; every automated run has a per-case timeout.

## Decided by the user

- Moments in an mCIF are read as components along the unit vectors of a, b, c in Bohr magnetons
  and carried between atoms as m' = (time reversal) x det(R) x R m. Other forms and modulated
  structures are refused (2026-11-22).
- Default lettering weight: regular (2026-11-22).
- Distortion modes are read from ISODISTORT CIFs (2026-11-23): the distorted structure is drawn; each
  arrow starts at the atom's centre and is the displacement from the parent, from the displacive
  modes switched on (amplitude x norm x matrix, fractional), made angstrom with the undistorted
  supercell and carried as a polar vector d' = R d; the largest gets the chosen length. Strain,
  magnetic, rotational and occupancy modes are not drawn. A parent + distorted CIF pair is a
  possible later input.
- Licence: AGPL-3.0-or-later, as in NEBULA3D and RMCProfile Workbench (2026-11-22; switched
  from MIT while the repo was private, before any release).
- Code from the user's own apps (MATERIA, NEBULA3D, RMCProfile Workbench) may be reused; rewrite
  only where MOTIF's design needs it. Name the project it came from in the file's header comment
  and in the README. Check first that the file is the user's own work, not third-party code
  carried in that repo.

- In-app assistant (2026-11-24): models as in MATERIA (Claude with the user's own key, called from the
  browser, or a local model through Ollama or LM Studio), and also OpenAI and Gemini with the user's own keys
  (the user's request, 2026-11-24). With a key the structure is sent to that company (Anthropic, OpenAI or
  Google); with a local model nothing leaves the computer. First version changes look and layout only (settings,
  element colours and sizes, bonds and their look, view, cells, journal template); it does not open files or save
  figures. Built and tested against a local model and stand-ins for the companies' servers only, no paid API
  calls. Its conversation is in a drawer at the bottom of the side panel and in the Assistant tab.
- Assistant beyond look and layout (the user, 2026-11-24): it may add magnetic moments and save structures.
  Moments only as stated, per atom: size in μB and a direction [u v w], for an element, optionally only the atoms
  at one fractional coordinate; set on those atoms of one unit cell, nothing spread by symmetry (no magnetic
  order assumed); shown in Info as "added by hand, not from the file". Saving writes every atom of one unit cell
  (P1) in CIF, VASP POSCAR, XYZ or extended XYZ; symmetry is not kept; POSCAR and XYZ refuse partly occupied or
  shared sites (no occupancies); moments are not written.
- Page colour (2026-11-24): six accents for the page only, never the figure; Lemon by default. Chosen from a
  small dot at the right of the header, left of Open file. The tab icon is a slanted M and T sharing a stem.
- Coordination polyhedra (2026-11-24): drawn from a bond rule, round its centre atoms inside the range; Glass
  by default (Solid and Line art can be chosen); each polyhedron drawn as one unit at its centre's depth; a
  shared site coloured by its elements' colours mixed by occupancy; corner atoms cut exactly where they meet the
  faces. The first feature example is LaMnO3's MnO6 octahedra, one layer seen down c.
- Camera defaults (2026-11-25, accepted as built): tilt stops at ±90°; the axis buttons put c up (b when
  looking along c); snapping on; the short turn on a click on; scale fitted to each view; keeping the view when
  a file is opened off.

## Data rule (strict)

- Only published structures in this repo: examples, tests, docs, screenshots, commit messages.
- The user's unpublished structures and the figures made from them are local style targets
  and the final acceptance test only. Never copy them in, never commit them, never name
  those compounds anywhere in the repo. Local-only files go in `local/` (git-ignored).
- Do not commit mCIF files from MAGNDATA or any database before the user has agreed the
  licence. A small hand-written mCIF of a textbook antiferromagnet is fine.

## Repository

- Private. No tags or releases without the user. Commit and push to `main` while private.
- No paid API calls. Do not edit any other repo.
- Builders work in their own worktree under /tmp, never under ~/GitHub.
- Write for a scientist: plain sentences, defined terms.
