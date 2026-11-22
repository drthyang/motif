# Working rules for MOTIF

MOTIF draws crystal structures from CIF/mCIF as vector figures, in the browser, with no server.

## Decisions that belong to the user

Architecture and physics decisions are the user's. Propose with a recommendation, ask an
explicit question, and wait. Never decide provisionally. Accuracy comes before speed.

## How work proceeds

- Since 2026-11-22 the user allows building through the plan without stopping after each step:
  MOTIF is a visualizer, not a scientific computation. Still stop and ask when something is a real
  scientific judgement (how a quantity in a file is to be interpreted, for example).

- One step at a time (the steps are in README.md). Before a step, state in a few lines what
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

## Data rule (strict)

- Only published structures in this repo: examples, tests, docs, screenshots, commit messages.
- The user's unpublished structures and the figures made from them are local style targets
  and the final acceptance test only. Never copy them in, never commit them, never name
  those compounds anywhere in the repo. Local-only files go in `local/` (git-ignored).
- Do not commit mCIF files from MAGNDATA or any database before the user has agreed the
  licence. A small hand-written mCIF of a textbook antiferromagnet is fine.

## Repository

- Private. No tags or releases without the user. Commit and push to `main` while private.
- No paid API calls. Do not edit any other repo; propose code reuse to the user first.
- Builders work in their own worktree under /tmp, never under ~/GitHub.
- Write for a scientist: plain sentences, defined terms.
