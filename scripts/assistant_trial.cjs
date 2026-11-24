// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang
//
// A trial of the in-page assistant on a local model (no paid API): each request is sent in a fresh page with an
// example open, and the page's state afterwards (read through ?probe) is checked against what was asked.
// Each case has a time limit, and the whole trial a cap of 30 minutes.
//   PLAYWRIGHT=/path/to/playwright-core [TRANSPORT=lmstudio] [ONLY=n] node scripts/assistant_trial.cjs [model]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright-core");
const URL_BASE = process.env.MOTIF_URL || "http://localhost:5183/";
const MODEL = process.argv[2] || "";
// The local server: "ollama" (default) or "lmstudio".
const TRANSPORT = process.env.TRANSPORT || "ollama";
const CASE_MS = Number(process.env.CASE_S || 120) * 1000;
const TRIAL_MS = 30 * 60_000;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const reddish = (hex) => { const [r, g, b] = rgb(hex); return r > 170 && g < 110 && b < 110; };
const bluish = (hex) => { const [r, g, b] = rgb(hex); return b > 150 && r < 120; };
const el = (s, name) => s.elements.find((e) => e.element === name);
const bond = (s, a, b) => s.bonds.find((x) => x.between === `${a}–${b}` || x.between === `${b}–${a}`);

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

const CASES = ONLY ? [CASES_ALL[ONLY - 1]] : CASES_ALL;
(async () => {
  const started = Date.now();
  const browser = await chromium.launch();
  let passed = 0;
  for (const [n, c] of CASES.entries()) {
    if (Date.now() - started > TRIAL_MS) { console.log("STOP  trial cap of 30 minutes reached"); break; }
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    let line = "";
    try {
      await page.goto(URL_BASE + "?probe");
      await page.click(`[data-testid="feature-${c.example}"]`);
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
      const after = await page.evaluate(() => window.__motifDescribe());
      const said = await page.locator("[data-testid=assistant-lines] .said").allTextContents();
      const ok = (() => { try { return c.ok(after, before); } catch { return false; } })() && errors.length === 0;
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
