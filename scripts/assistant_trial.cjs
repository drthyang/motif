// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang
//
// A trial of the in-page assistant on a local model (no paid API): each request is sent in a fresh page with an
// example open, and the page's state afterwards (read through ?probe) is checked against what was asked.
// Each case has a time limit, and the whole trial a cap of 30 minutes.
//   PLAYWRIGHT=/path/to/playwright-core [TRANSPORT=lmstudio] [SET=round2] [ONLY=n] [CASE_S=s] node scripts/assistant_trial.cjs [model]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright-core");
const URL_BASE = process.env.MOTIF_URL || "http://localhost:5183/";
const MODEL = process.argv[2] || "";
// The local server: "ollama" (default) or "lmstudio".
const TRANSPORT = process.env.TRANSPORT || "ollama";
const CASE_MS = Number(process.env.CASE_S || 120) * 1000;
const TRIAL_MS = 30 * 60_000;

const QUARTZ = "examples/quartz_COD-9009666.cif";
const HALITE = "examples/halite-NaCl_COD-9008678.cif";
const OLIVINE = "examples/olivine-FeMg_COD-1541262.cif";
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const reddish = (hex) => { const [r, g, b] = rgb(hex); return r > 170 && g < 110 && b < 110; };
const bluish = (hex) => { const [r, g, b] = rgb(hex); return b > 150 && r < 120; };
const el = (s, name) => s.elements.find((e) => e.element === name);
const bond = (s, a, b) => s.bonds.find((x) => x.between === `${a}–${b}` || x.between === `${b}–${a}`);

const bluishDark = (hex) => { const [r, g, b] = rgb(hex); return b > r + 40 && b > g + 20; };
const greyish = (hex) => { const [r, g, b] = rgb(hex); return Math.max(r, g, b) - Math.min(r, g, b) < 40; };
const greenish = (hex) => { const [r, g, b] = rgb(hex); return g > r + 30 && g > b + 10; };
const changedNothing = (s, s0) => JSON.stringify({ ...s, view: "" }) === JSON.stringify({ ...s0, view: "" });

// The second set (2026-11-24): twenty rounds of varied requests, the new tools (moments, saving) and the edges
// (a request too vague to act on, one a format cannot do, a question that must change nothing).
const ROUND2 = [
  { file: QUARTZ, ask: "Make the oxygen atoms red and the silicon atoms dark blue.", ok: (s) => reddish(el(s, "O").colour) && bluishDark(el(s, "Si").colour) },
  { file: QUARTZ, ask: "Use the metal surface for the atoms and the bonds.", ok: (s) => s.settings.atomMaterial === "metal" && s.settings.bondMaterial === "metal" },
  { file: QUARTZ, ask: "Turn off the axis arrows and make the legend bigger.", ok: (s, s0) => s.settings.showAxes === false && Number(s.settings.legendSize) > Number(s0.settings.legendSize) },
  { file: QUARTZ, ask: "Show 3 by 3 by 1 cells and look down the c axis.", ok: (s) => s.cells === "from 0, 0, 0 to 3, 3, 1" && /along \[001\]/.test(s.view) },
  { file: QUARTZ, ask: "Size the figure for Nature, double column.", ok: (s) => /^Nature, double column/.test(s.journal) },
  { file: QUARTZ, ask: "Set the PNG resolution to 600 dpi and turn off the transparent background.", ok: (s) => String(s.settings.dpi) === "600" && s.settings.transparent === false },
  { file: QUARTZ, ask: "Make the unit cell lines solid and thinner.", ok: (s, s0) => s.settings.cellStyle === "solid" && Number(s.settings.cellWidth) < Number(s0.settings.cellWidth) },
  { file: QUARTZ, ask: "Hide the silicon atoms.", ok: (s) => el(s, "Si").hidden === true },
  { file: QUARTZ, ask: "Roll the picture by 30 degrees.", ok: (s) => /roll 30\.0°/.test(s.view) },
  { file: QUARTZ, ask: "How long are the Si–O bonds? Do not change anything.", ok: (s, s0, x) => changedNothing(s, s0) && /1\.6\d/.test(x.said) },
  { file: HALITE, ask: "Make the Na–Cl bonds dotted and grey.", ok: (s) => { const b = bond(s, "Na", "Cl"); return b && b.line === "dotted" && greyish(b.colour); } },
  { file: HALITE, ask: "Put a magnetic moment of 4 Bohr magnetons on every Na atom, along the c axis.", ok: (s) => /added by hand: Na 4 μB along \[0 0 1\]/.test(s.moments) },
  { file: HALITE, ask: "Add moments of 4 μB to the Na atoms: those at z = 0 point along +c and those at z = 1/2 point along -c.", ok: (s) => /Na.*4 μB along \[0 0 1\]/.test(s.moments) && /Na at c = 0\.5 4 μB along \[0 0 -1\]/.test(s.moments) },
  { file: HALITE, ask: "Add magnetic moments to the Na atoms.", ok: (s, s0, x) => s.moments === "none" && /\?|size|direction|how (large|big)|which/i.test(x.said) },
  { file: QUARTZ, ask: "Save the structure as a VASP POSCAR file.", ok: (s, s0, x) => x.downloads.length === 1 && /\.vasp$/.test(x.downloads[0].name) && /\nDirect\n/.test(x.downloads[0].text) },
  { file: QUARTZ, ask: "Save the structure as extended XYZ, named quartz_cell.", ok: (s, s0, x) => x.downloads.length === 1 && x.downloads[0].name === "quartz_cell.extxyz" && /Lattice="/.test(x.downloads[0].text) },
  { file: OLIVINE, ask: "Save the structure as a POSCAR file.", ok: (s, s0, x) => x.downloads.length === 0 && /CIF/.test(x.said) },
  { example: "Magnetic structure", ask: "Make the moment arrows thicker and shorter.", ok: (s, s0) => Number(s.settings.momentThickness) > Number(s0.settings.momentThickness) && Number(s.settings.momentLength) < Number(s0.settings.momentLength) },
  { example: "Magnetic structure", ask: "Colour the Mn moment arrows green and save the structure as CIF.", ok: (s, s0, x) => greenish(s.settings.momentColour) && x.downloads.length === 1 && /\.cif$/.test(x.downloads[0].name) },
  { file: HALITE, ask: "Set the moments on Na to 3 μB along [1 1 0], then remove all the moments again.", ok: (s) => s.moments === "none" },
];

const ONLY = process.env.ONLY ? Number(process.env.ONLY) : 0;
const CASES_ALL = [
  { example: "Coordination polyhedra", ask: "Make the atoms glass and colour the oxygen atoms red.", ok: (s) => s.settings.atomMaterial === "glass" && reddish(el(s, "O").colour) },
  { example: "Coordination polyhedra", ask: "Make the oxygen atoms smaller.", ok: (s, s0) => el(s, "O").radius < el(s0, "O").radius },
  { example: "Coordination polyhedra", ask: "Hide the unit cell.", ok: (s) => s.settings.showCell === false },
  { example: "Coordination polyhedra", ask: "Look along the a axis.", ok: (s) => /along \[100\]/.test(s.view) },
  { example: "Coordination polyhedra", ask: "Size the figure for Physical Review, one column, half width.", ok: (s) => /Physical Review/.test(s.journal) && /1\/2/.test(s.journal) },
  { example: "Coordination polyhedra", ask: "Show just one unit cell.", ok: (s) => s.cells === "from 0, 0, 0 to 1, 1, 1" },
  { example: "Coordination polyhedra", ask: "Draw the MnO6 octahedra as solid polyhedra.", ok: (s) => bond(s, "Mn", "O").polyhedra === "solid" },
  { example: "Coordination polyhedra", ask: "Remove the legend.", ok: (s) => s.settings.showLegend === false },
  { example: "Magnetic structure", ask: "Make the moment arrows blue.", ok: (s) => bluish(s.settings.momentColour) },
  { example: "Coordination polyhedra", ask: "Set all the text to 8 pt.", ok: (s) => ["legend", "axes", "angle"].every((k) => String(s.settings.textSizes[k]) === "8") },
];

const SET = process.env.SET === "round2" ? ROUND2 : CASES_ALL;
const CASES = ONLY ? [SET[ONLY - 1]] : SET;
(async () => {
  const started = Date.now();
  const browser = await chromium.launch();
  let passed = 0;
  for (const [n, c] of CASES.entries()) {
    if (Date.now() - started > TRIAL_MS) { console.log("STOP  trial cap of 30 minutes reached"); break; }
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    // Files the assistant saved: their names and contents.
    const downloads = [];
    page.on("download", async (d) => {
      const file = require("path").join(require("os").tmpdir(), `motif-trial-${Date.now()}-${d.suggestedFilename()}`);
      await d.saveAs(file);
      downloads.push({ name: d.suggestedFilename(), text: require("fs").readFileSync(file, "utf8") });
    });
    let line = "";
    try {
      await page.goto(URL_BASE + "?probe");
      if (c.file) await page.locator("input[type=file]").first().setInputFiles(require("path").resolve(__dirname, "..", c.file));
      else await page.click(`[data-testid="feature-${c.example}"]`);
      await page.waitForTimeout(1500);
      const before = await page.evaluate(() => window.__motifDescribe());
      await page.click("[data-testid=tab-assistant]");
      if (TRANSPORT !== "ollama") {
        if ((await page.locator("[data-testid=assistant-transport]").count()) === 0) await page.click("[data-testid=assistant-setup]");
        await page.selectOption("[data-testid=assistant-transport]", TRANSPORT);
      }
      await page.waitForFunction(() => document.querySelectorAll("[data-testid=assistant-model] option").length > 0, null, { timeout: 15000 });
      if (MODEL) await page.selectOption("[data-testid=assistant-model]", MODEL);
      await page.fill("[data-testid=assistant-text]", c.ask);
      const t0 = Date.now();
      await page.click("[data-testid=assistant-send]");
      await page.waitForSelector("[data-testid=assistant-send]", { timeout: CASE_MS });
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => window.__motifDescribe());
      const said = await page.locator("[data-testid=assistant-lines] .said").allTextContents();
      const ok = (() => { try { return c.ok(after, before, { said: said.join("\n"), downloads }); } catch { return false; } })() && errors.length === 0;
      if (ok) passed++;
      line = `${ok ? "ok  " : "FAIL"} ${n + 1}. ${c.ask}  (${((Date.now() - t0) / 1000).toFixed(0)} s)\n       ${said.slice(1).join("\n       ")}${errors.length ? `\n       page errors: ${errors.join("; ")}` : ""}`;
    } catch (e) {
      // What the assistant had done when it ran out of time, to see why.
      const said = await page.locator("[data-testid=assistant-lines] .said").allTextContents().catch(() => []);
      line = `FAIL ${n + 1}. ${c.ask}  (${String(e).split("\n")[0]})\n       ${said.slice(1).join("\n       ")}`;
    }
    console.log(line);
    await page.close();
  }
  await browser.close();
  console.log(`${passed} of ${CASES.length} passed in ${((Date.now() - started) / 60000).toFixed(1)} min`);
})();
