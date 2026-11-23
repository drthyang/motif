# MOTIF handoff (2026-11-23, evening)

For the next session, on any computer. Read `CLAUDE.md` first: it has the working rules and the decisions
already taken by the user. This note is the state of play. README.md lists every convention.

## Start

```sh
git clone git@github.com:drthyang/motif.git && cd motif   # or: git pull
npm ci
npm run dev -- --port 5183      # http://localhost:5183/
npx tsc -b && npx vitest run    # 269 tests, about two seconds
```

Browser check (Playwright; needs a `playwright-core` from any local project, no browser download):

```sh
PLAYWRIGHT=/path/to/node_modules/playwright-core node scripts/browser_check.cjs
```

It must end with `all browser checks passed`. It relies on the `data-testid`s, `.figure-wrap`,
`[data-testid=layer-structure]`, `[data-testid=layer-band]` and the tabs `tab-info|structure|visual|layout`.
It was not run on 2026-11-23 (no Playwright on that computer).

## What MOTIF is now

A browser-only tool for vector figures of crystal structures. The user said on 2026-11-23 that the app is
in good shape. Every step of the README's table is done.

- Reads CIF, magnetic CIF, ISODISTORT CIFs (distortion modes) and RMCProfile `.rmc6f` configurations
  (whole supercell as P1, or folded into one cell with each site the plain average of its copies).
- SVG is the source of truth; PNG is drawn from the same SVG. Three parts: `src/structure` (file to
  atoms), `src/scene` (what is shown, plain data), `src/render` (scene + view to SVG), plus `src/preview`
  (GPU drawing while a large structure moves) and `src/ui`.
- The page: header with the name MOTIF only; four tabs: Info, Structure (what is drawn), Visual (how it
  looks), Layout (canvas, view, saved settings); one text scale (12/13/14/15 px); labels in one column.
- Defaults (the user's): a Nature single column, 89 mm, 4:3; Open Sans; text 7 pt, with the legend and
  axes in proportion to it; displacement arrows green, 1.5 A; moment arrows with the tail 80 % of the head
  side; up to 100,000 atoms.

## Open questions for the user (none blocking)

- A subtitle for the header was tried and removed; "Science, with an eye for design" and similar were
  offered. The browser tab still says "MOTIF · Crystal Structure Visualizer".
- Proposed, not started: click an atom or bond in the figure to edit it; undo/redo; symmetrize a folded RMC
  cell with a space group (RMCProfile Workbench has the method).
- Firefox not yet tested; the browser check not run since the latest changes.

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
