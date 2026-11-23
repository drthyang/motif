# MOTIF handoff (2026-11-23)

For the next session, on any computer. Read `CLAUDE.md` first: it has the working rules and the decisions
already taken by the user. This note is the state of play.

## Start

```sh
git clone git@github.com:drthyang/motif.git && cd motif   # or: git pull
npm ci
npm run dev -- --port 5183      # http://localhost:5183/
npx tsc -b && npx vitest run    # 243 tests, about one second
```

Browser check (Playwright; needs a `playwright-core` from any local project, no browser download):

```sh
PLAYWRIGHT=/path/to/node_modules/playwright-core node scripts/browser_check.cjs
```

It must end with `all browser checks passed`. It relies on the `data-testid`s, `.figure-wrap`,
`[data-testid=layer-structure]`, `[data-testid=layer-band]` and the tabs `tab-info|structure|visual|layout`.

## What MOTIF is now

Browser-only tool for publication-quality vector figures of crystal structures from CIF/mCIF (tagline
"Publication-quality crystal structure figures"). SVG is the source of truth; PNG is drawn from the same SVG.
Three parts: `src/structure` (file to atoms), `src/scene` (what is shown, plain data), `src/render`
(scene + view to SVG), plus `src/preview` (GPU drawing while a large structure moves) and `src/ui`.
README.md lists every convention.

Built and pushed: the seven planned steps; magnetic moments (verified against pymatgen and Bilbao);
bond angles; camera (turntable, views along [uvw]/(hkl), snapping, saved views); zoom; GPU preview;
surfaces (soft, flat, glossy, metal, glass; glass 75 % solid by default); rods through spheres;
auto bonds on load; style presets; distortion modes from ISODISTORT CIFs; figure size on paper and
text in pt; canvas aspect ratios; font list.

Latest changes (2026-11-23):
- Axis arrows a, b, c in their own colours (muted red, green, blue), pickers per axis, a grey option
  (Visual tab, Axes).
- Colour of filled bond triangles can be chosen (Visual tab, Bonds, after "Fill triangles").
- Displacement arrows: the largest is 2.5 Å long by default (the user's choice).
- Page style: the user asked for the manner of the MFA Boston website, then "a bit more soft touch".
  Now in `src/ui/app.css`: bold tight lettering (IBM Plex Sans, self-hosted as "MOTIF UI"), warm
  near-black ink `#1b1a18`, one dark rule under the header, light hairlines elsewhere, rounded corners
  (6 px), outlined buttons with grey hover, one soft yellow `#fff27a` for Open file, ▶ section markers.
  The user has not yet said whether this blend is right: show it and ask.

## Open questions for the user (none blocking)

- Is the softened museum style right, or more/less soft?
- Camera defaults never confirmed hands-on (tilt limit ±90°, snapping, animation, scale "fit each view").
- Should cell lines stop at the surface of glass atoms? Should the Paper preset keep bond outlines?
- Proposed, not started: click an atom or bond in the figure to edit it; undo/redo; save and reload a
  figure set-up.
- Firefox not yet tested.

## Rules that are easy to break

- Data rule (strict): the user's unpublished structures and the two reference slide figures stay on the
  user's computer only. Never copy them in, never commit them, never name those compounds in the repo.
  The user's own mCIF used to check moment directions is local only too.
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
  before reporting it.
