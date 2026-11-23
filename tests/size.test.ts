// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { readFileSync } from "node:fs";
import { crc32 as zlibCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, withResolution } from "../src/render/png";
import { AXES_FONT, AXIS_LENGTH, axisArrows, BAND, bandHeight, DEFAULT_CANVAS, LEGEND_FONT, legendLayout, ptPerUnit, renderSvg, structureHeight, type Canvas } from "../src/render/svg";
import { DEFAULT_VIEW } from "../src/render/view";
import { buildScene, DEFAULT_SPEC } from "../src/scene/scene";
import { readCif } from "../src/structure/readCif";

const halite = readCif(readFileSync("examples/halite-NaCl_COD-9008678.cif", "utf8"));
// 8.5 cm x 6.5 cm, drawn 1440 units wide: 1 unit = 8.5 / 2.54 * 72 / 1440 pt.
const paper: Canvas = { ...DEFAULT_CANVAS, height: (1440 * 6.5) / 8.5, physical: { width: 8.5, height: 6.5, unit: "cm" } };
const unitPt = ((8.5 / 2.54) * 72) / 1440;
const sizes = (svg: string, cls: string): number[] =>
  [...svg.matchAll(new RegExp(`<text class="${cls}"[^>]*font-size="([\\d.]+)"`, "g"))].map((m) => Number(m[1]));
const axisSizes = (svg: string): number[] => [...svg.matchAll(/font-style="italic" font-size="([\d.]+)"/g)].map((m) => Number(m[1]));

describe("size on paper", () => {
  it("the SVG states the size in cm, and its drawing has the same shape", () => {
    const svg = renderSvg(buildScene(halite), DEFAULT_VIEW, paper);
    const head = /<svg [^>]*width="([^"]+)" height="([^"]+)" viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!;
    expect([head[1], head[2]]).toEqual(["8.5cm", "6.5cm"]);
    expect(Number(head[4]) / Number(head[3])).toBeCloseTo(6.5 / 8.5, 9);
  });

  it("pt per unit is the physical width in pt over the drawing's width; without a size on paper 1 px = 1 pt", () => {
    expect(ptPerUnit(paper)).toBeCloseTo(unitPt, 12);
    expect(ptPerUnit({ ...paper, physical: { width: 3.5, height: 2, unit: "in" } })).toBeCloseTo((3.5 * 72) / 1440, 12);
    expect(ptPerUnit(DEFAULT_CANVAS)).toBe(1);
  });

  it("a text size in pt is that size in the saved figure: legend 9 pt, axis letters 8 pt", () => {
    const scene = buildScene(halite, { ...DEFAULT_SPEC, legendFontPt: 9, axesFontPt: 8 });
    const svg = renderSvg(scene, DEFAULT_VIEW, paper);
    const legend = sizes(svg, "legend");
    expect(legend.length).toBe(2);
    for (const s of legend) expect(s * unitPt).toBeCloseTo(9, 1); // the SVG keeps one decimal of a unit
    const axes = axisSizes(svg);
    expect(axes.length).toBeGreaterThan(0);
    for (const s of axes) expect(s * unitPt).toBeCloseTo(8, 1);
  });

  it("a text size in pt does not change with the legend or axes size, or with the paper size", () => {
    const spec = { ...DEFAULT_SPEC, legendFontPt: 9, axesFontPt: 8 };
    const a = renderSvg(buildScene(halite, spec), DEFAULT_VIEW, paper);
    const b = renderSvg(buildScene(halite, { ...spec, legendSize: 0.5, axesSize: 1.6 }), DEFAULT_VIEW, paper);
    expect(sizes(b, "legend")).toEqual(sizes(a, "legend"));
    expect(axisSizes(b)).toEqual(axisSizes(a));
    const wide: Canvas = { ...DEFAULT_CANVAS, height: (1440 * 6.5) / 17, physical: { width: 17, height: 6.5, unit: "cm" } };
    const c = renderSvg(buildScene(halite, spec), DEFAULT_VIEW, wide);
    for (const s of sizes(c, "legend")) expect(s * ptPerUnit(wide)).toBeCloseTo(9, 1);
  });

  it("without a text size the figure is as before: legend 92 units, axis letters 76", () => {
    const svg = renderSvg(buildScene(halite), DEFAULT_VIEW, DEFAULT_CANVAS);
    expect(sizes(svg, "legend")).toEqual([92, 92]);
    expect(new Set(axisSizes(svg))).toEqual(new Set([76]));
  });
});

describe("legend and axes follow their text size in pt", () => {
  it("at 7 pt the largest legend sphere keeps its designed ratio to the text (44 : 92), and the axes theirs (140 : 76)", () => {
    const scene = buildScene(halite, { ...DEFAULT_SPEC, legendFontPt: 7, axesFontPt: 7 });
    const items = legendLayout(scene, paper, 1e9);
    const largest = Math.max(...items.map((i) => i.r));
    expect(items[0]!.fontSize * unitPt).toBeCloseTo(7, 9);
    expect(largest / items[0]!.fontSize).toBeCloseTo(44 / LEGEND_FONT, 9);
    // An axis lying in the screen plane: its full length relative to the letters.
    const fontUnits = 7 / unitPt;
    const longest = Math.max(...axisArrows(scene, DEFAULT_VIEW, paper).map((a) => Math.hypot(a.dx, a.dy)));
    expect(longest).toBeLessThanOrEqual((AXIS_LENGTH * fontUnits) / AXES_FONT + 1e-9);
    expect(longest).toBeGreaterThan(0.5 * (AXIS_LENGTH * fontUnits) / AXES_FONT);
  });

  it("the band under the structure shrinks with them, and the structure gets the room", () => {
    const usual = buildScene(halite);
    const small = buildScene(halite, { ...DEFAULT_SPEC, legendFontPt: 7, axesFontPt: 7 });
    expect(bandHeight(usual, paper)).toBe(BAND);
    const k = Math.max(7 / unitPt / LEGEND_FONT, 7 / unitPt / AXES_FONT);
    expect(bandHeight(small, paper)).toBeCloseTo(BAND * k, 9);
    expect(structureHeight(small, paper)).toBeGreaterThan(structureHeight(usual, paper));
  });
});

describe("PNG resolution", () => {
  it("CRC-32 agrees with zlib's", () => {
    for (const text of ["IEND", "pHYs", "MOTIF"]) {
      const bytes = new TextEncoder().encode(text);
      expect(crc32(bytes)).toBe(zlibCrc32(bytes));
    }
  });

  it("puts a pHYs chunk of 300 dpi (11811 px per metre) right after the header", () => {
    const chunk = (type: string, data: number[]): number[] => {
      const body = [...new TextEncoder().encode(type), ...data];
      const n = data.length;
      const c = crc32(Uint8Array.from(body));
      return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...body, c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255];
    };
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", new Array(13).fill(0)), ...chunk("IEND", [])]);
    const out = withResolution(png, 300);
    const at = 8 + 25; // signature, then IHDR (12 + 13 bytes)
    const view = new DataView(out.buffer);
    expect(new TextDecoder().decode(out.subarray(at + 4, at + 8))).toBe("pHYs");
    expect([view.getUint32(at + 8), view.getUint32(at + 12), out[at + 16]]).toEqual([11811, 11811, 1]);
    expect(view.getUint32(at + 17)).toBe(zlibCrc32(out.subarray(at + 4, at + 17)));
    expect(new TextDecoder().decode(out.subarray(out.length - 8, out.length - 4))).toBe("IEND");
    // An existing pHYs is replaced, not doubled.
    const again = withResolution(out, 600);
    expect(again.length).toBe(out.length);
  });
});
