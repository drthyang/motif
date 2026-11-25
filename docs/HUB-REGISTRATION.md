# Registering MOTIF's MCP server in scattering-agent-tools

What the hub (`drthyang/scattering-agent-tools`) needs to start MOTIF's MCP server. MOTIF does not edit the hub;
a separate agent registers it there. Written 2026-11-25 for the server in `src/mcp/` (docs/CONVENTIONS.md, "MCP server").

**Not yet:** registration waits until MOTIF is public (the user, 2026-11-25): the hub repo is public and MOTIF is
private. Then register it from this file.

## The entry

In `plugin/suite.json`, under `servers`, shaped like the MATERIA entry (one bundle per launcher process, file folders
from the suite's `{file_roots}`):

```json
"motif": {
  "app": "MOTIF",
  "role": "Vector figures of crystal structures (CIF, mCIF, ISODISTORT, RMCProfile and other formats): bonds, polyhedra, moments, angles, views, journal sizes; saves the figure as SVG and the structure as CIF, POSCAR or XYZ",
  "github": "drthyang/motif",
  "dir": "motif",
  "dir_env": "MOTIF_DIR",
  "status": "ready",
  "runtime": "node",
  "requires": ["node_modules", "scripts/build-mcp.mjs"],
  "bundle": "{dir}/node_modules/.cache/scattering-suite/motif-mcp-{pid}.mjs",
  "build": ["node", "scripts/build-mcp.mjs", "--outfile", "{bundle}"],
  "run": ["node", "{bundle}"],
  "env": { "MOTIF_ROOTS": "{file_roots}" }
}
```

In `plugin/.mcp.json`, under `mcpServers`:

```json
"motif": { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/bin/launch.mjs", "motif"] }
```

No `min_version` yet: MOTIF has made no release and its version is an open question for the user (`package.json`
says 0.0.0, the page footer 0.1). Add one once the user settles it.

## The command, without the hub

```sh
cd motif && npm ci
node scripts/build-mcp.mjs                       # -> dist-mcp/mcp-server.mjs (one file, examples inside)
MOTIF_ROOTS=/path/to/structures:/path/to/figures node dist-mcp/mcp-server.mjs   # stdio
npm run -s mcp                                    # build, then serve (-s: npm prints nothing on stdout)
```

- `MOTIF_ROOTS`: a path list (`:` on macOS and Linux, `;` on Windows). Files are read from and written into these
  folders only; relative paths start from the first. Unset: the folder the server is started in, unless that is the
  filesystem root or the home folder, when files are off.
- Node: tried on 24. The bundle holds the MCP SDK, zod and the five feature examples, so it runs from any folder.
- Nothing leaves the computer: no network, no model; the client's agent calls the tools.

## The tools (18)

| Tool | Title |
|---|---|
| `open_file` | Open a structure file |
| `open_example` | Open a feature example |
| `save_figure` | Save the figure (SVG) |
| `save_structure` | Save the structure |
| `describe_figure` | Describe the figure |
| `find_setting` | Find a setting |
| `change_settings` | Change settings |
| `set_element` | Element colour, size, shown |
| `add_bonds` | Add bonds |
| `change_bonds` | Change bonds |
| `remove_bonds` | Remove bonds |
| `set_view` | Set the view |
| `set_cells` | Cells shown |
| `use_journal` | Journal template |
| `set_moments` | Moments by hand |
| `mark_angles` | Mark bond angles |
| `clear_angles` | Clear angle marks |
| `clear_moments` | Clear moments by hand |

The server holds one figure. The last fourteen are the in-page assistant's tools with the same descriptions,
schemas, checks and answers (`src/agent/tools.ts`); the first four are the server's own (`src/mcp/registry.ts`).

## For docs/CAPABILITIES.md in the hub

MOTIF owns: drawing a crystal structure as a publication figure (SVG, the same output as the MOTIF page, byte for
byte), its look and layout, journal sizes, moments set by hand as stated, and writing one unit cell as CIF, POSCAR or
XYZ. It does not refine, fit or compute diffraction (MATERIA does); it reads what MATERIA writes (CIF, mCIF).
