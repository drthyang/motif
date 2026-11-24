# MOTIF handoff (2026-11-24)

For the next session, on any computer. Read `CLAUDE.md` first: it has the working rules and the decisions
already taken by the user. This note is the state of play. docs/CONVENTIONS.md lists every convention.

## Start

```sh
git clone git@github.com:drthyang/motif.git && cd motif   # or: git pull
npm ci
npm run dev -- --port 5183      # http://localhost:5183/
npx tsc -b && npx vitest run    # 352 tests, about two seconds
```

Browser check (Playwright; needs a `playwright-core` from any local project, no browser download):

```sh
PLAYWRIGHT=/path/to/node_modules/playwright-core node scripts/browser_check.cjs
```

It must end with `all browser checks passed` (it did on 2026-11-24, at 3fcb45a). It relies on the
`data-testid`s, `.figure-wrap`, `[data-testid=layer-structure]`, `[data-testid=layer-band]` and the tabs
`tab-info|structure|visual|layout|assistant`. It opens olivine through the file input, and since 2026-11-24 also
opens every feature example, turns and zooms it, and fails on any console error.

The assistant's trial on a local model (no paid API; Ollama or LM Studio must be running):

```sh
PLAYWRIGHT=/path/to/playwright-core node scripts/assistant_trial.cjs gemma4:26b
TRANSPORT=lmstudio PLAYWRIGHT=... node scripts/assistant_trial.cjs google/gemma-4-26b-a4b-qat   # LM Studio: lms server start --cors
ONLY=5 CASE_S=300 ...   # one request, a longer limit
```

Do not edit the page's code while a trial runs: the dev server reloads the page under test and spoils the request.

## What MOTIF is now

A browser-only tool for vector figures of crystal structures. The user said on 2026-11-23 that the app is
in good shape. Every step of the table in docs/CONVENTIONS.md is done.

- Reads CIF, magnetic CIF, ISODISTORT CIFs (distortion modes) and RMCProfile `.rmc6f` configurations
  (whole supercell as P1, or folded into one cell with each site the plain average of its copies).
- Orbitals (s, p, d, f) on the atoms of a chosen species, as smooth see-through isosurfaces. Since commit
  9e32821 orbitals and atoms cut through one another as true 3D solids: where a lobe passes in front of an
  atom's surface, the edge is traced from the exact orbital (not its mesh) and drawn as a smooth curve. While
  the view moves the edge is found on a coarser grid (a draft); once the view is still, and in every saved
  figure, it is drawn in full. Since f239ef1 an orbital's local z can come from each atom's own bonds
  ("longest bond to" a species, or "line through two" atoms of it), so an orbital order shows. Details and
  checks in docs/CONVENTIONS.md, "Orbitals".
- SVG is the source of truth; PNG is drawn from the same SVG. Three parts: `src/structure` (file to
  atoms), `src/scene` (what is shown, plain data), `src/render` (scene + view to SVG), plus `src/preview`
  (GPU drawing while a large structure moves) and `src/ui`.
- The page: header with the name MOTIF only; five tabs: Info, Structure (what is drawn), Visual (how it
  looks), Layout (canvas, view, saved settings), Assistant; one text scale (12/13/14/15 px); labels in one column.
- Formats (2026-11-23/24): CIF, mCIF, ISODISTORT, RMCProfile, VASP POSCAR/CONTCAR, XYZ and extended XYZ, SHELX
  .res/.ins, PDB, Quantum ESPRESSO input (ibrav 0), CASTEP .cell, FHI-aims geometry.in, XSF; each checked against
  the CIF reading of the same crystal (`tests/formats.test.ts`). The format shows over the figure, top left; an
  RMC file opens as its supercell with a Supercell | Fold switch there.
- Assistant (2026-11-24, docs/CONVENTIONS.md "Assistant"): look and layout only, Claude with the user's key or a
  local model. Tried on the user's seven local models: the six of 25B and more pass 10 of 10; a 4B model 7 of 10.
  gemma4:26b (Ollama) and gemma-4-26b-a4b-qat (LM Studio) are accurate and take seconds.
- Also since 2026-11-23: rulers beside the figure (cm/in switch where they meet), journal templates chosen as
  publisher › journal › column › width (full, 1/2, 1/3, 1/4), phone and tablet gestures, default colours Se
  orange and Ga mauve.
- Defaults (the user's): a Nature single column, 89 mm, 4:3; Open Sans; text 7 pt, with the legend and
  axes in proportion to it; displacement arrows green, 1.5 A; moment arrows with the tail 80 % of the head
  side; up to 100,000 atoms.
- Journal templates (Layout tab, Canvas): widths and text sizes for Nature, Science, Physical Review and ACS
  (commit 83550d6), and Nature Communications, Nature Materials, RSC, Elsevier, J. Phys.: Condens. Matter and
  American Mineralogist (ef9dde5), and the IUCr journals (45579c5, one column, capitals 2 mm), each from the
  publisher's own page; sources in `src/ui/journals.ts`. Science Advances and Wiley's journals are not included:
  their pages refuse automated access, and the user is checking them.
- After a turn by dragging the figure keeps its scale (664d6e8).

## Documentation

- `README.md` is short (commit f50385c): what MOTIF does, a link to the app, figures in `docs/media/` (a screenshot of the whole app on top, a gallery of six in two columns (orbital order, magnetic, distortion, RMC, quartz in metal and in glass), a screenshot of the journal panel;
  MOTIF's own output), status and licence. No installation section, by the user's wish.
- `docs/CONVENTIONS.md` holds what the long README used to: every convention with its date, grouped by topic,
  how each part is checked, the table of steps, and how to build and test. Record a new convention there.
- Since 2026-11-23 writing and building are done by separate sessions: the writing session owns `README.md`,
  `docs/CONVENTIONS.md`, `docs/HANDOFF.md` and `examples/README.md`; the building session owns the code and
  the example data, and may add a line to `docs/CONVENTIONS.md` when it records a convention.
- The app link `https://drthyang.github.io/motif/` does not work yet (the repo is private, GitHub Pages is not
  set up). The user's choice (2026-11-23): keep the link in the README, with a grey "app: not yet live" badge
  and a line saying it will work once published. When the app goes live, change the badge back to "app: live"
  and drop that line.
- Five feature examples (commits 6547441, 2329288 and f239ef1): atomic structure, magnetic structure, distortion
  mode, orbital order and an RMC configuration (opened folded), listed in `examples/features.json` and described in
  `examples/README.md`; the format is in docs/CONVENTIONS.md. The distortion mode is SrTiO3 I4/mcm (COD 2310687,
  the octahedra turned about c, the user's choice), seen down c. The orbital order is LaMnO3 (COD 1006141): Mn
  dz² along each Mn's long bond, O pz along each Mn–O–Mn line (the user's choice). The RMC file
  `examples/SrTiO3-supercell_generated.rmc6f` is generated for MOTIF by `scripts/make_rmc_example.py`, not a
  fit to data. Since ed88c53 the page offers only these five (numbered cards on the
  start page, and the Examples menu); the other files in `examples/` stay because the tests use them. A Close
  button returns to the start page.

## Open questions for the user (none blocking)

- Version: the page footer shows "MOTIF 0.1" (`VERSION` in `src/ui/App.tsx`) while `package.json` says
  0.0.0, and no release has been made. The shared rules want one version source and a dev suffix on `main`
  (`0.1.0-dev.0`). The README no longer states a number.
- A subtitle for the header was tried and removed; "Science, with an eye for design" and similar were
  offered. The browser tab still says "MOTIF · Crystal Structure Visualizer".
- Proposed, not started: click an atom or bond in the figure to edit it; undo/redo; symmetrize a folded RMC
  cell with a space group (RMCProfile Workbench has the method).
- Assistant: not built, the MCP server (registry, stdio) for agents outside the page, and hub registration in
  `scattering-agent-tools` (another repo; only with the user's yes). The user has not yet tried it with Claude
  (with their key); it was built and tried on local models only.
- Filled triangles: should they get a contrasting colour by default (not the pale tint of their atoms)? The user
  chose a contrasting blue by hand for a cluster figure; asked, not answered.
- Blank canvas while moving ("simplified while moving" with nothing drawn): not reproduced here. Since bdbf658 the
  preview checks that its first frame painted and is dropped if not, and an endless update loop that could blank
  the figure was fixed (399e17c). Ask the user which browser and device showed it, and whether it still does.
- Firefox not yet tested.

## Rules that are easy to break

- Data rule (strict): the user's unpublished structures, their RMC configurations and the reference slide
  figures stay on the user's computer only (`local/`, git-ignored). Never copy them in, never commit them,
  never name those compounds in the repo, commit messages included.
- No mCIF from MAGNDATA or any database in the repo before the user agrees the licence.
- Commit and push to `main` (repo is private); no tags or releases; no paid API calls; do not edit other repos.
- The user is the only author of every commit: no `Co-Authored-By` trailer and no "Generated with" line
  (the user's rule in `~/Research/GitHub/CLAUDE.md`; older commits carry one, history is left as is). No model
  names in the repo.
- New source files start with `// SPDX-License-Identifier: AGPL-3.0-or-later` and
  `// Copyright (C) 2026 Tsung-Han Yang`.
- Others also push to `main`: `git pull --rebase` before pushing.
- Architecture or physics questions go to the user as an explicit question with a recommendation.
- The user gives short visual feedback, often with a screenshot. Check each change in a screenshot
  before reporting it, at more than one window width.
