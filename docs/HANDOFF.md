# MOTIF handoff (2026-11-25)

For the next session, on any computer. Read `CLAUDE.md` first: it has the working rules and the decisions
already taken by the user. This note is the state of play. docs/CONVENTIONS.md lists every convention.

## Start

```sh
git clone git@github.com:drthyang/motif.git && cd motif   # or: git pull
npm ci
npm run dev -- --port 5183      # http://localhost:5183/
npx tsc -b && npx vitest run    # 400 tests, about three seconds
```

Browser check (Playwright; needs a `playwright-core` from any local project, no browser download):

```sh
PLAYWRIGHT=/path/to/node_modules/playwright-core node scripts/browser_check.cjs
```

It must end with `all browser checks passed` (it did on 2026-11-25, at 519d741). It relies on the
`data-testid`s, `.figure-wrap`, `[data-testid=layer-structure]`, `[data-testid=layer-band]` and the tabs
`tab-info|structure|visual|layout|assistant`. It opens olivine through the file input, and since 2026-11-24 also
opens every feature example, turns and zooms it, and fails on any console error.

The assistant's trial on a local model (no paid API; Ollama or LM Studio must be running):

```sh
PLAYWRIGHT=/path/to/playwright-core node scripts/assistant_trial.cjs gemma4:26b
TRANSPORT=lmstudio PLAYWRIGHT=... node scripts/assistant_trial.cjs google/gemma-4-26b-a4b-qat   # LM Studio: lms server start --cors
ONLY=5 CASE_S=300 ...   # one request, a longer limit
SET=round2 | SET=answers | SET=angles ...   # the other case sets (see the script's header)
```

Do not edit the page's code while a trial runs: the dev server reloads the page under test and spoils the request.

## What MOTIF is now

A browser-only tool for vector figures of crystal structures. The user said on 2026-11-23 that the app is
in good shape. Every step of the table in docs/CONVENTIONS.md is done.

- Reads CIF, magnetic CIF, ISODISTORT CIFs (distortion modes) and RMCProfile `.rmc6f` configurations
  (whole supercell as P1, or folded into one cell with each site the plain average of its copies).
- Orbitals (s, p, d, f) on the atoms of a chosen species, as smooth see-through isosurfaces. Since commit
  9e32821 orbitals and atoms cut through one another as true 3D solids: where a lobe passes in front of an
  atom's surface, the edge is traced from the exact orbital (not its mesh) and drawn as a smooth curve. Since
  1cd3e18 the page draws the structure without its orbitals while the view moves (atoms, bonds and cell in
  place); they come back once the view is still and are in every saved figure. The coarse-grid draft is no
  longer used by the page, and orbitals no longer count towards the GPU preview. Since f239ef1 an orbital's local z can come from each atom's own bonds
  ("longest bond to" a species, or "line through two" atoms of it), so an orbital order shows. Details and
  checks in docs/CONVENTIONS.md, "Orbitals".
- Coordination polyhedra (e016d7f, docs/CONVENTIONS.md "Coordination polyhedra"), the user's choices of
  2026-11-24: from a bond rule ("Polyhedra round X"); glass by default, solid or line art; each drawn as one unit
  at its centre's depth (exact clipping through atoms other than its corners may come later); a shared site coloured by its elements mixed by
  occupancy. Since acb71ee a corner atom is cut exactly where it meets the faces (drawn whole before its
  polyhedra, then again after them, cut to the part in front), checked by ray casting. Checked against gemmi
  counts and distances (`tests/polyhedra.test.ts`). The GPU preview leaves them
  out while the view moves.
- SVG is the source of truth; PNG is drawn from the same SVG. Three parts: `src/structure` (file to
  atoms), `src/scene` (what is shown, plain data), `src/render` (scene + view to SVG), plus `src/preview`
  (GPU drawing while a large structure moves) and `src/ui`.
- The page: header with the name MOTIF and the page-colour dot; five tabs: Info, Structure (what is drawn), Visual (how it
  looks), Layout (canvas, view, saved settings), Assistant; one text scale (12/13/14/15 px); labels in one column.
- Formats (2026-11-23/24): CIF, mCIF, ISODISTORT, RMCProfile, VASP POSCAR/CONTCAR, XYZ and extended XYZ, SHELX
  .res/.ins, PDB, Quantum ESPRESSO input (ibrav 0), CASTEP .cell, FHI-aims geometry.in, XSF; each checked against
  the CIF reading of the same crystal (`tests/formats.test.ts`). The format shows over the figure, top left; an
  RMC file opens as its supercell with a Supercell | Fold switch there.
- Assistant (2026-11-24, docs/CONVENTIONS.md "Assistant"): look and layout only; Claude, OpenAI or Gemini with
  the user's key, or a local model. Tried on the user's seven local models: the six of 25B and more pass 10 of 10;
  a 4B model 7 of 10. gemma4:26b (Ollama) and gemma-4-26b-a4b-qat (LM Studio) are accurate and take seconds.
  Since 661f335 it is talked to in a drawer at the foot of the side panel (under every tab but Assistant; shut,
  a one-line bar) as well as in the Assistant tab, which keeps the setup; both show one conversation
  (`src/ui/useAssistant.ts`). Nothing is drawn over the figure: the chatbox over its lower right corner (f8b5708)
  was removed because it covered the figure, and the user settled on drawer plus tab. OpenAI and Gemini go through one Chat Completions translation
  (`src/agent/openaiCompatible.ts`, Gemini at its OpenAI-compatible address); checked with unit tests and a
  stand-in Gemini server in the page, not yet against the real services.
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
- Tab icon (bf6bd71, the user's choice from four M+T monograms): an M and a T sharing a stem, slanted 12°, a
  heavy fused grotesque drawn from scratch; ink on a light tab bar, white on a dark one. `public/favicon.svg`,
  with PNG, ICO and Apple touch icon copies on a white tile for Safari (e084351).
  MTF as a name or monogram was considered and dropped (it reads as "male-to-female", and in imaging as
  "modulation transfer function").
- Page colour: a small dot at the right of the header, left of Open file…, opens six accents (Lemon, the default,
  Marigold, Apricot, Mint, Sky, Lilac), for the page only, never the figures; kept in this browser
  (`src/ui/ThemeCue.tsx`, `src/ui/theme.ts`). It was a Layout section (1c365d6) until the user said it is not about
  the figure's layout, then a dot beside the word mark (cb9f2f4), then at the right (83562f4). The user had found Lemon
  close to the MFA Boston website's yellow (#ffff5a); after mock views of the six they kept Lemon as the default
  and asked for a choice. The assistant drawer's header bar takes the accent; its conversation and input are plain
  white (06915a4, after a pale-yellow tint in 7bfc9ae and an all-yellow drawer in 4927e65).
- Opening any file blanked the page in newer browsers, fixed in 1cd3e18: the Assistant tab's scroll effect
  returned the promise that `scrollIntoView` now gives, and React took it for a clean-up; it now returns nothing.

## Documentation

- `README.md` is short (commit f50385c): what MOTIF does, a link to the app, figures in `docs/media/` (a screenshot of the whole app on top (the coordination-polyhedra example, since 2026-11-26), a gallery of six in two columns (orbital order, magnetic, distortion, RMC, quartz in metal and in glass), a screenshot of the journal panel (MnF₂, since 2026-11-26; the orbital example is shown once, in the gallery, the user's wish);
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
- Five feature examples (commits 6547441, 2329288, f239ef1 and e016d7f): coordination polyhedra, magnetic
  structure, distortion mode, orbital order and an RMC configuration (opened as its supercell), listed in `examples/features.json` and described in
  `examples/README.md`; the format is in docs/CONVENTIONS.md. The first is one MnO2 layer of LaMnO3 (COD 1006141)
  seen down c with its MnO6 octahedra, tilted and stretched by Jahn–Teller: the user's choice (8ed3cbd) after cubic
  SrTiO3 (e016d7f) had replaced quartz ("atomic structure") the same day, 2026-11-24. The distortion mode is SrTiO3 I4/mcm (COD 2310687,
  the octahedra turned about c, the user's choice), seen down c. The orbital order is LaMnO3 (COD 1006141): Mn
  dz² along each Mn's long bond, O pz along each Mn–O–Mn line (the user's choice). The RMC file
  `examples/SrTiO3-supercell_generated.rmc6f` is generated for MOTIF by `scripts/make_rmc_example.py`, not a
  fit to data. Since ed88c53 the page offers only these five (numbered cards on the
  start page, and the Examples menu); the other files in `examples/` stay because the tests use them. A Close
  button returns to the start page.

## Next: the queue (the user's yes in the MOTIF chat, 2026-11-25: "Yes, all three")

The Session monitor relayed the user's "go for all" (15:20 EST) and the user confirmed it in this chat. Item (c) is
done; (b) and (a) are next, one checked commit each, a message to the Session monitor (send_message, "@parent" from
a session it created, else its id session_018FAHe7jSmFWHBKsHtxQSBh) after each.

1. **(c) Incommensurate-k warning: done** (519d741). docs/CONVENTIONS.md, "Magnetic CIF", "Propagation vector".
2. **(b) Camera defaults: record them as the user's decision**, accepted as built: tilt stops at ±90°; the axis
   buttons put c up (b when looking along c); snapping on; animation on; scale "fit each view"; keep view when a
   file is opened off. Add them to `CLAUDE.md`, "Decided by the user" (the user said yes in the MOTIF chat, so the
   building session records it there), and to docs/CONVENTIONS.md, "View and camera". No code change.
3. **(a) MCP server**, for agents outside the page, in MOTIF only: a tool registry, a host and a stdio server shaped
   like MATERIA's (`~/GitHub/web-refinement/src/mcp/`: registry.ts, host.ts with file roots from an environment
   variable, server.ts; bundled with esbuild to one `dist/mcp-server.mjs`), reusing MOTIF's pure code (structure,
   scene, render) and the same tool surface as the in-page assistant where it makes sense (open a file from an
   allowed folder, describe, settings, bonds, view, cells, journal, moments, angles, save the structure, save the
   figure as SVG). With tests. **Do not edit `scattering-agent-tools`** (another repo): write down exactly what
   the hub needs (the entry, the command, the tool list) in a file in MOTIF, e.g. docs/HUB-REGISTRATION.md, and
   tell the Session monitor; a separate agent registers it there.
   **Done** (2026-11-25, merged to main): `src/mcp/`, docs/HUB-REGISTRATION.md, docs/CONVENTIONS.md "MCP
   server"; bundled with rolldown (Vite's) to `dist-mcp/mcp-server.mjs`. The user chose option "A": a headless
   `Figure` (`src/mcp/figure.ts`) mirrors the page's state; App.tsx keeps its own mapping. **Any new page setting
   that changes the saved figure must be added to `src/mcp/figure.ts` too, or the parity check fails**
   (`scripts/browser_check.cjs` part 5: page SVG = server SVG, byte for byte, for olivine and the five examples).
   That check found a page bug: the `fit` memo in App.tsx left `canvas` out of its dependencies, so the page fitted
   the structure to the canvas from before the frame was measured (1440 × 1100, drawn on 1440 × 1080: 2.6 % too
   large). Fixed with the user's yes (2026-11-25, commit 1e2fb1d): saved figures changed, structures 2.6 % smaller in
   the default canvas.
   Hub registration waits until MOTIF is public (the user, 2026-11-25); then a separate agent registers it from
   docs/HUB-REGISTRATION.md.

Limits for all three: correctness first; no paid API calls (no trial with the user's Claude, OpenAI or Gemini key;
local models only); no Claude trailer in MOTIF commits; unpublished structures stay local; nothing automated past
30 minutes (per-case limits in every trial).

## Open questions for the user (none blocking)

- Version: the page footer shows "MOTIF 0.1" (`VERSION` in `src/ui/App.tsx`) while `package.json` says
  0.0.0, and no release has been made. The shared rules want one version source and a dev suffix on `main`
  (`0.1.0-dev.0`). The README no longer states a number.
- A subtitle for the header was tried and removed; "Science, with an eye for design" and similar were
  offered. The browser tab still says "MOTIF · Crystal Structure Visualizer".
- Proposed, not started: click an atom or bond in the figure to edit it; undo/redo; symmetrize a folded RMC
  cell with a space group (RMCProfile Workbench has the method).
- Assistant can add moments by hand and save structures (2026-11-24, the user's rules in CLAUDE.md); twenty more
  rounds in `scripts/assistant_trial.cjs` (SET=round2), all four large local models 20/20 after fixes.
- Assistant (in the page) since 2026-11-24 also: answers from a map of the page (`src/agent/pageMap.ts`), replies as
  paragraphs and lists (`src/agent/reply.ts`), a context meter in the drawer and the Assistant tab, mark_angles and
  clear_angles; polyhedra through change_bonds. The user has not yet tried it with Claude
  (with their key); it was built and tried on local models only. OpenAI and Gemini (f8b5708) likewise have not
  been tried against the real services.
- Answered 2026-11-26 ("A"): OpenAI and Gemini stay offered beside Claude and local models, recorded in `CLAUDE.md`
  ("Decided by the user"); untried against the real services until the user tests them with their own keys.
- Filled triangles: should they get a contrasting colour by default (not the pale tint of their atoms)? The user
  chose a contrasting blue by hand for a cluster figure; asked, not answered.
- Blank canvas while moving ("simplified while moving" with nothing drawn): found and fixed in 1cd3e18. Close
  took the preview's canvas off the page while its worker went on drawing into the old one, so any large
  structure opened after a Close (the RMC supercell, for one) showed an empty frame while moving; a new canvas
  now gets a new worker (`src/preview/usePreview.ts`). Earlier guards stay: the preview checks that its first
  frame painted (bdbf658), and an endless update loop that could blank the figure was fixed (399e17c). Ask the
  user whether it still happens.
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
