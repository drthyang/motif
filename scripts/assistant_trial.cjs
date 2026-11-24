// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang
//
// A trial of the in-page assistant on a local model (no paid API): each request is sent in a fresh page with an
// example open, and the page's state afterwards (read through ?probe) is checked against what was asked.
// Each case has a time limit, and the whole trial a cap of 30 minutes.
//   PLAYWRIGHT=/path/to/playwright-core node scripts/assistant_trial.cjs [model]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright-core");
const URL_BASE = process.env.MOTIF_URL || "http://localhost:5183/";
const MODEL = process.argv[2] || "";
const CASE_MS = 120_000;
const TRIAL_MS = 30 * 60_000;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const reddish = (hex) => { const [r, g, b] = rgb(hex); return r > 170 && g < 110 && b < 110; };
const bluish = (hex) => { const [r, g, b] = rgb(hex); return b > 150 && r < 120; };
const el = (s, name) => s.elements.find((e) => e.element === name);
const bond = (s, a, b) => s.bonds.find((x) => x.between === `${a}–${b}` || x.between === `${b}–${a}`);

const ONLY = process.env.ONLY ? Number(process.env.ONLY) : 0;
const CASES_ALL = [
  { example: "Atomic structure", ask: "Make the atoms glass and colour the oxygen atoms red.", ok: (s) => s.settings.atomMaterial === "glass" && reddish(el(s, "O").colour) },
  { example: "Atomic structure", ask: "Make the oxygen atoms smaller.", ok: (s, s0) => el(s, "O").radius < el(s0, "O").radius },
  { example: "Atomic structure", ask: "Hide the unit cell.", ok: (s) => s.settings.showCell === false },
  { example: "Atomic structure", ask: "Look along the c axis.", ok: (s) => /along \[001\]/.test(s.view) },
  { example: "Atomic structure", ask: "Size the figure for Physical Review, one column, half width.", ok: (s) => /Physical Review/.test(s.journal) && /1\/2/.test(s.journal) },
  { example: "Atomic structure", ask: "Show 2 by 2 by 1 cells.", ok: (s) => s.cells === "from 0, 0, 0 to 2, 2, 1" },
  { example: "Atomic structure", ask: "Make the Si–O bonds thicker and dashed.", ok: (s, s0) => bond(s, "Si", "O").thickness > bond(s0, "Si", "O").thickness && bond(s, "Si", "O").line === "dashed" },
  { example: "Atomic structure", ask: "Remove the legend.", ok: (s) => s.settings.showLegend === false },
  { example: "Magnetic structure", ask: "Make the moment arrows blue.", ok: (s) => bluish(s.settings.momentColour) },
  { example: "Atomic structure", ask: "Set all the text to 8 pt.", ok: (s) => ["legend", "axes", "angle"].every((k) => String(s.settings.textSizes[k]) === "8") },
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
      line = `FAIL ${n + 1}. ${c.ask}  (${String(e).split("\n")[0]})`;
    }
    console.log(line);
    await page.close();
  }
  await browser.close();
  console.log(`${passed} of ${CASES.length} passed in ${((Date.now() - started) / 60000).toFixed(1)} min`);
})();
