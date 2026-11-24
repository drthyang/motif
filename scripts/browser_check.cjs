// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

// Checks of the GPU preview that need a real browser (the unit tests cannot run WebGL).
// Not part of `npm test`. Needs the dev server (`npm run dev -- --port 5183`) and Playwright:
//   PLAYWRIGHT=/path/to/node_modules/playwright-core node scripts/browser_check.cjs
// It checks that
//   1. the saved SVG is byte for byte the same with the preview on, off, and while the preview is showing;
//   2. the preview and the vector figure of one view cover the same pixels in nearly the same colours;
//   3. without worker drawing (no OffscreenCanvas) the page still works, on SVG alone, and says so.
const { chromium } = require(process.env.PLAYWRIGHT || "playwright-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const URL_BASE = process.env.MOTIF_URL || "http://localhost:5183/";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "motif-check-"));
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) failures++;
};

async function setUp(page, query) {
  await page.goto(URL_BASE + query);
  await page.setInputFiles("[data-testid=file]", path.join(__dirname, "..", "examples", "olivine-FeMg_COD-1541262.cif"));
  // The bonds (Fe/Mg-O and Si-O) are added by the page when the file opens.
  await page.click("[data-testid=tab-layout]");
  await page.fill("[data-testid=view-az]", "40");
  await page.fill("[data-testid=view-el]", "25");
}
async function saveSvg(page, name) {
  const [d] = await Promise.all([page.waitForEvent("download"), page.click("[data-testid=export-svg]")]);
  const file = path.join(tmp, name);
  await d.saveAs(file);
  return fs.readFileSync(file, "utf8");
}
const live = (page) => page.getAttribute("[data-testid=preview]", "data-live");

(async () => {
  const browser = await chromium.launch({ args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });

  // 1. Saved figure: preview off, preview on (settled), and while the preview is showing.
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
    await setUp(page, "?preview=all&settle=4000");
    await page.waitForFunction(() => document.querySelector("[data-testid=preview]").dataset.live === "no", null, { timeout: 15000 });
    const on = await saveSvg(page, "on.svg");
    await page.click("[data-testid=zoom-in]");
    await page.waitForFunction(() => document.querySelector("[data-testid=preview]").dataset.live === "yes", null, { timeout: 5000 });
    const during = await saveSvg(page, "during.svg");
    check("the preview was showing while that figure was saved", (await live(page)) === "yes");
    await page.waitForFunction(() => document.querySelector("[data-testid=preview]").dataset.live === "no", null, { timeout: 15000 });
    const after = await saveSvg(page, "after.svg");
    check("saved SVG while the preview shows = saved SVG after it settles", during === after, `${during.length} bytes`);
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true))); // unfold "Large structures"
    await page.uncheck("[data-testid=smooth]");
    const off = await saveSvg(page, "off.svg");
    check("saved SVG with the preview switched off = with it on (same zoomed view)", off === after);
    await page.click("[data-testid=zoom-reset]");
    await page.waitForTimeout(300);
    check("saved SVG, fitted view: preview off = preview on", (await saveSvg(page, "off-fit.svg")) === on);
    check("the saved figure holds the structure (not the empty stand-in)", (on.match(/<circle /g) || []).length > 40);
    await page.close();
  }

  // 2. The two pictures of one view.
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    await setUp(page, "?preview=all&settle=2500");
    await page.uncheck("label.check input"); // white background
    await page.click("[data-testid=tab-visual]");
    await page.uncheck("[data-testid=show-cell]");
    await page.waitForTimeout(3000);
    const box = await page.locator(".figure-wrap").boundingBox();
    const clip = { x: box.x + 40, y: box.y + 40, width: box.width - 80, height: box.height * 0.74 };
    await page.click("[data-testid=zoom-out]");
    await page.waitForFunction(() => document.querySelector("[data-testid=preview]").dataset.live === "yes", null, { timeout: 5000 });
    await page.waitForTimeout(300);
    const gpu = (await page.screenshot({ clip })).toString("base64");
    await page.waitForFunction(() => document.querySelector("[data-testid=preview]").dataset.live === "no", null, { timeout: 8000 });
    await page.waitForTimeout(200);
    const svg = (await page.screenshot({ clip })).toString("base64");
    fs.writeFileSync(path.join(tmp, "preview.png"), Buffer.from(gpu, "base64"));
    fs.writeFileSync(path.join(tmp, "vector.png"), Buffer.from(svg, "base64"));
    console.log(`     pictures kept in ${tmp}`);
    const cmp = await page.evaluate(async ([a, c]) => {
      const load = (b64) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + b64; });
      const px = (img) => { const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height; const x = cv.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
      const [da, dc] = [px(await load(a)), px(await load(c))];
      let both = 0, either = 0, colour = 0;
      for (let i = 0; i < da.length; i += 4) {
        const fa = da[i] + da[i + 1] + da[i + 2] < 735, fc = dc[i] + dc[i + 1] + dc[i + 2] < 735;
        if (fa || fc) either++;
        if (fa && fc) { both++; colour += (Math.abs(da[i] - dc[i]) + Math.abs(da[i + 1] - dc[i + 1]) + Math.abs(da[i + 2] - dc[i + 2])) / 3; }
      }
      return { overlap: both / either, colour: colour / both };
    }, [gpu, svg]);
    check("preview and vector figure cover the same pixels", cmp.overlap > 0.9, `overlap ${(cmp.overlap * 100).toFixed(1)} %`);
    // The difference left is at edges (the two are anti-aliased differently) and at bond ends (round in the SVG).
    // (The preview draws bonds as plain strokes, the figure as shaded, outlined rods: with many bonds that is most of the difference.)
    check("in nearly the same colours", cmp.colour < 22, `mean difference ${cmp.colour.toFixed(1)} of 255 over the shared pixels`);
    await page.close();
  }

  // 3. A browser that cannot draw in a worker.
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(() => { delete HTMLCanvasElement.prototype.transferControlToOffscreen; });
    await setUp(page, "?preview=all");
    const before = await page.innerHTML("[data-testid=layer-structure]");
    const fig = await page.locator("[data-testid=figure]").boundingBox();
    await page.mouse.move(fig.x + 300, fig.y + 300);
    await page.mouse.down();
    await page.mouse.move(fig.x + 380, fig.y + 330, { steps: 4 });
    const midDrag = await page.innerHTML("[data-testid=layer-structure]");
    await page.mouse.up();
    check("no worker drawing: the figure still turns, redrawn as SVG during the drag", midDrag !== before);
    check("no worker drawing: the page says so", (await page.locator("[data-testid=preview-failed]").count()) === 1);
    check("no worker drawing: no page error", errors.length === 0, errors.join("; "));
    check("no worker drawing: Save still works", (await saveSvg(page, "nogpu.svg")).includes("<circle"));
    await page.close();
  }

  // 4. No endless update loop: each feature example opens, turns and zooms with no error in the console
  //    (a size-on-paper object rebuilt on every render once made React re-render until it gave up).
  {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 80)); });
    await page.goto(URL_BASE);
    const names = await page.evaluate(() => [...document.querySelectorAll("[data-testid^=feature-]")].map((e) => e.dataset.testid));
    for (const id of names) {
      await page.goto(URL_BASE);
      await page.click(`[data-testid="${id}"]`);
      await page.waitForTimeout(1200);
      const fig = await page.locator("[data-testid=figure]").boundingBox();
      await page.mouse.move(fig.x + fig.width / 2, fig.y + fig.height / 2);
      await page.mouse.down();
      await page.mouse.move(fig.x + fig.width / 2 + 60, fig.y + fig.height / 2 + 20, { steps: 5 });
      await page.mouse.up();
      await page.keyboard.press("+");
      await page.waitForTimeout(400);
    }
    check(`feature examples (${names.length}) open, turn and zoom with no console error`, names.length >= 5 && errors.length === 0, [...new Set(errors)].join("; "));
    await page.close();
  }

  await browser.close();
  console.log(failures === 0 ? "all browser checks passed" : `${failures} browser check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
