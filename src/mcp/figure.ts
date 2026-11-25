// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * One figure outside the browser: the state the page keeps for the figure shown (App.tsx) and the same pure code
 * to turn it into an SVG (structure -> scene -> renderer). The MCP server holds one of these.
 *
 * The user's choice (2026-11-25, "A"): this module mirrors the page's state and defaults; App.tsx is not changed.
 * The two must not drift: scripts/browser_check.cjs saves the SVG of olivine and of every feature example from
 * the page and from the server and requires them to be byte for byte the same. A new page setting that changes
 * the saved figure must be added here too, or that check fails.
 *
 * What the browser gives the page and a server cannot have: the frame's shape (a canvas without a size on paper
 * is 1440 x 1100 here unless a shape is chosen), the zoom (none here), and a font's measured capital height (a
 * journal that states its capitals in mm uses 0.72 of the font size here, the page's own fallback).
 *
 * It implements the assistant's `Page` (agent/tools.ts), so the in-page assistant's tools and their checks and
 * answers are reused as they are.
 */

import { directAxes, lowIndexDirections, nearestDirection, numbersFromView, openingNumbers, presetView, VIEW_PRESETS, directionVector, viewAlong, viewFromNumbers, writeDirection, writeView, type Axis, type Direction, type ViewPreset } from "../render/camera";
import { DEFAULT_CANVAS, fitView, renderSvg, steadyFit, type Canvas, type PhysicalSize } from "../render/svg";
import type { View } from "../render/view";
import { buildScene, DEFAULT_DISPLACEMENT_COLOUR, DEFAULT_DISPLACEMENT_LENGTH, DEFAULT_DISPLACEMENT_THICKNESS, DEFAULT_MOMENT_TAIL, DEFAULT_ORBITAL_COLOURS, DEFAULT_ORBITAL_OPACITY, DEFAULT_ORBITAL_SIZE, DEFAULT_SPEC, DEFAULT_STICK, largestDisplacement, largestMoment, MATERIALS, type ArrowStyle, type Look, type OrbitalRule, type Scene } from "../scene/scene";
import { DEFAULT_ISO } from "../scene/orbitals";
import { DEFAULT_ANGLE_LOOK, type AngleRule } from "../scene/angles";
import { suggestBonds } from "../scene/autoBonds";
import { pairDistances, type BondRule } from "../scene/bonds";
import type { Range } from "../scene/select";
import { expandToUnitCell } from "../structure/expand";
import { withDisplacements } from "../structure/distortion";
import { withHandMoments, type MomentRule } from "../structure/handMoments";
import { readStructure } from "../structure/readStructure";
import { FORMATS, writeStructure, type StructureFormat } from "../structure/writeStructure";
import type { Structure } from "../structure/types";
import { splitPair, type BondChange, type FigureState, type Page, type ViewRequest } from "../agent/tools";
import { describeJournal, journalSize, journalTextPt, matchJournal, partWidth, type PartId } from "../ui/journals";
import type { FeatureExample } from "../ui/examples";
import { coloursOf, isBool, isColour, isNumber, isText, oneOf, textRecord, textsOf } from "../ui/settings";

// ---- The page's constants (App.tsx), repeated here; the parity check holds them together.
const ONE_CELL_TEXT = ["0", "0", "0", "1", "1", "1"];
/** The page draws the preview from this many atoms and bonds (preview/usePreview.ts, PREVIEW_FROM). */
const PREVIEW_FROM = 1200;
/** A release within this many degrees of a low-index direction names it under the figure. */
const SNAP_DEGREES = 4;
const SIMPLE_DIRECTIONS = lowIndexDirections(1);
/** A font's capital height as a fraction of its size, when it cannot be measured (the page's fallback). */
const CAP_HEIGHT = 0.72;
/** Shapes of the canvas, width : height (App.tsx, ASPECTS). */
const ASPECTS: Readonly<Record<string, number | null>> = { free: null, "1:1": 1, "5:4": 5 / 4, "4:3": 4 / 3, "3:2": 3 / 2, A: Math.SQRT2, "16:10": 16 / 10, "16:9": 16 / 9, "2:1": 2 };
const short = (x: number): string => `${+x.toFixed(3)}`;

/** Every setting the page keeps (App.tsx, settingFields, except saved views and element looks), with its default. */
export function defaultSettings(): Record<string, unknown> {
  return {
    atomMaterial: DEFAULT_SPEC.atomMaterial,
    bondMaterial: DEFAULT_SPEC.bondMaterial,
    arrowMaterial: DEFAULT_SPEC.arrowMaterial,
    glassOpacity: DEFAULT_SPEC.glassOpacity,
    bondOutline: DEFAULT_SPEC.bondOutline,
    momentOutline: DEFAULT_SPEC.momentOutline,
    axesOutline: DEFAULT_SPEC.axesOutline,
    showVacancy: true,
    momentColour: DEFAULT_SPEC.momentColour,
    momentLength: String(DEFAULT_SPEC.momentLength),
    momentTail: String(Math.round(DEFAULT_MOMENT_TAIL * 100)),
    momentThickness: String(DEFAULT_SPEC.momentThickness),
    arrowHead: "1",
    displacementLength: String(DEFAULT_DISPLACEMENT_LENGTH),
    displacementColour: DEFAULT_DISPLACEMENT_COLOUR,
    displacementThickness: String(DEFAULT_DISPLACEMENT_THICKNESS),
    showCell: true,
    cellStyle: DEFAULT_SPEC.cellStyle,
    cellWidth: String(DEFAULT_SPEC.cellWidth),
    showLegend: true,
    legendFollows: DEFAULT_SPEC.legendFollowsZoom,
    legendSize: "1",
    showAxes: true,
    axesSize: "1",
    axesHead: "1",
    axesReadable: DEFAULT_SPEC.axesKeepReadable,
    axesColoured: DEFAULT_SPEC.axesColoured,
    axesColours: DEFAULT_SPEC.axesColours,
    fontFamily: DEFAULT_SPEC.fontFamily,
    customFont: false,
    letterWeight: DEFAULT_SPEC.letterWeight,
    // Nature asks for 5 to 7 pt (the user's choice, 2026-11-23).
    textSizes: { legend: "7", axes: "7", angle: "7" },
    // A Nature single column, 89 mm wide, 4:3 (the user's choice, 2026-11-23).
    canvasFixed: true,
    canvasUnit: "cm",
    canvasSize: ["8.9", "6.675"],
    aspect: "4:3",
    portrait: false,
    dpi: "300",
    transparent: true,
    pngWidth: 2880,
    saveZoomed: true,
    scaleMode: "outline",
    fixedScale: "60",
    dragMode: "turntable",
    snap: true,
    animate: true,
    keepView: false,
    smooth: true,
    previewFrom: String(PREVIEW_FROM),
    showControls: true,
    repeatBoundary: true,
    autoBonds: true,
  };
}

const isMaterial = oneOf(...MATERIALS);
/** The values each setting accepts, as the page checks them (App.tsx, settingFields). */
const VALID: Readonly<Record<string, (v: unknown) => boolean>> = {
  atomMaterial: isMaterial,
  bondMaterial: isMaterial,
  arrowMaterial: isMaterial,
  glassOpacity: (v) => isNumber(v) && (v as number) >= 0.05 && (v as number) <= 1,
  bondOutline: isBool,
  momentOutline: isBool,
  axesOutline: isBool,
  showVacancy: isBool,
  momentColour: isColour,
  momentLength: isText,
  momentTail: isText,
  momentThickness: isText,
  arrowHead: isText,
  displacementLength: isText,
  displacementColour: isColour,
  displacementThickness: isText,
  showCell: isBool,
  cellStyle: oneOf("depth", "dashed", "solid"),
  cellWidth: isText,
  showLegend: isBool,
  legendFollows: isBool,
  legendSize: isText,
  showAxes: isBool,
  axesSize: isText,
  axesHead: isText,
  axesReadable: isBool,
  axesColoured: isBool,
  axesColours: coloursOf(3),
  fontFamily: isText,
  customFont: isBool,
  letterWeight: oneOf(400, 500, 800),
  textSizes: textRecord(["legend", "axes", "angle"]),
  canvasFixed: isBool,
  canvasUnit: oneOf("cm", "in"),
  canvasSize: textsOf(2),
  aspect: oneOf(...Object.keys(ASPECTS)),
  portrait: isBool,
  dpi: isText,
  transparent: isBool,
  pngWidth: (v) => isNumber(v) && (v as number) >= 100 && (v as number) <= 16000,
  saveZoomed: isBool,
  scaleMode: oneOf("outline", "steady", "fixed"),
  fixedScale: isText,
  dragMode: oneOf("turntable", "free"),
  snap: isBool,
  animate: isBool,
  keepView: isBool,
  smooth: isBool,
  previewFrom: isText,
  showControls: isBool,
  repeatBoundary: isBool,
  autoBonds: isBool,
};
export const SETTING_NAMES: readonly string[] = Object.keys(VALID);

type Rule = BondRule & { maxText: string; widthText?: string };
type AngleState = AngleRule & { minText: string; maxText: string; radiusText: string; opacityText: string };
interface LookState {
  colour?: string;
  radiusText?: string;
  hidden?: boolean;
}
interface OrbitalState {
  species: string;
  orbitals: string[];
  sizeText: string;
  colours: [string, string];
  zMode?: "longest" | "bridge";
  zNeighbour?: string;
}

/** The figure's state, and the page's operations on it. */
export class Figure implements Page {
  private settings: Record<string, unknown> = defaultSettings();
  private structure: Structure | null = null;
  private fileName = "";
  private view: View = viewFromNumbers(directAxes({ a: 1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 90 }), { up: 2, turn: 0, tilt: 0, roll: 0 });
  private upAxis: Axis = 2;
  private rangeText: string[] = [...ONE_CELL_TEXT];
  private rules: Rule[] = [];
  private looks: Record<string, LookState> = {};
  private angleRules: AngleState[] = [];
  private orbitalRules: OrbitalState[] = [];
  private momentRules: readonly MomentRule[] | null = null;
  private showMoments = true;
  private modesOn: boolean[] = [];
  private journalChoice = "";
  private journalPart: PartId = "1";
  private lastPhysical: PhysicalSize = { width: 8.9, height: 6.675, unit: "cm" };
  private lastNumbers = { up: 2 as Axis, turn: 0, tilt: 0, roll: 0 };
  private cache: { key: unknown[]; scene: Scene } | null = null;

  // ---- Opening

  /** Open a structure file as the page does when one is opened by hand; an RMC file whole unless `fold`. */
  open(text: string, name: string, fold = false): Structure {
    const read = readStructure(text, name, { fold });
    buildScene(read); // fail here, with a message, rather than while drawing
    if (this.structure) this.lastNumbers = numbersFromView(directAxes(this.structure.cell), this.view, this.upAxis);
    const keepView = this.settings["keepView"] === true;
    const opening = directAxes(read.cell);
    this.structure = read;
    this.fileName = name;
    this.view = viewFromNumbers(opening, keepView ? this.lastNumbers : openingNumbers(opening));
    this.rangeText = [...ONE_CELL_TEXT];
    this.settings["showCell"] = !read.molecule;
    const suggested = this.settings["autoBonds"] === true ? suggestBonds(read) : [];
    this.rules = suggested.map((r) => ({ ...r, maxText: String(r.max) }));
    this.looks = {};
    this.angleRules = [];
    this.orbitalRules = [];
    this.momentRules = null;
    this.showMoments = true;
    this.modesOn = read.distortion?.modes.map(() => true) ?? [];
    if (!keepView) this.upAxis = 2;
    this.cache = null;
    return read;
  }

  /** Open a feature example with the settings that show its feature (App.tsx, loadFeature). */
  openFeature(f: FeatureExample, text: string): Structure {
    const read = this.open(text, f.file, f.fold ?? false);
    if (f.along) {
      const towards = directionVector(read.cell, { kind: "uvw", indices: [...f.along] as [number, number, number] });
      const target = directAxes(read.cell).slice().reverse().map((up) => viewAlong(towards, up)).find((v) => v !== null);
      if (target) this.view = target;
    }
    if (f.cells) this.rangeText = f.cells.map(String);
    if (f.completeBonds === false) this.rules = this.rules.map((r) => ({ ...r, complete: false }));
    if (f.hide) for (const k of f.hide) this.looks[k] = { ...this.looks[k], hidden: true };
    for (const p of f.polyhedra ?? []) {
      this.rules = this.rules.some((r) => r.centre === p.centre && r.neighbour === p.neighbour)
        ? this.rules.map((r) => (r.centre === p.centre && r.neighbour === p.neighbour ? { ...r, polyhedra: true } : r))
        : [...this.rules, { centre: p.centre, neighbour: p.neighbour, max: p.upTo, maxText: String(p.upTo), complete: true, polyhedra: true }];
    }
    if (f.orbitals) {
      this.orbitalRules = f.orbitals.map((o) => ({
        species: o.species,
        orbitals: [...o.orbitals],
        sizeText: String(o.size ?? DEFAULT_ORBITAL_SIZE),
        colours: [...(o.colours ?? DEFAULT_ORBITAL_COLOURS)] as [string, string],
        ...(o.zFrom ? { zMode: o.zFrom.mode, zNeighbour: o.zFrom.neighbour } : {}),
      }));
    }
    this.cache = null;
    return read;
  }

  // ---- What is drawn

  private setting<T>(name: string): T {
    return this.settings[name] as T;
  }

  /** The structure as drawn: with the displacements of the modes switched on and the moments added by hand. */
  private drawnStructure(): Structure | null {
    const s = this.structure;
    const base = s?.distortion && this.modesOn.length === s.distortion.modes.length ? withDisplacements(s, this.modesOn) : s;
    if (!base || !this.momentRules) return base;
    try {
      return withHandMoments(base, this.momentRules).structure;
    } catch {
      return base;
    }
  }

  private range(): Range | null {
    const v = this.rangeText.map((t) => (t.trim() === "" ? NaN : Number(t)));
    if (v.some((x) => !Number.isFinite(x))) return null;
    return { from: [v[0]!, v[1]!, v[2]!], to: [v[3]!, v[4]!, v[5]!], boundary: this.setting<boolean>("repeatBoundary") ? "both" : "once" };
  }

  private sceneLooks(): Record<string, Look> {
    const out: Record<string, Look> = {};
    for (const [key, look] of Object.entries(this.looks)) {
      const radius = Number(look.radiusText);
      out[key] = {
        ...(look.hidden ? { hidden: true } : {}),
        ...(look.colour !== undefined ? { colour: look.colour } : {}),
        ...(look.radiusText !== undefined && look.radiusText.trim() !== "" && radius >= 0.05 && radius <= 5 ? { radius } : {}),
      };
    }
    return out;
  }

  /** The scene, built as the page builds it (App.tsx, the `scene` memo). Throws when the cells shown are unusable. */
  scene(): Scene {
    const structure = this.structure;
    if (!structure) throw new Error("No structure is open.");
    const key = [JSON.stringify(this.settings), this.rangeText.join(" "), JSON.stringify(this.rules), JSON.stringify(this.looks), JSON.stringify(this.angleRules), JSON.stringify(this.orbitalRules), JSON.stringify(this.momentRules), this.showMoments, this.modesOn.join()];
    if (this.cache && this.cache.key.every((k, i) => k === key[i])) return this.cache.scene;
    const range = this.range();
    if (!range) throw new Error("Fill in all six limits of the cells shown.");
    const s = this.settings;
    const text = (name: string): number => Number(s[name]);
    const sizeOf = (name: string): number => (text(name) >= 0.2 && text(name) <= 4 ? text(name) : 1);
    const fontPt = (t: string): number | null => {
      const x = Number(t);
      return t.trim() !== "" && Number.isFinite(x) && x >= 1 && x <= 400 ? x : null;
    };
    const pt = s["textSizes"] as { legend: string; axes: string; angle: string };
    const bonds = this.rules
      .filter((r) => r.max > 0.1 && r.max <= 10)
      .map((r) => {
        const width = Number(r.widthText);
        return r.widthText !== undefined && width >= 0.02 && width <= 2 ? { ...r, width } : r;
      });
    const angles = this.angleRules.map((r): AngleRule => {
      const num = (t: string, lo: number, hi: number, fallback: number): number => (t.trim() !== "" && Number(t) >= lo && Number(t) <= hi ? Number(t) : fallback);
      return {
        centre: r.centre,
        ends: r.ends,
        min: num(r.minText, 0, 180, 0),
        max: num(r.maxText, 0, 180, 180),
        colour: r.colour ?? DEFAULT_ANGLE_LOOK.colour,
        opacity: num(r.opacityText, 0.05, 1, DEFAULT_ANGLE_LOOK.opacity),
        radius: num(r.radiusText, 0.1, 5, DEFAULT_ANGLE_LOOK.radius),
        label: r.label ?? DEFAULT_ANGLE_LOOK.label,
      };
    });
    const orbitals = this.orbitalRules.map((r): OrbitalRule => ({
      species: r.species,
      orbitals: r.orbitals,
      size: Number(r.sizeText) > 0 && Number(r.sizeText) <= 20 ? Number(r.sizeText) : DEFAULT_ORBITAL_SIZE,
      colours: r.colours,
      opacity: DEFAULT_ORBITAL_OPACITY,
      iso: DEFAULT_ISO,
      texture: "soft",
      z: null,
      x: null,
      ...(r.zMode && r.zNeighbour ? { zFrom: { neighbour: r.zNeighbour, mode: r.zMode } } : {}),
    }));
    const arrowStyle: ArrowStyle | null = largestMoment(structure) > 0 ? "moment" : largestDisplacement(structure) > 0 ? "displacement" : null;
    const scene = buildScene(this.drawnStructure() ?? structure, {
      range,
      bonds,
      showCell: s["showCell"] as boolean,
      looks: this.sceneLooks(),
      showVacancy: s["showVacancy"] as boolean,
      angles,
      ...(orbitals.length ? { orbitals } : {}),
      showMoments: this.showMoments,
      showDisplacements: true,
      displacementLength: text("displacementLength") > 0 && text("displacementLength") <= 20 ? text("displacementLength") : DEFAULT_DISPLACEMENT_LENGTH,
      displacementColour: s["displacementColour"] as string,
      displacementThickness: text("displacementThickness") >= 0.02 && text("displacementThickness") <= 2 ? text("displacementThickness") : DEFAULT_DISPLACEMENT_THICKNESS,
      ...(arrowStyle ? { arrowStyle } : {}),
      momentTail: text("momentTail") >= 20 && text("momentTail") <= 100 ? text("momentTail") / 100 : DEFAULT_MOMENT_TAIL,
      momentLength: text("momentLength") > 0 && text("momentLength") <= 20 ? text("momentLength") : DEFAULT_SPEC.momentLength,
      momentColour: s["momentColour"] as string,
      momentThickness: text("momentThickness") >= 0.02 && text("momentThickness") <= 2 ? text("momentThickness") : DEFAULT_SPEC.momentThickness,
      momentHeadSize: sizeOf("arrowHead"),
      axesHeadSize: sizeOf("axesHead"),
      axesColoured: s["axesColoured"] as boolean,
      axesColours: s["axesColours"] as [string, string, string],
      momentOutline: s["momentOutline"] as boolean,
      axesOutline: s["axesOutline"] as boolean,
      axesKeepReadable: s["axesReadable"] as boolean,
      atomMaterial: s["atomMaterial"] as never,
      arrowMaterial: s["arrowMaterial"] as never,
      bondMaterial: s["bondMaterial"] as never,
      bondOutline: s["bondOutline"] as boolean,
      cellStyle: s["cellStyle"] as never,
      cellWidth: text("cellWidth") >= 0.5 && text("cellWidth") <= 12 ? text("cellWidth") : DEFAULT_SPEC.cellWidth,
      glassOpacity: s["glassOpacity"] as number,
      letterWeight: s["letterWeight"] as number,
      fontFamily: s["fontFamily"] as string,
      legendFollowsZoom: s["legendFollows"] as boolean,
      legendSize: sizeOf("legendSize"),
      axesSize: sizeOf("axesSize"),
      legendFontPt: fontPt(pt.legend),
      axesFontPt: fontPt(pt.axes),
      angleFontPt: fontPt(pt.angle),
      showLegend: s["showLegend"] as boolean,
      showAxes: s["showAxes"] as boolean,
    });
    this.cache = { key, scene };
    return scene;
  }

  private ratio(): number | null {
    const r = ASPECTS[this.setting<string>("aspect")] ?? null;
    return r === null ? null : this.setting<boolean>("portrait") ? 1 / r : r;
  }

  /** The canvas: 1440 units wide; a size on paper gives its shape, else the chosen shape, else 1440 x 1100. */
  canvas(): Canvas {
    const [w, h] = this.setting<[string, string]>("canvasSize").map(Number) as [number, number];
    const unit = this.setting<"cm" | "in">("canvasUnit");
    const [lo, hi] = unit === "cm" ? [1, 100] : [0.4, 40];
    // While a size is unusable the canvas keeps the last usable one, as on the page.
    if ([w, h].every((x) => Number.isFinite(x) && x >= lo && x <= hi) && h / w >= 0.2 && h / w <= 5) {
      const was = this.lastPhysical;
      if (was.width !== w || was.height !== h || was.unit !== unit) this.lastPhysical = { width: w, height: h, unit };
    }
    const physical = this.setting<boolean>("canvasFixed") ? this.lastPhysical : null;
    const width = DEFAULT_CANVAS.width;
    const ratio = this.ratio();
    const height = physical ? Number(((width * physical.height) / physical.width).toFixed(2)) : ratio !== null ? Number((width / ratio).toFixed(2)) : DEFAULT_CANVAS.height;
    return { ...DEFAULT_CANVAS, width, height, physical: physical ?? undefined };
  }

  /** The figure as the page saves it ("Save" › SVG, nothing zoomed). */
  svg(): string {
    const scene = this.scene();
    const canvas = this.canvas();
    const mode = this.setting<string>("scaleMode");
    const fixed = Number(this.settings["fixedScale"]);
    const fixedScale = fixed >= 2 && fixed <= 1000 ? fixed : 60;
    const fit = mode === "outline" ? fitView(scene, this.view, canvas) : steadyFit(scene, canvas, mode === "fixed" ? fixedScale : undefined);
    return renderSvg(scene, this.view, { ...canvas, background: this.setting<boolean>("transparent") ? null : "#ffffff" }, fit);
  }

  /** The base of a saved file's name: the file opened, without its extension. */
  baseName(): string {
    return this.fileName.replace(/\.[^.]+$/, "") || "motif";
  }

  /** The structure's unit cell as a file (P1), as the page saves it. */
  structureFile(format: StructureFormat, fileName?: string): { name: string; text: string; applied: string } {
    const drawn = this.drawnStructure();
    if (!drawn) throw new Error("No structure is open.");
    const base = (fileName || this.structure!.name || "structure").replace(/\.(cif|vasp|poscar|xyz|extxyz)$/i, "").replace(/[^A-Za-z0-9_.-]+/g, "_");
    const written = writeStructure(drawn, format, base);
    const name = FORMATS.find((f) => f.id === format)!.file(base);
    return { name, text: written.text, applied: `${name}: ${written.atoms} atoms of one unit cell, no symmetry${written.notes.length ? `; ${written.notes.join("; ")}` : ""}` };
  }

  // ---- The page's view of itself, for the assistant's tools (App.tsx, pageNow)

  private species(): string[] {
    if (!this.structure) return [];
    return [...new Set(expandToUnitCell(this.structure).atoms.map((a) => a.species))];
  }

  private pairs(): { centre: string; neighbour: string; distances: number[] }[] {
    const structure = this.structure;
    if (!structure) return [];
    const elements = this.species();
    const out: { centre: string; neighbour: string; distances: number[] }[] = [];
    elements.forEach((centre, i) => {
      for (const neighbour of elements.slice(i)) {
        const distances = pairDistances(structure, centre, neighbour);
        if (distances.length) out.push({ centre, neighbour, distances });
      }
    });
    return out.sort((p, q) => p.distances[0]! - q.distances[0]!);
  }

  private ruleIndex(between: string): number {
    const pair = splitPair(between);
    if (!pair) return -1;
    return this.rules.findIndex((r) => (r.centre === pair[0] && r.neighbour === pair[1]) || (r.centre === pair[1] && r.neighbour === pair[0]));
  }

  private sceneRule(index: number): number {
    return this.rules.slice(0, index).filter((r) => r.max > 0.1 && r.max <= 10).length;
  }

  private changed(): void {
    this.cache = null;
  }

  hasStructure(): boolean {
    return this.structure !== null;
  }

  describe(): FigureState {
    const structure = this.structure!;
    const c = structure.cell;
    let scene: Scene | null = null;
    try {
      scene = this.scene();
    } catch {
      scene = null;
    }
    const species = scene ? [...new Set(scene.spheres.map((x) => x.style))] : [];
    const axes = directAxes(c);
    const numbers = numbersFromView(axes, this.view, this.upAxis);
    const near = nearestDirection(c, this.view);
    const named = near.angle <= SNAP_DEGREES ? near : nearestDirection(c, this.view, SIMPLE_DIRECTIONS);
    const viewLine = `${writeView(numbers)}${named.angle < 0.05 ? ` · along ${writeDirection(named.direction)}` : ` · ${named.angle.toFixed(1)}° from ${writeDirection(named.direction)}`}`;
    const canvas = this.canvas();
    const journal = journalSize(this.journalChoice);
    const rangeText = this.rangeText;
    return {
      file: this.fileName,
      format: structure.format ?? "",
      cell: `a ${c.a.toFixed(4)}, b ${c.b.toFixed(4)}, c ${c.c.toFixed(4)} Å; α ${c.alpha.toFixed(2)}, β ${c.beta.toFixed(2)}, γ ${c.gamma.toFixed(2)}°`,
      elements: [...new Set([...this.species(), ...species])].map((key) => ({
        element: key,
        count: scene ? scene.spheres.filter((x) => x.style === key).length : 0,
        colour: scene?.styles[key]?.colour ?? "",
        radius: scene?.styles[key]?.radius ?? 0,
        hidden: this.looks[key]?.hidden === true,
      })),
      bonds: this.rules.map((r, i) => ({
        between: `${r.centre}–${r.neighbour}`,
        upTo: r.max,
        count: scene?.sticks.filter((s) => s.rule === this.sceneRule(i)).length ?? 0,
        colour: r.colour ?? DEFAULT_STICK.colour,
        thickness: r.width ?? DEFAULT_STICK.width,
        line: r.line ?? "solid",
        colouring: r.colouring === "atoms" ? "atom colours" : "one colour",
        fillTriangles: r.fill === true,
        ...(r.fill ? { triangleColour: r.fillColour ?? scene?.ruleInfo[this.sceneRule(i)]?.fillColour ?? "" } : {}),
        highlight: r.band === true,
        polyhedra: r.polyhedra ? (r.polyhedronLook === "line" ? "line art" : (r.polyhedronLook ?? "glass")) : "off",
        ...(r.polyhedra ? { polyhedronColour: r.polyhedronColour ?? scene?.polyhedra?.find((p) => p.rule === this.sceneRule(i))?.colour ?? "" } : {}),
      })),
      pairs: this.pairs().map((p) => ({ between: `${p.centre}–${p.neighbour}`, distances: p.distances.slice(0, 4).map((d) => Number(d.toFixed(3))) })),
      cells: `from ${rangeText.slice(0, 3).join(", ")} to ${rangeText.slice(3).join(", ")}`,
      view: viewLine,
      canvas: canvas.physical ? `${canvas.physical.width} × ${canvas.physical.height} ${canvas.physical.unit} on paper` : `${canvas.width} × ${canvas.height} px, no size on paper`,
      angles: scene
        ? `can be marked: ${scene.angleKinds.map((k) => `${k.ends[0]}–${k.centre}–${k.ends[1]} (${k.count}; ${[...new Set(k.sizes.map((x) => x.toFixed(1)))].slice(0, 6).join(", ")}°)`).join("; ") || "none (angles exist between drawn bonds)"}. Marked: ${this.angleRules.map((r) => `${r.ends[0]}–${r.centre}–${r.ends[1]} ${r.min}–${r.max}°`).join("; ") || "none"}`
        : "",
      moments: this.momentRules
        ? `added by hand: ${this.momentRules.map((r) => `${r.element}${r.where ? ` at ${r.where.axis} = ${r.where.at}` : ""} ${r.size} μB along [${r.along.join(" ")}]`).join("; ")}`
        : structure.sites.some((x) => x.moment)
          ? "from the file (a magnetic CIF)"
          : "none",
      journal: journal ? `${journal.journal}, ${journal.label}, ${this.journalPart} width` : "none",
      settings: { ...this.settings },
    };
  }

  applySettings(values: Record<string, unknown>): string[] {
    const skipped: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      const valid = VALID[key];
      if (valid && valid(value)) this.settings[key] = value;
      else skipped.push(key);
    }
    this.changed();
    return skipped;
  }

  setElement(element: string, change: { colour?: string; radius?: number; hidden?: boolean }): string | null {
    const keys = this.species();
    const key = keys.find((k) => k.toLowerCase() === element.trim().toLowerCase());
    if (!key) return `There is no ${element} in this structure (it has ${keys.join(", ")}).`;
    if (change.colour !== undefined && !/^#[0-9a-fA-F]{6}$/.test(change.colour)) return `"${change.colour}" is not a colour "#rrggbb".`;
    if (change.radius !== undefined && !(change.radius > 0.02 && change.radius <= 5)) return "The radius must be between 0.02 and 5 Å.";
    this.looks[key] = {
      ...this.looks[key],
      ...(change.colour !== undefined ? { colour: change.colour.toLowerCase() } : {}),
      ...(change.radius !== undefined ? { radiusText: String(change.radius) } : {}),
      ...(change.hidden !== undefined ? { hidden: change.hidden } : {}),
    };
    this.changed();
    return null;
  }

  addBonds(centre: string, neighbour: string, upTo: number): string | null {
    const pairs = this.pairs();
    const pair = pairs.find((p) => (p.centre === centre && p.neighbour === neighbour) || (p.centre === neighbour && p.neighbour === centre));
    if (!pair) return `${centre} and ${neighbour} are not a pair in this structure. Pairs: ${pairs.map((p) => `${p.centre}–${p.neighbour}`).join(", ")}.`;
    if (this.ruleIndex(`${centre}-${neighbour}`) >= 0) return `${pair.centre}–${pair.neighbour} bonds are already drawn; change them with change_bonds.`;
    if (upTo < pair.distances[0]! - 1e-9) return `The shortest ${pair.centre}–${pair.neighbour} distance is ${pair.distances[0]!.toFixed(3)} Å; ${upTo} Å would draw none.`;
    this.rules = [...this.rules, { centre: pair.centre, neighbour: pair.neighbour, max: upTo, maxText: String(upTo), complete: false }];
    this.changed();
    return null;
  }

  changeBonds(between: string, change: BondChange): string | null {
    const i = this.ruleIndex(between);
    if (i < 0) return `No ${between} bonds are drawn. Drawn: ${this.rules.map((r) => `${r.centre}–${r.neighbour}`).join(", ") || "none"}.`;
    for (const c of [change.colour, change.triangleColour, change.polyhedronColour]) if (c !== undefined && !/^#[0-9a-fA-F]{6}$/.test(c)) return `"${c}" is not a colour "#rrggbb".`;
    if (change.upTo !== undefined && !(change.upTo > 0.1 && change.upTo <= 10)) return "up_to must be between 0.1 and 10 Å.";
    if (change.thickness !== undefined && !(change.thickness > 0.005 && change.thickness <= 1)) return "The thickness must be between 0.005 and 1 Å.";
    const next: Partial<Rule> = {
      ...(change.upTo !== undefined ? { max: change.upTo, maxText: String(change.upTo) } : {}),
      ...(change.colour !== undefined ? { colour: change.colour.toLowerCase() } : {}),
      ...(change.thickness !== undefined ? { width: change.thickness, widthText: String(change.thickness) } : {}),
      ...(change.line !== undefined ? { line: change.line } : {}),
      ...(change.colouring !== undefined ? { colouring: change.colouring === "atom colours" ? ("atoms" as const) : ("single" as const) } : {}),
      ...(change.fillTriangles !== undefined ? { fill: change.fillTriangles } : {}),
      ...(change.triangleColour !== undefined ? { fill: true, fillColour: change.triangleColour.toLowerCase() } : {}),
      ...(change.highlight !== undefined ? { band: change.highlight } : {}),
      ...(change.polyhedra !== undefined ? { polyhedra: change.polyhedra } : {}),
      ...(change.polyhedronLook !== undefined ? { polyhedra: true, polyhedronLook: change.polyhedronLook === "line art" ? ("line" as const) : change.polyhedronLook } : {}),
      ...(change.polyhedronColour !== undefined ? { polyhedra: true, polyhedronColour: change.polyhedronColour.toLowerCase() } : {}),
    };
    this.rules = this.rules.map((x, k) => (k === i ? ({ ...x, ...next } as Rule) : x));
    this.changed();
    return null;
  }

  removeBonds(between: string): string | null {
    const i = this.ruleIndex(between);
    if (i < 0) return `No ${between} bonds are drawn.`;
    this.rules = this.rules.filter((_, k) => k !== i);
    this.changed();
    return null;
  }

  setView(req: ViewRequest): string | null {
    const structure = this.structure;
    if (!structure) return "No structure is open.";
    const axes = directAxes(structure.cell);
    const three = (v: readonly number[] | undefined) => v && v.length === 3 && v.every(Number.isFinite) && v.some((x) => x !== 0);
    const lookAlong = (direction: Direction) => {
      const towards = directionVector(structure.cell, direction);
      for (const up of [axes[2], axes[1], axes[0]]) {
        const target = viewAlong(towards, up);
        if (target) {
          this.view = target;
          return;
        }
      }
    };
    if (req.along) {
      if (!three(req.along)) return "along must be three numbers, not all zero.";
      lookAlong({ kind: "uvw", indices: req.along as [number, number, number] });
      return null;
    }
    if (req.normalTo) {
      if (!three(req.normalTo)) return "normal_to must be three numbers, not all zero.";
      lookAlong({ kind: "hkl", indices: req.normalTo as [number, number, number] });
      return null;
    }
    if (req.preset) {
      const preset = VIEW_PRESETS.find((p) => p.id === req.preset);
      if (!preset) return `No view preset "${req.preset}": ${VIEW_PRESETS.map((p) => p.id).join(", ")}.`;
      this.view = presetView(structure.cell, preset.id as ViewPreset);
      return null;
    }
    const now = numbersFromView(axes, this.view, this.upAxis);
    const up = req.up ? (["a", "b", "c"].indexOf(req.up) as Axis) : this.upAxis;
    const next = { up, turn: req.turn ?? now.turn, tilt: req.tilt ?? now.tilt, roll: req.roll ?? now.roll };
    if (Math.abs(next.tilt) > 90) return "tilt must be between -90 and 90 degrees.";
    if (![next.turn, next.tilt, next.roll].every(Number.isFinite)) return "turn, tilt and roll must be numbers.";
    this.upAxis = next.up;
    this.view = viewFromNumbers(axes, next);
    return null;
  }

  setCells(from: readonly number[], to: readonly number[]): string | null {
    if (from.some((f, k) => f >= to[k]!)) return 'Each "from" must be below its "to".';
    const cells = (to[0]! - from[0]!) * (to[1]! - from[1]!) * (to[2]! - from[2]!);
    if (cells > 1000) return `That is ${Math.round(cells)} cells; at most 1000.`;
    this.rangeText = [...from, ...to].map(String);
    this.changed();
    return null;
  }

  useJournal(req: { publisher?: string; journal?: string; column?: string; width?: string }): { error: string } | { applied: string } {
    const found = matchJournal(req, this.journalPart);
    if (typeof found === "string") return { error: found };
    const size = journalSize(found.id);
    if (!size) return { error: "No such journal template." };
    const canvas = this.canvas();
    const ratio = this.ratio();
    const width = partWidth(size.width, found.part);
    const height = ratio !== null ? width / ratio : (width * canvas.height) / canvas.width;
    const pt = String(journalTextPt(size.of, CAP_HEIGHT));
    Object.assign(this.settings, { canvasFixed: true, canvasUnit: size.unit, canvasSize: [`${width}`, short(height)], textSizes: { legend: pt, axes: pt, angle: pt } });
    this.journalChoice = size.id;
    this.journalPart = found.part;
    this.changed();
    return { applied: describeJournal(found.id, found.part) };
  }

  setMoments(rules: readonly MomentRule[]): { error: string } | { applied: string } {
    const structure = this.structure;
    if (!structure) return { error: "No structure is open." };
    const base = structure.distortion && this.modesOn.length === structure.distortion.modes.length ? withDisplacements(structure, this.modesOn) : structure;
    try {
      const { counts } = withHandMoments(base, rules);
      this.momentRules = rules;
      this.showMoments = true;
      this.changed();
      return { applied: rules.map((r, k) => `${r.element}${r.where ? ` at ${r.where.axis} = ${r.where.at}` : ""}: ${r.size} μB along [${r.along.join(" ")}] on ${counts[k]} atom${counts[k] === 1 ? "" : "s"}`).join("; ") };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  clearMoments(): string | null {
    if (!this.momentRules) return "There are no moments added by hand.";
    this.momentRules = null;
    this.changed();
    return null;
  }

  markAngles(req: { ends: [string, string]; apex: string; min?: number; max?: number; colour?: string; labels?: boolean }): { error: string } | { applied: string } {
    let scene: Scene;
    try {
      scene = this.scene();
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    const same = (k: { centre: string; ends: readonly [string, string] }) =>
      k.centre === req.apex && ((k.ends[0] === req.ends[0] && k.ends[1] === req.ends[1]) || (k.ends[0] === req.ends[1] && k.ends[1] === req.ends[0]));
    const kind = scene.angleKinds.find(same);
    if (!kind) {
      const have = scene.angleKinds.map((k) => `${k.ends[0]}-${k.centre}-${k.ends[1]}`);
      return { error: `There are no ${req.ends[0]}–${req.apex}–${req.ends[1]} angles: angles are between drawn bonds${have.length ? `; those that can be marked are ${have.join(", ")}` : `, and no two drawn bonds meet at a ${req.apex} atom (draw ${req.apex}–${req.ends[0]} bonds first, with add_bonds)`}.` };
    }
    if (req.colour !== undefined && !/^#[0-9a-fA-F]{6}$/.test(req.colour)) return { error: `"${req.colour}" is not a colour "#rrggbb".` };
    const sizes = kind.sizes.filter((x) => x < 179.5);
    const lo = req.min ?? Math.max(0, Math.floor((sizes[0] ?? 0) - 0.5));
    const hi = req.max ?? Math.min(180, Math.ceil((sizes[sizes.length - 1] ?? 180) + 0.5));
    if (!(lo >= 0 && hi <= 180 && lo <= hi)) return { error: "The range must run from min to max within 0 to 180 degrees." };
    const inRange = kind.sizes.filter((x) => x >= lo - 1e-9 && x <= hi + 1e-9).length;
    if (inRange === 0) return { error: `No ${kind.ends[0]}–${kind.centre}–${kind.ends[1]} angle lies from ${lo} to ${hi}°; their sizes are ${[...new Set(kind.sizes.map((x) => x.toFixed(1)))].join(", ")}°.` };
    this.angleRules = [
      ...this.angleRules.filter((r) => !same({ centre: r.centre, ends: r.ends })),
      {
        centre: kind.centre,
        ends: kind.ends,
        min: lo,
        max: hi,
        minText: String(lo),
        maxText: String(hi),
        radiusText: String(DEFAULT_ANGLE_LOOK.radius),
        opacityText: String(DEFAULT_ANGLE_LOOK.opacity),
        ...(req.colour ? { colour: req.colour.toLowerCase() } : {}),
        ...(req.labels !== undefined ? { label: req.labels } : {}),
      },
    ];
    this.changed();
    return { applied: `${kind.ends[0]}–${kind.centre}–${kind.ends[1]} from ${lo} to ${hi}° (${inRange} different size${inRange === 1 ? "" : "s"} in that range)` };
  }

  clearAngles(req?: { ends: [string, string]; apex: string }): string | null {
    if (this.angleRules.length === 0) return "No angles are marked.";
    if (!req) {
      this.angleRules = [];
      this.changed();
      return null;
    }
    const keep = this.angleRules.filter((r) => !(r.centre === req.apex && ((r.ends[0] === req.ends[0] && r.ends[1] === req.ends[1]) || (r.ends[0] === req.ends[1] && r.ends[1] === req.ends[0]))));
    if (keep.length === this.angleRules.length) return `No ${req.ends[0]}–${req.apex}–${req.ends[1]} angles are marked.`;
    this.angleRules = keep;
    this.changed();
    return null;
  }

  /** On the page this downloads the file; here the server writes it (registry.ts), so this only says how. */
  saveStructure(): { error: string } | { applied: string } {
    return { error: "Use save_structure with a folder: the server writes the file." };
  }
}
