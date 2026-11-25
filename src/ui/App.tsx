// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { svgToPng } from "../render/png";
import { previewFrame } from "../preview/data";
import { PREVIEW_FROM, usePreview } from "../preview/usePreview";
import { AnglePlot } from "./AnglePlot";
import { DEFAULT_CANVAS, fitView, renderSvg, steadyFit, structureCentre, structureHeight, type Canvas, type Fit, type PhysicalSize, PT_PER, ptPerUnit, LEGEND_FONT, AXES_FONT, ANGLE_LABEL_SIZE } from "../render/svg";
import { NO_ZOOM, isZoomed, panBy, zoomAbout, zoomToBox, zoomedFit, type Zoom } from "../render/zoom";
import {
  between, directAxes, presetView, VIEW_PRESETS, type ViewPreset, directionVector, fromBehind, lowIndexDirections, nearestDirection, openingNumbers, numbersFromView, readView, rolled, snapTo, viewAlong, viewFromNumbers,
  writeDirection, writeView, type Axis, type Direction, type ViewNumbers,
} from "../render/camera";
import { DEFAULT_TILT, DEFAULT_TURN, DEFAULT_VIEW, dragView, type View } from "../render/view";
import { type ArrowStyle, AXES_COLOURS, buildScene, MATERIALS, type CellStyle, type Material, DEFAULT_SPEC, DEFAULT_STICK, elementColour, largestDisplacement, largestMoment, speciesRadius, DEFAULT_DISPLACEMENT_LENGTH, DEFAULT_DISPLACEMENT_COLOUR, DEFAULT_DISPLACEMENT_THICKNESS, DEFAULT_MOMENT_TAIL, DEFAULT_ORBITAL_COLOURS, DEFAULT_ORBITAL_OPACITY, DEFAULT_ORBITAL_SIZE, ORBITAL_SCHEMES, ORBITAL_TEXTURES, type OrbitalTexture, type Look, type OrbitalRule, type Scene, withoutOrbitals } from "../scene/scene";
import { DEFAULT_ISO, ORBITALS } from "../scene/orbitals";
import { expandToUnitCell } from "../structure/expand";
import { DEFAULT_ANGLE_LOOK, type AngleRule } from "../scene/angles";
import { suggestBonds } from "../scene/autoBonds";
import { DEFAULT_POLYHEDRON_OPACITY, pairDistances, type BondColouring, type BondLine, type BondRule, type PolyhedronLook } from "../scene/bonds";
import type { BoundaryRule, Range } from "../scene/select";
import { readStructure } from "../structure/readStructure";
import { withHandMoments, type MomentRule } from "../structure/handMoments";
import { FORMATS, writeStructure, type StructureFormat } from "../structure/writeStructure";
import { withDisplacements } from "../structure/distortion";
import {
  apply as applySettings,
  coloursOf,
  collect as collectSettings,
  defaultSettingsName,
  isBool,
  isColour,
  isNumber,
  isText,
  oneOf,
  readSettingsFile,
  setDefaultSettingsName,
  settingsFileText,
  storedSettings,
  storeSettings,
  textRecord,
  textsOf,
  type SavedSettings,
  type SettingField,
} from "./settings";
import { Rulers } from "./Rulers";
import { AssistantDrawer, AssistantPanel } from "./AssistantPanel";
import { ThemeCue } from "./ThemeCue";
import { useAssistant } from "./useAssistant";
import { splitPair, type FigureState, type Page } from "../agent/tools";
import { sizeLabel } from "./ruler";
import { isDoubleTap, rollFor, twoFingerStep, type Touch } from "./touch";
import { PARTS, PUBLISHERS, describeJournal, journalsOf, matchJournal, partWidth, journalSize, journalTextPt, type PartId } from "./journals";
import { type FeatureExample, readFeatures } from "./examples";
import featuresText from "../../examples/features.json?raw";
import type { Structure } from "../structure/types";

// Published structures shipped with the page (see examples/README.md).
const EXAMPLES = Object.entries(
  import.meta.glob<string>("../../examples/*.{cif,mcif,rmc6f}", { query: "?raw", import: "default", eager: true }),
).map(([path, text]) => ({ file: path.split("/").pop()!, name: path.split("/").pop()!.replace(/\.(m?cif|rmc6f)$/, ""), text }));
// The examples the page offers: each a file and the settings that show one feature (examples/features.json).
// The other files in examples/ are kept for the tests and are not listed.
const FEATURES: (FeatureExample & { text: string })[] = readFeatures(featuresText, EXAMPLES.map((x) => x.file)).map((f) => ({ ...f, text: EXAMPLES.find((x) => x.file === f.file)!.text }));

/** A full turn for a drag across this many CSS px. */
const DRAG_PX_PER_TURN = 700;

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const AXES = ["a", "b", "c"] as const;
const ONE_CELL_TEXT = ["0", "0", "0", "1", "1", "1"];

/** The range typed in the six boxes (from a, b, c, then to a, b, c), or null while a box holds no number. */
function rangeFromText(text: readonly string[], boundary: BoundaryRule): Range | null {
  const v = text.map((t) => (t.trim() === "" ? NaN : Number(t)));
  if (v.some((x) => !Number.isFinite(x))) return null;
  return { from: [v[0]!, v[1]!, v[2]!], to: [v[3]!, v[4]!, v[5]!], boundary };
}

export function App() {
  const [structure, setStructure] = useState<Structure | null>(null);
  // The file as last opened, so an RMC configuration can be read again folded or whole.
  const lastFile = useRef<{ text: string; name: string } | null>(null);
  const foldRmc = useRef(false);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  // The figure's canvas: by default 1440 px wide, as high as the shape of its frame on the page makes it;
  // or a size on paper chosen by the user (cm or in), drawn 1440 units wide and stated in the SVG.
  const [canvas, setCanvas] = useState<Canvas>(DEFAULT_CANVAS);
  // Default figure: a Nature single column, 89 mm wide, 4:3 (the user's choice, 2026-11-23).
  const [canvasFixed, setCanvasFixed] = useState(true);
  const [canvasUnit, setCanvasUnit] = useState<PhysicalSize["unit"]>("cm");
  const [canvasSizeText, setCanvasSizeText] = useState<[string, string]>(["8.9", "6.675"]);
  // The journal template last chosen; it shows as chosen while the size on paper is still its width.
  const [journalChoice, setJournalChoice] = useState("");
  // Rulers along the top and left of the figure on the page (never part of the saved figure).
  const [showRulers, setShowRulers] = useState(true);
  // The unit the rulers and the size under the figure are read in: cm or in, whatever unit the size was set in.
  const [rulerUnit, setRulerUnit] = useState<"cm" | "in" | null>(null);
  // Which share of the template's width the figure takes: all, a half, a third or a quarter.
  const [journalPart, setJournalPart] = useState<PartId>("1");
  const canvasSize: [number, number] = [Number(canvasSizeText[0]), Number(canvasSizeText[1])];
  const [sideMin, sideMax] = canvasUnit === "cm" ? [1, 100] : [0.4, 40];
  const canvasSizeOk =
    canvasSize.every((x) => Number.isFinite(x) && x >= sideMin && x <= sideMax) && canvasSize[1] / canvasSize[0] >= 0.2 && canvasSize[1] / canvasSize[0] <= 5;
  // While a side is being typed (or is out of range) the canvas keeps the last valid size.
  const lastPhysical = useRef<PhysicalSize>({ width: 8.9, height: 6.675, unit: "cm" });
  // Replaced only when a number changes: the frame's measuring effect depends on this object, and a new one on
  // every render made it set the canvas on every render (an endless update loop, which blanked the figure).
  if (canvasSizeOk) {
    const was = lastPhysical.current;
    if (was.width !== canvasSize[0] || was.height !== canvasSize[1] || was.unit !== canvasUnit) lastPhysical.current = { width: canvasSize[0], height: canvasSize[1], unit: canvasUnit };
  }
  const physical: PhysicalSize | null = canvasFixed ? lastPhysical.current : null;
  // The shape of the canvas: free (the frame's shape, or the width and height as typed) or a chosen
  // width : height, turned upright with "portrait".
  const [aspect, setAspect] = useState("4:3");
  const [portrait, setPortrait] = useState(false);
  const ratioOf = (key: string, upright: boolean): number | null => {
    const r = ASPECTS.find((a) => a.key === key)?.ratio ?? null;
    return r === null ? null : upright ? 1 / r : r;
  };
  const ratio = ratioOf(aspect, portrait);
  const short = (x: number): string => `${+x.toFixed(3)}`;
  // Text sizes in pt; empty = automatic.
  const [fontPtText, setFontPtText] = useState<{ legend: string; axes: string; angle: string }>(DEFAULT_TEXT_PT);
  const fontPt = (text: string): number | null => {
    const x = Number(text);
    return text.trim() !== "" && Number.isFinite(x) && x >= 1 && x <= 400 ? x : null;
  };
  const [legendFontPt, axesFontPt, angleFontPt] = [fontPt(fontPtText.legend), fontPt(fontPtText.axes), fontPt(fontPtText.angle)];
  const [dpiText, setDpiText] = useState("300");
  const dpi = Math.max(30, Math.min(2400, Number(dpiText) || 300));
  // A PNG of a size on paper: exactly that size at the dpi given.
  const perInch = physical ? (physical.unit === "in" ? 1 : 1 / 2.54) : 0;
  const pngSize: [number, number] = physical ? [Math.round(physical.width * perInch * dpi), Math.round(physical.height * perInch * dpi)] : [0, 0];
  const [transparent, setTransparent] = useState(true);
  const [pngWidth, setPngWidth] = useState(2880);
  const [over, setOver] = useState(false);
  const [tab, setTab] = useState<TabId>("structure");
  const [showHelp, setShowHelp] = useState(true);
  // What the hands are doing now, so the control strip under the figure can light up the matching control.
  const [held, setHeld] = useState({ alt: false, shift: false, zoomKey: false });
  const [acting, setActing] = useState<"turn" | "move" | "box" | "pinch" | null>(null);
  useEffect(() => {
    const read = (e: globalThis.KeyboardEvent) => setHeld({ alt: e.altKey, shift: e.shiftKey, zoomKey: e.ctrlKey || e.metaKey });
    const clear = () => setHeld({ alt: false, shift: false, zoomKey: false });
    window.addEventListener("keydown", read);
    window.addEventListener("keyup", read);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", read);
      window.removeEventListener("keyup", read);
      window.removeEventListener("blur", clear);
    };
  }, []);
  const [rangeText, setRangeText] = useState<string[]>(ONE_CELL_TEXT);
  const [repeatBoundary, setRepeatBoundary] = useState(true);
  const [bondRules, setBondRules] = useState<(BondRule & { maxText: string; widthText?: string })[]>([]);
  const [showCell, setShowCell] = useState(true);
  const [newPair, setNewPair] = useState("");
  // The user's changes to colours, sizes and names. Radii are kept as typed, so a box can be emptied while editing.
  // Element colours and radii from loaded settings: each newly opened file starts from them.
  const preferredLooks = useRef<Record<string, { colour?: string; radiusText?: string }>>({});
  const [looks, setLooks] = useState<Record<string, { colour?: string; radiusText?: string; name?: string; hidden?: boolean; orderText?: string }>>({});
  // ---- The view. It is kept as a rotation matrix; the four numbers (axis up, turn, tilt, roll) are read from it,
  // so they are always true, whatever moved the view.
  const [upAxis, setUpAxis] = useState<Axis>(2);
  const axes = useMemo(() => (structure ? directAxes(structure.cell) : null), [structure]);
  const numbers: ViewNumbers = useMemo(() => (axes ? numbersFromView(axes, view, upAxis) : { up: upAxis, turn: DEFAULT_TURN, tilt: DEFAULT_TILT, roll: 0 }), [axes, view, upAxis]);
  const lastNumbers = useRef(numbers);
  lastNumbers.current = numbers;
  // The number boxes hold what was typed while typing; any other change of the view rewrites them.
  const [numberText, setNumberText] = useState({ turn: String(DEFAULT_TURN), tilt: String(DEFAULT_TILT), roll: "0" });
  const typing = useRef(false);
  useEffect(() => {
    if (typing.current) {
      typing.current = false;
      return;
    }
    const f = (x: number): string => String(Math.round(x * 10) / 10 + 0);
    setNumberText({ turn: f(numbers.turn), tilt: f(numbers.tilt), roll: f(numbers.roll) });
  }, [numbers]);
  const [dragMode, setDragMode] = useState<"turntable" | "free">("turntable");
  const [snap, setSnap] = useState(true);
  const [animate, setAnimate] = useState(true);
  const [keepView, setKeepView] = useState(false);
  const [scaleMode, setScaleMode] = useState<"outline" | "steady" | "fixed">("outline");
  const [fixedScaleText, setFixedScaleText] = useState("60");
  const [alongKind, setAlongKind] = useState<Direction["kind"]>("uvw");
  const [alongText, setAlongText] = useState("0 0 1");
  const [upKind, setUpKind] = useState<Direction["kind"]>("uvw");
  const [upText, setUpText] = useState("");
  const [viewNote, setViewNote] = useState("");
  const [pasted, setPasted] = useState("");
  const [savedViews, setSavedViews] = useState<(ViewNumbers & { name: string })[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("motif.views") ?? "[]") as (ViewNumbers & { name: string })[];
    } catch {
      return [];
    }
  });
  const [newViewName, setNewViewName] = useState("");
  const storeViews = (views: (ViewNumbers & { name: string })[]) => {
    setSavedViews(views);
    try {
      localStorage.setItem("motif.views", JSON.stringify(views));
    } catch {
      // The list still works for this visit.
    }
  };
  /** Change the view by a click: a short turn on screen (never part of the saved figure), or at once. */
  const turning = useRef(0);
  const goTo = (target: View, keepScale = false) => {
    cancelAnimationFrame(turning.current);
    if (!keepScale) setTurnScale(null);
    const reduced = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduced) {
      setView(target);
      return;
    }
    const from = view;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TURN_MS);
      setView(between(from, target, t * t * (3 - 2 * t))); // slow in, slow out
      if (t < 1) turning.current = requestAnimationFrame(step);
    };
    turning.current = requestAnimationFrame(step);
  };
  const applyNumbers = (n: ViewNumbers) => {
    if (!axes || ![n.turn, n.tilt, n.roll].every(Number.isFinite) || Math.abs(n.tilt) > 90) return;
    setUpAxis(n.up);
    setTurnScale(null);
    setView(viewFromNumbers(axes, n));
  };
  const typeNumber = (key: "turn" | "tilt" | "roll", text: string) => {
    typing.current = true;
    const next = { ...numberText, [key]: text };
    setNumberText(next);
    if (Object.values(next).every((x) => x.trim() !== "")) applyNumbers({ up: upAxis, turn: Number(next.turn), tilt: Number(next.tilt), roll: Number(next.roll) });
  };
  const parseIndices = (text: string): [number, number, number] | null => {
    const parts = text.trim().split(/[\s,]+/).map(Number);
    return parts.length === 3 && parts.every(Number.isFinite) && parts.some((x) => x !== 0) ? (parts as [number, number, number]) : null;
  };
  /** Look along a direction (pointing at the viewer). Up: the hint if given, else c, or b when looking along c. */
  const lookAlong = (direction: Direction, hint?: Direction) => {
    if (!structure || !axes) return;
    const towards = directionVector(structure.cell, direction);
    const candidates = [...(hint ? [directionVector(structure.cell, hint)] : []), axes[2], axes[1], axes[0]];
    for (const up of candidates) {
      const target = viewAlong(towards, up);
      if (target) {
        setViewNote(hint && up !== candidates[0] ? "The up direction lies along the line of sight; c (or b) was used instead." : "");
        goTo(target);
        return;
      }
    }
  };
  // The direction a release would snap to (indices up to 2), and the one named under the figure: that one when
  // it is within reach, otherwise the nearest of the simplest directions (indices up to 1).
  const near = useMemo(() => (structure ? nearestDirection(structure.cell, view) : null), [structure, view]);
  const named = useMemo(
    () => (structure && near ? (near.angle <= SNAP_DEGREES ? near : nearestDirection(structure.cell, view, SIMPLE_DIRECTIONS)) : null),
    [structure, view, near],
  );
  // The figure's size as the rulers show it: on paper in the unit chosen for the rulers, else in px of the figure.
  const shownSize: { width: number; height: number; unit: "cm" | "in" | "px" } = (() => {
    const p = canvas.physical;
    if (!p) return { width: canvas.width, height: canvas.height, unit: "px" };
    const unit = rulerUnit ?? p.unit;
    const f = PT_PER[p.unit] / PT_PER[unit];
    return { width: p.width * f, height: p.height * f, unit };
  })();
  const viewLine = `${writeView(numbers)}${named ? (named.angle < 0.05 ? ` · along ${writeDirection(named.direction)}` : ` · ${named.angle.toFixed(1)}° from ${writeDirection(named.direction)}`) : ""}`;
  const [showVacancy, setShowVacancy] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [letterWeight, setLetterWeight] = useState(DEFAULT_SPEC.letterWeight);
  const [legendFollows, setLegendFollows] = useState(DEFAULT_SPEC.legendFollowsZoom);
  const [legendSizeText, setLegendSizeText] = useState("1");
  const [axesSizeText, setAxesSizeText] = useState("1");
  const sizeOf = (text: string): number => (Number(text) >= 0.2 && Number(text) <= 4 ? Number(text) : 1);
  const [legendSize, axesSize] = [sizeOf(legendSizeText), sizeOf(axesSizeText)];
  // The automatic text sizes, in pt, for the placeholders (the legend's may shrink further to fit its row).
  const autoPt = ((u: number) => ({
    legend: +(LEGEND_FONT * legendSize * u).toFixed(1),
    axes: +(AXES_FONT * axesSize * u).toFixed(1),
    angle: +(ANGLE_LABEL_SIZE * u).toFixed(1),
  }))(ptPerUnit(canvas));
  const [momentHeadText, setMomentHeadText] = useState("1");
  const [axesHeadText, setAxesHeadText] = useState("1");
  const [momentHeadSize, axesHeadSize] = [sizeOf(momentHeadText), sizeOf(axesHeadText)];
  const [momentOutline, setMomentOutline] = useState(DEFAULT_SPEC.momentOutline);
  const [axesOutline, setAxesOutline] = useState(DEFAULT_SPEC.axesOutline);
  const [axesReadable, setAxesReadable] = useState(DEFAULT_SPEC.axesKeepReadable);
  const [axesColoured, setAxesColoured] = useState(DEFAULT_SPEC.axesColoured);
  const [axesColours, setAxesColours] = useState(DEFAULT_SPEC.axesColours);
  const [atomMaterial, setAtomMaterial] = useState<Material>(DEFAULT_SPEC.atomMaterial);
  const [arrowMaterial, setArrowMaterial] = useState<Material>(DEFAULT_SPEC.arrowMaterial);
  const [bondMaterial, setBondMaterial] = useState<Material>(DEFAULT_SPEC.bondMaterial);
  const [bondOutline, setBondOutline] = useState(DEFAULT_SPEC.bondOutline);
  const [cellStyle, setCellStyle] = useState<CellStyle>(DEFAULT_SPEC.cellStyle);
  const [cellWidthText, setCellWidthText] = useState(String(DEFAULT_SPEC.cellWidth));
  const cellWidth = Number(cellWidthText) >= 0.5 && Number(cellWidthText) <= 12 ? Number(cellWidthText) : DEFAULT_SPEC.cellWidth;
  const applyPreset = (name: string) => {
    const preset = PRESETS[name];
    if (!preset) return;
    setAtomMaterial(preset.atoms);
    setBondMaterial(preset.bonds);
    setArrowMaterial(preset.arrows);
    setBondOutline(preset.bondOutline);
    setMomentOutline(preset.outlines);
    setAxesOutline(preset.outlines);
    setLetterWeight(preset.weight);
    setLegendSizeText(String(preset.legendSize));
    setAxesSizeText(String(preset.axesSize));
  };
  const [glassOpacity, setGlassOpacity] = useState(DEFAULT_SPEC.glassOpacity);
  const materialChoice = (testId: string, value: Material, set: (m: Material) => void) => (
    <>
    <select data-testid={testId} value={value} onChange={(e) => set(e.target.value as Material)} title="Soft: a gentle highlight. Flat: one colour. Glossy: a bright highlight spot. Metal: strong light and dark with a lit rim. Glass: see-through.">
      {MATERIALS.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
    </>
  );
  const [fontFamily, setFontFamily] = useState(DEFAULT_SPEC.fontFamily);
  const [customFont, setCustomFont] = useState(false);
  // Angle rules; the limits and the look are kept as typed.
  const [angleRules, setAngleRules] = useState<(AngleRule & { minText: string; maxText: string; radiusText: string; opacityText: string })[]>([]);
  const [newAngle, setNewAngle] = useState("");
  // While the pointer rests on a bar of an angle plot: that rule shows only the bar's angles.
  const [angleHover, setAngleHover] = useState<{ rule: number; range: [number, number] } | null>(null);
  const changeAngle = (index: number, change: Partial<(typeof angleRules)[number]>) => setAngleRules((all) => all.map((x, i) => (i === index ? { ...x, ...change } : x)));
  // Orbitals on the atoms of chosen species (see scene/orbitals.ts); reset for each new file.
  const [orbitalRules, setOrbitalRules] = useState<{ species: string; orbitals: string[]; sizeText: string; colours: [string, string]; opacityText: string; iso: number; texture: OrbitalTexture; zText: string; xText: string; zMode?: "uvw" | "longest" | "bridge"; zNeighbour?: string }[]>([]);
  const [newOrbitalSpecies, setNewOrbitalSpecies] = useState("");
  const changeOrbitalRule = (index: number, change: Partial<(typeof orbitalRules)[number]>) => setOrbitalRules((all) => all.map((r, i) => (i === index ? { ...r, ...change } : r)));
  const sceneOrbitals = useMemo((): OrbitalRule[] => {
    const indices = (text: string): [number, number, number] | null => {
      const parts = text.trim().split(/[\s,]+/).map(Number);
      return parts.length === 3 && parts.every(Number.isFinite) && parts.some((x) => x !== 0) ? (parts as [number, number, number]) : null;
    };
    return orbitalRules.map((r) => ({
      species: r.species,
      orbitals: r.orbitals,
      size: Number(r.sizeText) > 0 && Number(r.sizeText) <= 20 ? Number(r.sizeText) : DEFAULT_ORBITAL_SIZE,
      colours: r.colours,
      opacity: Number(r.opacityText) >= 0.05 && Number(r.opacityText) <= 1 ? Number(r.opacityText) : DEFAULT_ORBITAL_OPACITY,
      iso: r.iso,
      texture: r.texture,
      z: indices(r.zText),
      x: indices(r.xText),
      ...(r.zMode && r.zMode !== "uvw" && r.zNeighbour ? { zFrom: { neighbour: r.zNeighbour, mode: r.zMode } } : {}),
    }));
  }, [orbitalRules]);
  const sceneAngles = useMemo(
    () =>
      angleRules.map((r, index): AngleRule => {
        const num = (text: string, lo: number, hi: number, fallback: number): number => (text.trim() !== "" && Number(text) >= lo && Number(text) <= hi ? Number(text) : fallback);
        return {
          centre: r.centre,
          ends: r.ends,
          min: angleHover?.rule === index ? angleHover.range[0] : num(r.minText, 0, 180, 0),
          max: angleHover?.rule === index ? angleHover.range[1] : num(r.maxText, 0, 180, 180),
          colour: r.colour ?? DEFAULT_ANGLE_LOOK.colour,
          opacity: num(r.opacityText, 0.05, 1, DEFAULT_ANGLE_LOOK.opacity),
          radius: num(r.radiusText, 0.1, 5, DEFAULT_ANGLE_LOOK.radius),
          label: r.label ?? DEFAULT_ANGLE_LOOK.label,
        };
      }),
    [angleRules, angleHover],
  );
  const [showMoments, setShowMoments] = useState(true);
  const [momentLengthText, setMomentLengthText] = useState(String(DEFAULT_SPEC.momentLength));
  const [momentColour, setMomentColour] = useState(DEFAULT_SPEC.momentColour);
  // A moment arrow's tail side, in percent of its head side.
  const [momentTailText, setMomentTailText] = useState(String(Math.round(DEFAULT_MOMENT_TAIL * 100)));
  const momentTail = Number(momentTailText) >= 20 && Number(momentTailText) <= 100 ? Number(momentTailText) / 100 : DEFAULT_MOMENT_TAIL;
  const [momentThicknessText, setMomentThicknessText] = useState(String(DEFAULT_SPEC.momentThickness));
  const momentThickness = Number(momentThicknessText) >= 0.02 && Number(momentThicknessText) <= 2 ? Number(momentThicknessText) : DEFAULT_SPEC.momentThickness;
  const momentLength = Number(momentLengthText) > 0 && Number(momentLengthText) <= 20 ? Number(momentLengthText) : DEFAULT_SPEC.momentLength;
  // A distortion (ISODISTORT file): its displacements as arrows, from the modes switched on.
  const [showDisplacements, setShowDisplacements] = useState(true);
  const [displacementLengthText, setDisplacementLengthText] = useState(String(DEFAULT_DISPLACEMENT_LENGTH));
  const displacementLength = Number(displacementLengthText) > 0 && Number(displacementLengthText) <= 20 ? Number(displacementLengthText) : DEFAULT_DISPLACEMENT_LENGTH;
  const [modesOn, setModesOn] = useState<boolean[]>([]);
  // How the file's arrows are drawn (null: as the file's own kind); back to that for each new file.
  const [arrowStyleChoice, setArrowStyleChoice] = useState<ArrowStyle | null>(null);
  useEffect(() => setArrowStyleChoice(null), [structure]);
  const arrowSource: ArrowStyle | null = !structure ? null : largestMoment(structure) > 0 ? "moment" : largestDisplacement(structure) > 0 ? "displacement" : null;
  const arrowStyle: ArrowStyle | null = arrowSource ? (arrowStyleChoice ?? arrowSource) : null;
  const [displacementColour, setDisplacementColour] = useState(DEFAULT_DISPLACEMENT_COLOUR);
  const [displacementThicknessText, setDisplacementThicknessText] = useState(String(DEFAULT_DISPLACEMENT_THICKNESS));
  const displacementThickness = Number(displacementThicknessText) >= 0.02 && Number(displacementThicknessText) <= 2 ? Number(displacementThicknessText) : DEFAULT_DISPLACEMENT_THICKNESS;
  useEffect(() => setModesOn(structure?.distortion?.modes.map(() => true) ?? []), [structure]);
  // The structure as drawn: with the displacements of the modes switched on.
  // Moments added by hand (the assistant's set_moments; handMoments.ts): on the unit cell's atoms, as stated.
  const [momentRules, setMomentRules] = useState<readonly MomentRule[] | null>(null);
  const drawnStructure = useMemo(() => {
    const base = structure?.distortion && modesOn.length === structure.distortion.modes.length ? withDisplacements(structure, modesOn) : structure;
    if (!base || !momentRules) return base;
    try {
      return withHandMoments(base, momentRules).structure;
    } catch {
      return base;
    }
  }, [structure, modesOn, momentRules]);
  const [showAxes, setShowAxes] = useState(true);
  const setLook = (key: string, change: { colour?: string; radiusText?: string; name?: string; hidden?: boolean; orderText?: string }) =>
    setLooks((all) => ({ ...all, [key]: { ...all[key], ...change } }));
  const last = useRef<{ x: number; y: number } | null>(null);
  // While dragging, the placement of the moment the drag began is kept, so the figure turns without jumping.
  const [heldFit, setHeldFit] = useState<Fit | null>(null);
  // After a turn by dragging, the scale it had: the figure keeps it (centred on the new outline, smaller only if it
  // would not fit) until a file is opened, a view is chosen, or the cells or canvas change.
  const [turnScale, setTurnScale] = useState<number | null>(null);
  const heldFitRef = useRef<Fit | null>(null);
  heldFitRef.current = heldFit;
  useEffect(() => setTurnScale(null), [rangeText.join(" "), canvas.width, canvas.height]);
  // Zoom and pan of the structure within its space; and whether the saved figure follows them.
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const [saveZoomed, setSaveZoomed] = useState(true);

  const [autoBonds, setAutoBonds] = useState(true);
  const [autoNote, setAutoNote] = useState("");
  const autoBondsRef = useRef(true);
  autoBondsRef.current = autoBonds;
  const keepViewRef = useRef(false);
  keepViewRef.current = keepView;
  const load = useCallback((text: string, name: string): Structure | null => {
    lastFile.current = { text, name };
    try {
      const read = readStructure(text, name, { fold: foldRmc.current });
      buildScene(read); // fail here, with a message, rather than while drawing
      lastScene.current = null;
      setStructure(read);
      setFileName(name);
      setError("");
      // A new file starts from the default view, or (if asked) keeps the present one in the new cell's own
      // terms: the same axis up, the same turn, tilt and roll.
      const opening = directAxes(read.cell);
      setView(viewFromNumbers(opening, keepViewRef.current ? lastNumbers.current : openingNumbers(opening)));
      setRangeText(ONE_CELL_TEXT);
      // A molecule sits in a box that is not a unit cell: no cell outline. A crystal shows its cell.
      setShowCell(!read.molecule);
      setZoom(NO_ZOOM);
      setTurnScale(null);
      // Bonds to start from, unless that is switched off: nearest neighbours by simple rules (see autoBonds.ts).
      const suggested = autoBondsRef.current ? suggestBonds(read) : [];
      setBondRules(suggested.map((r) => ({ ...r, maxText: String(r.max) })));
      setAutoNote(suggested.length > 0 ? suggested.map((r) => `${r.centre}–${r.neighbour} up to ${r.max} Å`).join(", ") : "");
      setNewPair("");
      setLooks({ ...preferredLooks.current }); // element colours and radii from loaded settings, if any
      setAngleRules([]);
      setOrbitalRules([]);
      setMomentRules(null);
      setAngleHover(null);
      setNewAngle("");
      if (!keepViewRef.current) setUpAxis(2);
      return read;
    } catch (e) {
      setError(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }, []);
  /** Close the structure: back to the start page. */
  const closeStructure = () => {
    lastFile.current = null;
    lastScene.current = null;
    setStructure(null);
    setFileName("");
    setError("");
    setZoom(NO_ZOOM);
    setTurnScale(null);
  };
  /** A file opened by hand. An RMC configuration opens as its whole supercell; "Fold" then averages it to one cell. */
  const openFile = (text: string, name: string) => {
    foldRmc.current = false;
    load(text, name);
  };
  /** Read the RMC configuration last opened again, folded into one cell or as the whole supercell. */
  const refold = (fold: boolean) => {
    foldRmc.current = fold;
    if (lastFile.current) load(lastFile.current.text, lastFile.current.name);
  };
  /** Open a feature example with the settings that show its feature. */
  const loadFeature = (f: (typeof FEATURES)[number]) => {
    foldRmc.current = f.fold ?? false;
    const read = load(f.text, f.file);
    if (read && f.along) {
      // Looking along [u v w], pointing at the viewer; c up, or b (then a) when c lies along the line of sight.
      const towards = directionVector(read.cell, { kind: "uvw", indices: [...f.along] as [number, number, number] });
      const target = directAxes(read.cell).slice().reverse().map((up) => viewAlong(towards, up)).find((v) => v !== null);
      if (target) setView(target);
    }
    if (f.cells) setRangeText(f.cells.map(String));
    if (f.completeBonds === false) setBondRules((all) => all.map((r) => ({ ...r, complete: false })));
    if (f.hide) setLooks((all) => ({ ...all, ...Object.fromEntries(f.hide!.map((k) => [k, { ...all[k], hidden: true }])) }));
    for (const p of f.polyhedra ?? []) {
      setBondRules((all) =>
        all.some((r) => r.centre === p.centre && r.neighbour === p.neighbour)
          ? all.map((r) => (r.centre === p.centre && r.neighbour === p.neighbour ? { ...r, polyhedra: true } : r))
          : [...all, { centre: p.centre, neighbour: p.neighbour, max: p.upTo, maxText: String(p.upTo), complete: true, polyhedra: true }],
      );
    }
    if (f.orbitals) {
      setOrbitalRules(
        f.orbitals.map((o) => ({ species: o.species, orbitals: [...o.orbitals], sizeText: String(o.size ?? DEFAULT_ORBITAL_SIZE), colours: [...(o.colours ?? DEFAULT_ORBITAL_COLOURS)] as [string, string], opacityText: String(DEFAULT_ORBITAL_OPACITY), iso: DEFAULT_ISO, texture: "soft" as OrbitalTexture, zText: "", xText: "", ...(o.zFrom ? { zMode: o.zFrom.mode, zNeighbour: o.zFrom.neighbour } : {}) })),
      );
    }
  };

  // What the file holds: its elements, and its species (an element, or several sharing a site).
  const contents = useMemo(() => {
    if (!structure) return { elements: [] as string[], species: [] as { key: string; components: { element: string; occupancy: number }[]; varied: boolean }[] };
    const species = new Map<string, { key: string; components: { element: string; occupancy: number }[]; varied: boolean }>();
    for (const atom of expandToUnitCell(structure).atoms) {
      const seen = species.get(atom.species);
      const text = JSON.stringify(atom.components);
      if (!seen) species.set(atom.species, { key: atom.species, components: [...atom.components], varied: false });
      else if (JSON.stringify(seen.components) !== text) seen.varied = true;
    }
    return { elements: [...new Set(structure.sites.map((x) => x.element))], species: [...species.values()] };
  }, [structure]);
  const sceneLooks = useMemo(() => {
    const out: Record<string, Look> = {};
    for (const [key, look] of Object.entries(looks)) {
      const radius = Number(look.radiusText);
      out[key] = {
        ...(look.hidden ? { hidden: true } : {}),
        ...(look.orderText !== undefined ? { order: look.orderText.split(/[\s,/]+/).filter(Boolean) } : {}),
        ...(look.colour !== undefined ? { colour: look.colour } : {}),
        ...(look.radiusText !== undefined && look.radiusText.trim() !== "" && radius >= 0.05 && radius <= 5 ? { radius } : {}),
        ...(look.name !== undefined && look.name.trim() !== "" ? { name: look.name.trim() } : {}),
      };
    }
    return out;
  }, [looks]);
  const nameOf = (species: string): string => sceneLooks[species]?.name ?? species;

  // The scene for the chosen range; while the range is unusable the last good scene stays on screen.
  const lastScene = useRef<Scene | null>(null);
  const { scene, rangeError } = useMemo((): { scene: Scene | null; rangeError: string } => {
    if (!structure) return { scene: null, rangeError: "" };
    const range = rangeFromText(rangeText, repeatBoundary ? "both" : "once");
    if (!range) return { scene: lastScene.current, rangeError: "Fill in all six limits." };
    try {
      // A rule whose distance box holds no usable number is left out until it does.
      const bonds = bondRules
        .filter((r) => r.max > 0.1 && r.max <= 10)
        .map((r) => {
          const width = Number(r.widthText);
          return r.widthText !== undefined && width >= 0.02 && width <= 2 ? { ...r, width } : r;
        });
      return { scene: buildScene(drawnStructure ?? structure, { range, bonds, showCell, looks: sceneLooks, showVacancy, angles: sceneAngles, ...(sceneOrbitals.length ? { orbitals: sceneOrbitals } : {}), showMoments, showDisplacements, displacementLength, displacementColour, displacementThickness, ...(arrowStyle ? { arrowStyle } : {}), momentTail, momentLength, momentColour, momentThickness, momentHeadSize, axesHeadSize, axesColoured, axesColours, momentOutline, axesOutline, axesKeepReadable: axesReadable, atomMaterial, arrowMaterial, bondMaterial, bondOutline, cellStyle, cellWidth, glassOpacity, letterWeight, fontFamily, legendFollowsZoom: legendFollows, legendSize, axesSize, legendFontPt, axesFontPt, angleFontPt, showLegend, showAxes }), rangeError: "" };
    } catch (e) {
      return { scene: lastScene.current, rangeError: e instanceof Error ? e.message : String(e) };
    }
  }, [sceneOrbitals, drawnStructure, showDisplacements, displacementLength, displacementColour, displacementThickness, arrowStyle, momentTail, structure, rangeText, repeatBoundary, bondRules, showCell, sceneLooks, showVacancy, sceneAngles, showMoments, momentLength, momentColour, momentThickness, momentHeadSize, axesHeadSize, axesColoured, axesColours, momentOutline, axesOutline, axesReadable, atomMaterial, arrowMaterial, bondMaterial, bondOutline, cellStyle, cellWidth, glassOpacity, letterWeight, fontFamily, legendFollows, legendSize, axesSize, legendFontPt, axesFontPt, angleFontPt, showLegend, showAxes]);
  // Every pair of elements in the file, with the distances between them (a guide for the bond length).
  const pairs = useMemo(() => {
    if (!structure) return [];
    const elements = contents.species.map((x) => x.key);
    const out: { key: string; centre: string; neighbour: string; distances: number[] }[] = [];
    elements.forEach((centre, i) => {
      for (const neighbour of elements.slice(i)) {
        const distances = pairDistances(structure, centre, neighbour);
        if (distances.length) out.push({ key: `${centre}-${neighbour}`, centre, neighbour, distances });
      }
    });
    return out.sort((p, q) => p.distances[0]! - q.distances[0]!);
  }, [structure, contents]);
  const addBond = () => {
    const pair = pairs.find((p) => p.key === newPair);
    if (!pair) return;
    // Suggested longest distance: 10 % above the shortest distance of this pair.
    const max = Math.ceil(pair.distances[0]! * 1.1 * 100) / 100;
    setBondRules((r) => [...r, { centre: pair.centre, neighbour: pair.neighbour, max, maxText: String(max), complete: false }]);
    setNewPair("");
  };
  // Rules with an unusable distance are left out of the scene; this maps a rule on the page to its place in the scene.
  const sceneRule = (index: number): number => bondRules.slice(0, index).filter((r) => r.max > 0.1 && r.max <= 10).length;
  const bondCount = (index: number): number => scene?.sticks.filter((s) => s.rule === sceneRule(index)).length ?? 0;
  const changeRule = (index: number, change: Partial<BondRule & { maxText: string; widthText: string }>) =>
    setBondRules((all) => all.map((x, i) => (i === index ? { ...x, ...change } : x)));
  lastScene.current = scene;
  const counts = useMemo(() => {
    const n = new Map<string, number>();
    for (const s of scene?.spheres ?? []) {
      const name = scene?.styles[s.style]?.name ?? s.style;
      n.set(name, (n.get(name) ?? 0) + 1);
    }
    return [...n].map(([name, k]) => `${name} ${k}`).join(", ");
  }, [scene]);
  // ---- Moving a large structure: the GPU preview stands in for the structure while the view is changing,
  // and the SVG is drawn again once it has been still for a moment. Small structures are simply redrawn.
  const preview = usePreview();
  const [smooth, setSmooth] = useState(true);
  const [previewFromText, setPreviewFromText] = useState(String(PREVIEW_LIMIT));
  const previewFrom = previewFromText.trim() !== "" && Number(previewFromText) >= 0 ? Number(previewFromText) : PREVIEW_LIMIT;
  // How much there is to redraw while moving: atoms and bonds (orbitals are left out until the view is still).
  const drawLoad = scene ? scene.spheres.length + scene.sticks.length : 0;
  const large = scene !== null && drawLoad >= previewFrom;
  const usePreviewNow = smooth && large && !preview.failed;
  useEffect(() => {
    if (!scene || !usePreviewNow || preview.loaded === scene) return;
    preview.load(scene);
    // Draw one frame at once, unseen: the graphics card then has the structure and the programs ready
    // before the first movement, instead of preparing them during it.
    const f = fitView(scene, view, canvas);
    preview.draw(previewFrame(scene, view, canvas, f), 720, 550);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, usePreviewNow, preview.loaded]);
  // The view and zoom last drawn in full. While the current ones differ, the structure is moving.
  const [settled, setSettled] = useState<{ view: View; zoom: Zoom; held: Fit | null }>({ view, zoom, held: heldFit });
  const moving = settled.view !== view || settled.zoom !== zoom || settled.held !== heldFit;
  useEffect(() => {
    if (!moving) return;
    // Still for a moment (and no button held): draw the figure in full again.
    const timer = setTimeout(() => setSettled({ view, zoom, held: heldFit }), heldFit ? 100000 : SETTLE_MS);
    return () => clearTimeout(timer);
  }, [moving, view, zoom, heldFit]);
  const previewing = usePreviewNow && moving && preview.loaded === scene;
  const canvasOptions = useMemo(() => ({ ...canvas, background: transparent ? null : "#ffffff" }), [canvas, transparent]);
  const fixedScale = Number(fixedScaleText) >= 2 && Number(fixedScaleText) <= 1000 ? Number(fixedScaleText) : 60;
  const fit = useMemo(() => {
    if (!scene) return null;
    // Fitted to the outline of each view (held still during a drag), or a scale that does not depend on the view.
    const base = scaleMode === "outline" ? (heldFit ?? fitView(scene, view, canvas, turnScale ?? undefined)) : steadyFit(scene, canvas, scaleMode === "fixed" ? fixedScale : undefined);
    return zoomedFit(base, zoom, structureCentre(scene, canvas));
  }, [scene, view, heldFit, turnScale, zoom, scaleMode, fixedScale, canvas]);
  // Ask the worker for each frame of the movement; `firstFrame` is the first of this movement.
  const [firstFrame, setFirstFrame] = useState(0);
  const wasPreviewing = useRef(false);
  useEffect(() => {
    if (!previewing || !scene || !fit || !figureRef.current) {
      if (wasPreviewing.current) setFirstFrame(0);
      wasPreviewing.current = false;
      return;
    }
    const r = figureRef.current.getBoundingClientRect();
    const k = Math.min(r.width / canvas.width, r.height / canvas.height) * Math.min(window.devicePixelRatio || 1, 2);
    const id = preview.draw(previewFrame(scene, view, canvas, fit), Math.round(canvas.width * k), Math.round(canvas.height * k));
    if (!wasPreviewing.current) setFirstFrame(id);
    wasPreviewing.current = true;
  }, [previewing, scene, view, fit, preview.draw]);
  // Where the drawing sits inside its frame, in screen px: centred, with the canvas's own shape.
  const [drawingBox, setDrawingBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  useEffect(() => {
    const el = figureRef.current?.parentElement;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth < 10 || el.clientHeight < 10) return;
      // By default the canvas takes the shape of its frame, so the figure uses all of it. Its width in px of
      // the figure stays the same; its height follows the frame. A fixed canvas keeps its own shape and is
      // shown as large as the frame allows, centred; the frame shows exactly the canvas.
      const width = DEFAULT_CANVAS.width;
      const height = physical
        ? Number(((width * physical.height) / physical.width).toFixed(2))
        : ratio !== null
          ? Number((width / ratio).toFixed(2))
          : Math.max(CANVAS_MIN_HEIGHT, Math.min(CANVAS_MAX_HEIGHT, Math.round((width * el.clientHeight) / el.clientWidth)));
      setCanvas((c) =>
        c.width === width && c.height === height && c.physical === (physical ?? undefined) ? c : { ...c, width, height, physical: physical ?? undefined },
      );
      const k = Math.min(el.clientWidth / width, el.clientHeight / height);
      const [w, h] = [width * k, height * k];
      setDrawingBox({ left: (el.clientWidth - w) / 2, top: (el.clientHeight - h) / 2, width: w, height: h });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scene !== null, physical, ratio]);
  // The preview is shown once the worker has drawn a frame of this movement; until then the last full figure stays.
  const previewLive = previewing && firstFrame > 0 && preview.drawn >= firstFrame;
  // The page shows the figure as two layers: the structure, and on top of it the legend and axes. While the
  // preview is live the structure layer is only hidden (its drawing is kept, so nothing has to be torn down),
  // and the legend and axes go on following the view. Both layers come from the same code as the saved figure.
  const lastStructure = useRef("");
  // While the view moves, the structure is drawn without its orbitals (atoms and bonds keep their places);
  // the orbitals come back once it is still, and are in every saved figure.
  const bareScene = useMemo(() => (scene ? withoutOrbitals(scene) : null), [scene]);
  const structureSvg = useMemo(() => {
    if (!scene || !bareScene || !fit) return "";
    if (!previewing) lastStructure.current = renderSvg(moving ? bareScene : scene, view, canvasOptions, fit, "structure");
    return lastStructure.current;
  }, [scene, bareScene, view, canvasOptions, fit, previewing, moving]);
  const bandSvg = useMemo(() => (scene && fit ? renderSvg(scene, view, canvasOptions, fit, "band") : ""), [scene, view, canvasOptions, fit]);
  /** What "Save" writes: always the full vector figure, as shown, or (if chosen) the whole structure fitted. */
  const figureToSave = (): string => {
    if (!scene || !fit) return "";
    return isZoomed(zoom) && !saveZoomed ? renderSvg(scene, view, canvasOptions) : renderSvg(scene, view, canvasOptions, fit);
  };
  const baseName = fileName.replace(/\.[^.]+$/, "") || "motif";

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    // The file is read here, in the page. Nothing is uploaded.
    if (file) void file.text().then((text) => openFile(text, file.name));
  };
  // ---- Gestures on the figure. Plain drag turns; Shift + drag or the middle button moves; Ctrl/Cmd + wheel,
  // a pinch, or the + and - keys zoom; double-click or 0 resets the zoom; "Box" then a drag zooms to a rectangle.
  const figureRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<"turn" | "move" | "box" | "pinch" | null>(null);
  // Touch: where and when each finger went down, the last finished one-finger touch (for a double tap), and how
  // far the two fingers of a pinch have turned so far (the roll starts only after a clear turn; see touch.ts).
  const touchDown = useRef(new Map<number, { x: number; y: number; at: number }>());
  const lastTouch = useRef<Touch | null>(null);
  const twistGathered = useRef(0);
  const [boxMode, setBoxMode] = useState(false);
  const [box, setBox] = useState<{ from: [number, number]; to: [number, number] } | null>(null);
  const centre = scene ? structureCentre(scene, canvas) : ([0, 0] as [number, number]);
  /** Px of the canvas per px of the screen, and the canvas point under a screen point. */
  const canvasScale = (): number => {
    const r = figureRef.current!.getBoundingClientRect();
    return 1 / Math.min(r.width / canvas.width, r.height / canvas.height);
  };
  const toCanvas = (clientX: number, clientY: number): [number, number] => {
    const r = figureRef.current!.getBoundingClientRect();
    const k = canvasScale();
    // The SVG is centred in the frame, with empty strips on two sides when the shapes differ.
    return [(clientX - r.left - (r.width - canvas.width / k) / 2) * k, (clientY - r.top - (r.height - canvas.height / k) / 2) * k];
  };
  // "Fit" (double-click, the 0 key): the whole structure fitted again, as large as the canvas allows.
  const resetZoom = () => {
    setZoom(NO_ZOOM);
    setTurnScale(null);
  };
  const zoomAtCentre = (by: number) => setZoom((z) => zoomAbout(z, by, centre, centre));

  const onPointerDown = (e: PointerEvent) => {
    if (!scene) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === "touch") touchDown.current.set(e.pointerId, { x: e.clientX, y: e.clientY, at: e.timeStamp });
    last.current = { x: e.clientX, y: e.clientY };
    if (pointers.current.size === 2) {
      gesture.current = "pinch";
      twistGathered.current = 0;
      setActing("pinch");
      setHeldFit(null);
      return;
    }
    if (boxMode) {
      gesture.current = "box";
      const p = toCanvas(e.clientX, e.clientY);
      setBox({ from: p, to: p });
    } else if (e.shiftKey || e.button === 1) {
      gesture.current = "move";
      e.preventDefault();
    } else {
      gesture.current = "turn";
      setHeldFit(fitView(scene, view, canvas, turnScale ?? undefined));
    }
    setActing(gesture.current);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!last.current || !gesture.current) return;
    const before = pointers.current.get(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.current === "pinch") {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (!before || !other) return;
      // Two fingers: spread to zoom about their middle, drag to move, twist to roll (see touch.ts).
      const step = twoFingerStep(before, { x: e.clientX, y: e.clientY }, other);
      const about = toCanvas(step.about.x, step.about.y);
      const k = canvasScale();
      setZoom((z) => panBy(zoomAbout(z, step.scale, about, centre), step.dx * k, step.dy * k));
      const roll = rollFor(twistGathered.current, step.turn);
      twistGathered.current += step.turn;
      // A clockwise twist turns the picture clockwise (as Alt + drag to the right does).
      if (roll !== 0) {
        cancelAnimationFrame(turning.current);
        setView((v) => rolled(v, -roll));
      }
      return;
    }
    const [dx, dy] = [e.clientX - last.current.x, e.clientY - last.current.y];
    last.current = { x: e.clientX, y: e.clientY };
    if (gesture.current === "box") {
      setBox((b) => (b ? { from: b.from, to: toCanvas(e.clientX, e.clientY) } : b));
    } else if (gesture.current === "move") {
      const k = canvasScale();
      setZoom((z) => panBy(z, dx * k, dy * k));
    } else {
      cancelAnimationFrame(turning.current);
      const degrees = 360 / DRAG_PX_PER_TURN;
      if (e.altKey) {
        // Alt + drag: roll about the line of sight; dragging right turns the picture clockwise.
        setView((v) => rolled(v, -dx * degrees));
      } else if (dragMode === "turntable" && axes) {
        // Left-right turns about the up axis, up-down tilts; the up axis stays as upright as the roll says.
        setView((v) => {
          const n = numbersFromView(axes, v, upAxis);
          return viewFromNumbers(axes, { up: upAxis, turn: n.turn + dx * degrees, tilt: Math.max(-90, Math.min(90, n.tilt + dy * degrees)), roll: n.roll });
        });
      } else {
        setView((v) => dragView(v, (dx * degrees * Math.PI) / 180, (dy * degrees * Math.PI) / 180));
      }
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const down = touchDown.current.get(e.pointerId);
    touchDown.current.delete(e.pointerId);
    if (down && gesture.current === "turn" && pointers.current.size === 0) {
      // A double tap fits the whole structure again, as a double click does.
      const t: Touch = { down, up: { x: e.clientX, y: e.clientY }, downAt: down.at, upAt: e.timeStamp };
      if (isDoubleTap(lastTouch.current, t)) {
        lastTouch.current = null;
        resetZoom();
      } else lastTouch.current = t;
    }
    if (gesture.current === "box" && box && scene) {
      setZoom((z) => zoomToBox(z, box.from, box.to, centre, canvas.width, structureHeight(scene, canvas)));
      setBoxMode(false);
    }
    setBox(null);
    if (pointers.current.size === 0) {
      // Released close to a low-index direction: click onto it exactly.
      if (gesture.current === "turn" && snap && near && near.angle > 0.02 && near.angle <= SNAP_DEGREES && structure) {
        goTo(snapTo(view, directionVector(structure.cell, near.direction)), true);
      }
      if (gesture.current === "turn" && heldFitRef.current) setTurnScale(heldFitRef.current.scale);
      last.current = null;
      gesture.current = null;
      setActing(null);
      setHeldFit(null); // centre the new orientation, at the same scale
    }
  };
  // Ctrl/Cmd + wheel (which is also what a trackpad pinch sends) zooms about the pointer. A plain wheel is
  // left alone, so the page still scrolls. The listener must be able to stop the browser's own page zoom.
  useEffect(() => {
    const el = figureRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const about = toCanvas(e.clientX, e.clientY);
      setZoom((z) => zoomAbout(z, Math.exp(-e.deltaY * 0.01), about, structureCentre(scene!, canvas)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, canvas]);
  const onKeyDown = (e: KeyboardEvent) => {
    const step = 60;
    if (e.key === "+" || e.key === "=") zoomAtCentre(1.25);
    else if (e.key === "-" || e.key === "_") zoomAtCentre(1 / 1.25);
    else if (e.key === "0") resetZoom();
    else if (e.key === "ArrowLeft") setZoom((z) => panBy(z, step, 0));
    else if (e.key === "ArrowRight") setZoom((z) => panBy(z, -step, 0));
    else if (e.key === "ArrowUp") setZoom((z) => panBy(z, 0, step));
    else if (e.key === "ArrowDown") setZoom((z) => panBy(z, 0, -step));
    else if (e.key === "Escape") {
      setBoxMode(false);
      setBox(null);
      gesture.current = null;
    } else return;
    e.preventDefault();
  };

  // ---- Saved settings: preferences for how figures look and are laid out (not the structure shown).
  const field = <T,>(value: T, set: (v: T) => void, valid: (v: unknown) => boolean): SettingField => ({ value, set: set as (v: never) => void, valid });
  const isMaterial = oneOf(...MATERIALS);
  // Element colours and radii only: names, hidden species and wedge orders belong to one file.
  const elementLooks = Object.fromEntries(
    Object.entries(looks)
      .filter(([k]) => !k.includes("/"))
      .map(([k, l]) => [k, { ...(l.colour ? { colour: l.colour } : {}), ...(l.radiusText ? { radiusText: l.radiusText } : {}) }])
      .filter(([, l]) => Object.keys(l as object).length > 0),
  );
  const isElementLooks = (v: unknown): boolean =>
    typeof v === "object" && v !== null && !Array.isArray(v) &&
    Object.values(v).every((l) => typeof l === "object" && l !== null && (l.colour === undefined || isColour(l.colour)) && (l.radiusText === undefined || isText(l.radiusText)));
  const isSavedViews = (v: unknown): boolean =>
    Array.isArray(v) && v.length <= 100 && v.every((x) => typeof x?.name === "string" && [0, 1, 2].includes(x.up) && [x.turn, x.tilt, x.roll].every(isNumber));
  const settingFields: Record<string, SettingField> = {
    // Visual
    atomMaterial: field(atomMaterial, setAtomMaterial, isMaterial),
    bondMaterial: field(bondMaterial, setBondMaterial, isMaterial),
    arrowMaterial: field(arrowMaterial, setArrowMaterial, isMaterial),
    glassOpacity: field(glassOpacity, setGlassOpacity, (v) => isNumber(v) && (v as number) >= 0.05 && (v as number) <= 1),
    bondOutline: field(bondOutline, setBondOutline, isBool),
    momentOutline: field(momentOutline, setMomentOutline, isBool),
    axesOutline: field(axesOutline, setAxesOutline, isBool),
    elementLooks: field(elementLooks, (v: Record<string, { colour?: string; radiusText?: string }>) => {
      preferredLooks.current = { ...v };
      setLooks((all) => {
      const next = { ...all };
      for (const [k, l] of Object.entries(v)) next[k] = { ...next[k], ...l };
      return next;
      });
    }, isElementLooks),
    showVacancy: field(showVacancy, setShowVacancy, isBool),
    momentColour: field(momentColour, setMomentColour, isColour),
    momentLength: field(momentLengthText, setMomentLengthText, isText),
    momentTail: field(momentTailText, setMomentTailText, isText),
    momentThickness: field(momentThicknessText, setMomentThicknessText, isText),
    arrowHead: field(momentHeadText, setMomentHeadText, isText),
    displacementLength: field(displacementLengthText, setDisplacementLengthText, isText),
    displacementColour: field(displacementColour, setDisplacementColour, isColour),
    displacementThickness: field(displacementThicknessText, setDisplacementThicknessText, isText),
    showCell: field(showCell, setShowCell, isBool),
    cellStyle: field(cellStyle, setCellStyle, oneOf("depth", "dashed", "solid")),
    cellWidth: field(cellWidthText, setCellWidthText, isText),
    showLegend: field(showLegend, setShowLegend, isBool),
    legendFollows: field(legendFollows, setLegendFollows, isBool),
    legendSize: field(legendSizeText, setLegendSizeText, isText),
    showAxes: field(showAxes, setShowAxes, isBool),
    axesSize: field(axesSizeText, setAxesSizeText, isText),
    axesHead: field(axesHeadText, setAxesHeadText, isText),
    axesReadable: field(axesReadable, setAxesReadable, isBool),
    axesColoured: field(axesColoured, setAxesColoured, isBool),
    axesColours: field(axesColours, setAxesColours, coloursOf(3)),
    fontFamily: field(fontFamily, setFontFamily, isText),
    customFont: field(customFont, setCustomFont, isBool),
    letterWeight: field(letterWeight, setLetterWeight, oneOf(400, 500, 800)),
    textSizes: field(fontPtText, setFontPtText, textRecord(["legend", "axes", "angle"])),
    // Layout and saving
    canvasFixed: field(canvasFixed, setCanvasFixed, isBool),
    canvasUnit: field(canvasUnit, setCanvasUnit, oneOf("cm", "in")),
    canvasSize: field(canvasSizeText, setCanvasSizeText, textsOf(2)),
    aspect: field(aspect, setAspect, oneOf(...ASPECTS.map((a) => a.key))),
    portrait: field(portrait, setPortrait, isBool),
    dpi: field(dpiText, setDpiText, isText),
    transparent: field(transparent, setTransparent, isBool),
    pngWidth: field(pngWidth, setPngWidth, (v) => isNumber(v) && (v as number) >= 100 && (v as number) <= 16000),
    saveZoomed: field(saveZoomed, setSaveZoomed, isBool),
    scaleMode: field(scaleMode, setScaleMode, oneOf("outline", "steady", "fixed")),
    fixedScale: field(fixedScaleText, setFixedScaleText, isText),
    dragMode: field(dragMode, setDragMode, oneOf("turntable", "free")),
    snap: field(snap, setSnap, isBool),
    animate: field(animate, setAnimate, isBool),
    keepView: field(keepView, setKeepView, isBool),
    smooth: field(smooth, setSmooth, isBool),
    previewFrom: field(previewFromText, setPreviewFromText, isText),
    showControls: field(showHelp, setShowHelp, isBool),
    // Structure: general habits, not one file's rules
    repeatBoundary: field(repeatBoundary, setRepeatBoundary, isBool),
    autoBonds: field(autoBonds, setAutoBonds, isBool),
    savedViews: field(savedViews, storeViews, isSavedViews),
  };
  const [settingsList, setSettingsList] = useState<SavedSettings[]>(storedSettings);
  const [settingsChoice, setSettingsChoice] = useState("");
  const [settingsName, setSettingsName] = useState("");
  const [startWith, setStartWith] = useState(defaultSettingsName);
  const [settingsNote, setSettingsNote] = useState("");
  const keepSettingsList = (list: SavedSettings[]) => {
    setSettingsList(list);
    if (!storeSettings(list)) setSettingsNote("This browser does not keep settings (a private window?). Export them to a file instead.");
  };
  const loadSettings = (s: SavedSettings) => {
    const skipped = applySettings(settingFields, s.values);
    setSettingsNote(`Loaded “${s.name}”.${skipped.length ? ` Not used: ${skipped.join(", ")} (unknown here, or not a usable value).` : ""}`);
  };
  // The settings chosen to open with, once, when the page starts.
  const startedWith = useRef(false);
  useEffect(() => {
    if (startedWith.current) return;
    startedWith.current = true;
    const chosen = storedSettings().find((s) => s.name === defaultSettingsName());
    if (chosen) applySettings(settingFields, chosen.values);
  });

  const cell = structure?.cell;
  /** A journal template: the width it prints (a share of it), keeping the shape, and its text size. */
  const applyJournal = (id: string, part: PartId) => {
    const size = journalSize(id);
    if (!size) return;
    const width = partWidth(size.width, part);
    const height = ratio !== null ? width / ratio : (width * canvas.height) / canvas.width;
    setCanvasFixed(true);
    setCanvasUnit(size.unit);
    setCanvasSizeText([`${width}`, short(height)]);
    const pt = String(journalTextPt(size.of, capHeight(fontFamily)));
    setFontPtText({ legend: pt, axes: pt, angle: pt });
    setJournalChoice(size.id);
    setJournalPart(part);
  };

  // ---- The assistant's view of the page (agent/tools.ts): the same state and setters the panel uses.
  const ruleIndex = (between: string): number => {
    const pair = splitPair(between);
    if (!pair) return -1;
    return bondRules.findIndex((r) => (r.centre === pair[0] && r.neighbour === pair[1]) || (r.centre === pair[1] && r.neighbour === pair[0]));
  };
  const pageNow: Page = {
    hasStructure: () => structure !== null,
    describe: (): FigureState => {
      const c = structure!.cell;
      const species = scene ? [...new Set(scene.spheres.map((x) => x.style))] : [];
      return {
        file: fileName,
        format: structure!.format ?? "",
        cell: `a ${c.a.toFixed(4)}, b ${c.b.toFixed(4)}, c ${c.c.toFixed(4)} Å; α ${c.alpha.toFixed(2)}, β ${c.beta.toFixed(2)}, γ ${c.gamma.toFixed(2)}°`,
        elements: [...new Set([...contents.species.map((x) => x.key), ...species])].map((key) => ({
          element: key,
          count: scene ? scene.spheres.filter((x) => x.style === key).length : 0,
          colour: scene?.styles[key]?.colour ?? "",
          radius: scene?.styles[key]?.radius ?? 0,
          hidden: looks[key]?.hidden === true,
        })),
        bonds: bondRules.map((r, i) => ({
          between: `${r.centre}–${r.neighbour}`,
          upTo: r.max,
          count: bondCount(i),
          colour: r.colour ?? DEFAULT_STICK.colour,
          thickness: r.width ?? DEFAULT_STICK.width,
          line: r.line ?? "solid",
          colouring: r.colouring === "atoms" ? "atom colours" : "one colour",
          fillTriangles: r.fill === true,
          ...(r.fill ? { triangleColour: r.fillColour ?? scene?.ruleInfo[sceneRule(i)]?.fillColour ?? "" } : {}),
          highlight: r.band === true,
          polyhedra: r.polyhedra ? (r.polyhedronLook === "line" ? "line art" : (r.polyhedronLook ?? "glass")) : "off",
          ...(r.polyhedra ? { polyhedronColour: r.polyhedronColour ?? scene?.polyhedra?.find((p) => p.rule === sceneRule(i))?.colour ?? "" } : {}),
        })),
        pairs: pairs.map((p) => ({ between: `${p.centre}–${p.neighbour}`, distances: p.distances.slice(0, 4).map((d) => Number(d.toFixed(3))) })),
        cells: `from ${rangeText.slice(0, 3).join(", ")} to ${rangeText.slice(3).join(", ")}`,
        view: viewLine,
        canvas: canvas.physical ? `${canvas.physical.width} × ${canvas.physical.height} ${canvas.physical.unit} on paper` : `fits the frame (${canvas.width} × ${canvas.height} px)`,
        angles: scene
          ? `can be marked: ${scene.angleKinds.map((k) => `${k.ends[0]}–${k.centre}–${k.ends[1]} (${k.count}; ${[...new Set(k.sizes.map((x) => x.toFixed(1)))].slice(0, 6).join(", ")}°)`).join("; ") || "none (angles exist between drawn bonds)"}. Marked: ${angleRules.map((r) => `${r.ends[0]}–${r.centre}–${r.ends[1]} ${r.min}–${r.max}°`).join("; ") || "none"}`
          : "",
        moments: momentRules
          ? `added by hand: ${momentRules.map((r) => `${r.element}${r.where ? ` at ${r.where.axis} = ${r.where.at}` : ""} ${r.size} μB along [${r.along.join(" ")}]`).join("; ")}`
          : structure!.sites.some((x) => x.moment)
            ? "from the file (a magnetic CIF)"
            : "none",
        journal: journalSize(journalChoice) ? `${journalSize(journalChoice)!.journal}, ${journalSize(journalChoice)!.label}, ${journalPart} width` : "none",
        settings: Object.fromEntries(Object.entries(settingFields).filter(([k]) => !["savedViews", "elementLooks"].includes(k)).map(([k, f]) => [k, f.value])),
      };
    },
    applySettings: (values) => applySettings(settingFields, values),
    setElement: (element, change) => {
      const key = contents.species.map((x) => x.key).find((k) => k.toLowerCase() === element.trim().toLowerCase());
      if (!key) return `There is no ${element} in this structure (it has ${contents.species.map((x) => x.key).join(", ")}).`;
      if (change.colour !== undefined && !/^#[0-9a-fA-F]{6}$/.test(change.colour)) return `"${change.colour}" is not a colour "#rrggbb".`;
      if (change.radius !== undefined && !(change.radius > 0.02 && change.radius <= 5)) return "The radius must be between 0.02 and 5 Å.";
      setLooks((l) => ({
        ...l,
        [key]: {
          ...l[key],
          ...(change.colour !== undefined ? { colour: change.colour.toLowerCase() } : {}),
          ...(change.radius !== undefined ? { radiusText: String(change.radius) } : {}),
          ...(change.hidden !== undefined ? { hidden: change.hidden } : {}),
        },
      }));
      return null;
    },
    addBonds: (centre, neighbour, upTo) => {
      const pair = pairs.find((p) => (p.centre === centre && p.neighbour === neighbour) || (p.centre === neighbour && p.neighbour === centre));
      if (!pair) return `${centre} and ${neighbour} are not a pair in this structure. Pairs: ${pairs.map((p) => `${p.centre}–${p.neighbour}`).join(", ")}.`;
      if (ruleIndex(`${centre}-${neighbour}`) >= 0) return `${pair.centre}–${pair.neighbour} bonds are already drawn; change them with change_bonds.`;
      if (upTo < pair.distances[0]! - 1e-9) return `The shortest ${pair.centre}–${pair.neighbour} distance is ${pair.distances[0]!.toFixed(3)} Å; ${upTo} Å would draw none.`;
      setBondRules((r) => [...r, { centre: pair.centre, neighbour: pair.neighbour, max: upTo, maxText: String(upTo), complete: false }]);
      return null;
    },
    changeBonds: (between, change) => {
      const i = ruleIndex(between);
      if (i < 0) return `No ${between} bonds are drawn. Drawn: ${bondRules.map((r) => `${r.centre}–${r.neighbour}`).join(", ") || "none"}.`;
      for (const c of [change.colour, change.triangleColour, change.polyhedronColour]) if (c !== undefined && !/^#[0-9a-fA-F]{6}$/.test(c)) return `"${c}" is not a colour "#rrggbb".`;
      if (change.upTo !== undefined && !(change.upTo > 0.1 && change.upTo <= 10)) return "up_to must be between 0.1 and 10 Å.";
      if (change.thickness !== undefined && !(change.thickness > 0.005 && change.thickness <= 1)) return "The thickness must be between 0.005 and 1 Å.";
      changeRule(i, {
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
      });
      return null;
    },
    removeBonds: (between) => {
      const i = ruleIndex(between);
      if (i < 0) return `No ${between} bonds are drawn.`;
      setBondRules((all) => all.filter((_, k) => k !== i));
      return null;
    },
    setView: (req) => {
      if (!structure || !axes) return "No structure is open.";
      const three = (v: readonly number[] | undefined) => v && v.length === 3 && v.every(Number.isFinite) && v.some((x) => x !== 0);
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
        goTo(presetView(structure.cell, preset.id));
        return null;
      }
      const now = numbersFromView(axes, view, upAxis);
      const up = req.up ? (["a", "b", "c"].indexOf(req.up) as Axis) : upAxis;
      const next = { up, turn: req.turn ?? now.turn, tilt: req.tilt ?? now.tilt, roll: req.roll ?? now.roll };
      if (Math.abs(next.tilt) > 90) return "tilt must be between -90 and 90 degrees.";
      applyNumbers(next);
      return null;
    },
    setCells: (from, to) => {
      if (from.some((f, k) => f >= to[k]!)) return 'Each "from" must be below its "to".';
      const cells = (to[0]! - from[0]!) * (to[1]! - from[1]!) * (to[2]! - from[2]!);
      if (cells > 1000) return `That is ${Math.round(cells)} cells; at most 1000.`;
      setRangeText([...from, ...to].map(String));
      return null;
    },
    setMoments: (rules) => {
      if (!structure) return { error: "No structure is open." };
      const base = structure.distortion && modesOn.length === structure.distortion.modes.length ? withDisplacements(structure, modesOn) : structure;
      try {
        const { counts } = withHandMoments(base, rules);
        setMomentRules(rules);
        setShowMoments(true);
        return { applied: rules.map((r, k) => `${r.element}${r.where ? ` at ${r.where.axis} = ${r.where.at}` : ""}: ${r.size} μB along [${r.along.join(" ")}] on ${counts[k]} atom${counts[k] === 1 ? "" : "s"}`).join("; ") };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
    markAngles: (req) => {
      if (!scene) return { error: "No structure is open." };
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
      setAngleRules((all) => [
        ...all.filter((r) => !same({ centre: r.centre, ends: r.ends })),
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
      ]);
      return { applied: `${kind.ends[0]}–${kind.centre}–${kind.ends[1]} from ${lo} to ${hi}° (${inRange} different size${inRange === 1 ? "" : "s"} in that range)` };
    },
    clearAngles: (req) => {
      if (angleRules.length === 0) return "No angles are marked.";
      if (!req) {
        setAngleRules([]);
        return null;
      }
      const keep = angleRules.filter((r) => !(r.centre === req.apex && ((r.ends[0] === req.ends[0] && r.ends[1] === req.ends[1]) || (r.ends[0] === req.ends[1] && r.ends[1] === req.ends[0]))));
      if (keep.length === angleRules.length) return `No ${req.ends[0]}–${req.apex}–${req.ends[1]} angles are marked.`;
      setAngleRules(keep);
      return null;
    },
    clearMoments: () => {
      if (!momentRules) return "There are no moments added by hand.";
      setMomentRules(null);
      return null;
    },
    saveStructure: (format: StructureFormat, fileName?: string) => {
      if (!drawnStructure) return { error: "No structure is open." };
      try {
        const base = (fileName || structure!.name || "structure").replace(/\.(cif|vasp|poscar|xyz|extxyz)$/i, "").replace(/[^A-Za-z0-9_.-]+/g, "_");
        const written = writeStructure(drawnStructure, format, base);
        const file = FORMATS.find((f) => f.id === format)!.file(base);
        const url = URL.createObjectURL(new Blob([written.text], { type: "text/plain" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = file;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return { applied: `${file}: ${written.atoms} atoms of one unit cell, no symmetry${written.notes.length ? `; ${written.notes.join("; ")}` : ""}` };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
    useJournal: (req) => {
      const found = matchJournal(req, journalPart);
      if (typeof found === "string") return { error: found };
      applyJournal(found.id, found.part);
      return { applied: describeJournal(found.id, found.part) };
    },
  };
  const pageRef = useRef(pageNow);
  pageRef.current = pageNow;
  // For the assistant's trials only ("?probe" in the address): the figure as the assistant sees it, read only.
  if (QUERY.has("probe")) (window as unknown as { __motifDescribe?: () => FigureState | null }).__motifDescribe = () => (pageRef.current.hasStructure() ? pageRef.current.describe() : null);
  // The tools call through the ref, so an exchange that spans several renders always sees the page as it is now.
  const assistantPage = useMemo<Page>(
    () => ({
      hasStructure: () => pageRef.current.hasStructure(),
      describe: () => pageRef.current.describe(),
      applySettings: (v) => pageRef.current.applySettings(v),
      setElement: (e, c) => pageRef.current.setElement(e, c),
      addBonds: (a, b, d) => pageRef.current.addBonds(a, b, d),
      changeBonds: (p, c) => pageRef.current.changeBonds(p, c),
      removeBonds: (p) => pageRef.current.removeBonds(p),
      setView: (v) => pageRef.current.setView(v),
      setCells: (f, t) => pageRef.current.setCells(f, t),
      useJournal: (r) => pageRef.current.useJournal(r),
      setMoments: (r) => pageRef.current.setMoments(r),
      clearMoments: () => pageRef.current.clearMoments(),
      markAngles: (r) => pageRef.current.markAngles(r),
      clearAngles: (r) => pageRef.current.clearAngles(r),
      saveStructure: (f, n) => pageRef.current.saveStructure(f, n),
    }),
    [],
  );
  // One conversation, shown in the drawer under the side tabs and in the Assistant tab.
  const chat = useAssistant(assistantPage);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark">MOTIF</span>
        </div>
        <div className="actions">
          <ThemeCue />
          <label className="button primary">
            Open file…
            <input
              type="file"
              data-testid="file"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void file.text().then((text) => openFile(text, file.name));
                e.target.value = ""; // so the same file can be opened again
              }}
            />
          </label>
          <select
            data-testid="example"
            value=""
            onChange={(e) => {
              const feature = FEATURES.find((x) => x.title === e.target.value);
              if (feature) loadFeature(feature);
            }}
          >
            <option value="">Examples…</option>
            {FEATURES.map((x) => (
              <option key={x.title} value={x.title}>
                {x.title}: {x.note}
              </option>
            ))}
          </select>
          {structure && (
            <button data-testid="close" title="Close this structure and go back to the start page" onClick={closeStructure}>
              Close
            </button>
          )}
          {scene && (
            <>
              <label className="check" title="Leave the background of the saved figure transparent">
                <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
                Transparent
              </label>
              <button data-testid="export-svg" title="Vector figure, editable in Keynote or Illustrator" onClick={() => download(new Blob([figureToSave()], { type: "image/svg+xml" }), `${baseName}.svg`)}>
                Save SVG
              </button>
              <span className="joined">
                <button
                  data-testid="export-png"
                  title={physical ? "Image made from the same SVG, at the size on paper and the dpi given" : "Image made from the same SVG, at the width given"}
                  onClick={() => {
                    (physical ? svgToPng(figureToSave(), pngSize[0], pngSize[1], dpi) : svgToPng(figureToSave(), pngWidth)).then(
                      (blob) => download(blob, `${baseName}.png`),
                      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
                    );
                  }}
                >
                  Save PNG
                </button>
                {physical ? (
                  <>
                    <input type="number" min={30} max={2400} step={50} data-testid="png-dpi" title="Resolution of the PNG, in dots per inch" value={dpiText} onChange={(e) => setDpiText(e.target.value)} />
                    <span className="unit" title={`The PNG will be ${pngSize[0]} × ${pngSize[1]} px`}>
                      dpi<span className="px-size" data-testid="png-size"> ({pngSize[0]} × {pngSize[1]} px)</span>
                    </span>
                  </>
                ) : (
                  <>
                    <input type="number" min={100} step={10} title="Width of the PNG in pixels" value={pngWidth} onChange={(e) => setPngWidth(Number(e.target.value))} />
                    <span className="unit">px ({(pngWidth / canvas.width).toFixed(2)}×)</span>
                  </>
                )}
              </span>
            </>
          )}
        </div>
      </header>
      {error && (
        <div className="notice bad" data-testid="error" role="alert">
          {error}
          <button className="plain" title="Dismiss" onClick={() => setError("")}>×</button>
        </div>
      )}
      {scene?.warnings.map((w) => (
        <div key={w} className="notice warn" data-testid="warning">{w}</div>
      ))}
      <main className={`work${scene ? "" : " alone"}`}>
        <section
          className={`card stage${over ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          {scene ? (
            <>
              <div className="stage-head">
                <b>{fileName}</b>
                <span data-testid="counts">{scene.spheres.length} atoms{counts && `: ${counts}`}</span>
              </div>
              <div className="toolbar">
                {structure?.format && !structure.rmc && (
                  <div className="tools" role="note">
                    <span className="tool-label format" data-testid="file-format" title={structure.spaceGroupName ?? structure.format}>
                      {structure.format}
                    </span>
                  </div>
                )}
                {structure?.rmc && (
                  <div className="tools rmc-switch" role="group" aria-label="RMC configuration: the whole supercell, or folded into one cell">
                    <span className="tool-label">RMC</span>
                    <button
                      className={structure.rmc.folded ? "" : "on"}
                      data-testid="rmc-quick-whole"
                      aria-pressed={!structure.rmc.folded}
                      title={`The whole supercell, ${structure.rmc.supercell.join(" × ")} cells, every atom as in the file`}
                      onClick={() => structure.rmc?.folded && refold(false)}
                    >
                      Supercell
                    </button>
                    <button
                      className={structure.rmc.folded ? "on" : ""}
                      data-testid="rmc-quick-fold"
                      aria-pressed={structure.rmc.folded}
                      title="Fold into one cell: each site at the average of its copies, as RMCProfile Workbench does"
                      onClick={() => structure.rmc && !structure.rmc.folded && refold(true)}
                    >
                      Fold
                    </button>
                  </div>
                )}
                <button
                  className={`help${showHelp ? " on" : ""}`}
                  data-testid="help"
                  title={showHelp ? "Hide the controls under the figure" : "Show the controls under the figure"}
                  aria-pressed={showHelp}
                  onClick={() => setShowHelp((x) => !x)}
                >
                  ?
                </button>
<div className="tools" role="group" aria-label="Look along a cell axis, pointing at you">
<span className="tool-label">along</span>
{(["a", "b", "c"] as const).map((name, k) => {
const indices: [number, number, number] = [0, 0, 0];
indices[k] = 1;
return (
<span key={name} className="pair">
<button data-testid={`along-${name}`} title={`Along ${name}, pointing at you`} onClick={() => lookAlong({ kind: "uvw", indices })}>{name}</button>
<button data-testid={`along-${name}-star`} title={`Along ${name}*, the normal to the planes, pointing at you`} onClick={() => lookAlong({ kind: "hkl", indices })}>{name}*</button>
</span>
);
})}
</div>
<div className="tools" role="group" aria-label="Turn the view">
<button data-testid="view-behind" title="The same line of sight, seen from the opposite side" onClick={() => goTo(fromBehind(view))}>Other side</button>
<button data-testid="view-quarter" title="Turn the picture a quarter turn about the line of sight" onClick={() => goTo(rolled(view, 90))}>Turn 90°</button>
<button
data-testid="view-reset"
onClick={() => {
setUpAxis(2);
goTo(axes ? viewFromNumbers(axes, openingNumbers(axes)) : DEFAULT_VIEW);
}}
>
Reset
</button>
<select
data-testid="view-preset"
className="view-preset"
value=""
title="Ready-made views, each with c up"
onChange={(e) => {
if (!structure || !e.target.value) return;
setUpAxis(2);
goTo(presetView(structure.cell, e.target.value as ViewPreset));
}}
>
<option value="">Views…</option>
{VIEW_PRESETS.map((p) => (
<option key={p.id} value={p.id} title={p.title}>
{p.label}
</option>
))}
</select>
</div>
              </div>
              <div className={`figure-wrap${showRulers ? " ruled" : ""}`}>
                {showRulers && drawingBox.width > 0 && (
                  <Rulers
                    box={drawingBox}
                    width={shownSize.width}
                    height={shownSize.height}
                    unit={shownSize.unit}
                    {...(canvas.physical ? { onUnit: () => setRulerUnit(shownSize.unit === "cm" ? "in" : "cm") } : {})}
                  />
                )}
                <div
                  ref={figureRef}
                  className={`figure${transparent ? "" : " white"}${boxMode ? " boxing" : ""}`}
                  data-testid="figure"
                  style={drawingBox.width > 0 ? { left: drawingBox.left, top: drawingBox.top, width: drawingBox.width, height: drawingBox.height, right: "auto", bottom: "auto" } : undefined}
                  tabIndex={0}
                  aria-label="The figure. Drag to turn; Shift and drag to move; Control or Command and the wheel to zoom; 0 resets the zoom."
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  onDoubleClick={resetZoom}
                  onKeyDown={onKeyDown}
                  onAuxClick={(e) => e.preventDefault()}
                >
                  <div className="layer" data-testid="layer-structure" data-hidden={previewLive ? "yes" : "no"} style={{ opacity: previewLive ? 0 : 1 }} dangerouslySetInnerHTML={{ __html: structureSvg }} />
                  <div className="layer" data-testid="layer-band" dangerouslySetInnerHTML={{ __html: bandSvg }} />
                </div>
                <canvas
                  ref={preview.canvasRef}
                  className="preview"
                  data-testid="preview"
                  data-live={previewLive ? "yes" : "no"}
                  // Laid out always and only made invisible: some browsers stop showing a worker's canvas that began hidden.
                  style={{ opacity: previewLive ? 1 : 0, left: drawingBox.left, top: drawingBox.top, width: drawingBox.width, height: drawingBox.height }}
                />
                {previewLive && (
                  <div className="preview-note" style={{ left: drawingBox.left + 12, top: drawingBox.top + 12 }}>
                    Simplified while moving
                  </div>
                )}
                {box && (() => {
                  // The dragged rectangle, in screen px of the frame.
                  const r = figureRef.current!.getBoundingClientRect();
                  const k = canvasScale();
                  const sx = (x: number): number => x / k + (r.width - canvas.width / k) / 2;
                  const sy = (y: number): number => y / k + (r.height - canvas.height / k) / 2;
                  return (
                    <div
                      className="zoom-box"
                      style={{ left: sx(Math.min(box.from[0], box.to[0])), top: sy(Math.min(box.from[1], box.to[1])), width: Math.abs(box.to[0] - box.from[0]) / k, height: Math.abs(box.to[1] - box.from[1]) / k }}
                    />
                  );
                })()}
                <div className="zoom-bar" role="group" aria-label="Zoom">
                  <button data-testid="zoom-out" title="Zoom out (−)" onClick={() => zoomAtCentre(1 / 1.25)}>−</button>
                  <span className="zoom-value" data-testid="zoom-value" title="Magnification relative to the fitted figure">{Math.round(zoom.factor * 100)}%</span>
                  <button data-testid="zoom-in" title="Zoom in (+)" onClick={() => zoomAtCentre(1.25)}>+</button>
                  <button data-testid="zoom-box" className={boxMode ? "on" : ""} title="Then drag a rectangle on the figure to zoom to it (Esc cancels)" onClick={() => setBoxMode((b) => !b)}>Box</button>
                  <button data-testid="zoom-reset" title="Back to the fitted figure (0, or double-click)" disabled={!isZoomed(zoom)} onClick={resetZoom}>Fit</button>
                </div>
              </div>
              <div className="stage-foot">
                <p className="view-line" data-testid="view-line" title="The view, always as it is now. Copy it to use the same view again.">
                  {viewLine}
                  <button className="plain copy" title="Copy the view" onClick={() => void navigator.clipboard?.writeText(writeView(numbers))}>⧉</button>
                  <span className="figure-size" data-testid="figure-size">
                    {" · figure "}
                    {sizeLabel(shownSize.width, shownSize.height, shownSize.unit)}
                  </span>
                </p>
                {showHelp && (
                  <Controls
                    active={
                      acting === "box" || boxMode
                        ? "box"
                        : acting === "pinch" || held.zoomKey
                          ? "zoom"
                          : acting === "move" || held.shift
                            ? "move"
                            : held.alt
                              ? "roll"
                              : acting === "turn"
                                ? "turn"
                                : null
                    }
                    turntable={dragMode === "turntable"}
                    snap={snap}
                    touch={TOUCH_SCREEN}
                  />
                )}
                {/* Always there, hidden when not zoomed: the frame must not change height when it appears, or the figure would jump. */}
                <label className="check" data-testid="save-zoomed-label" style={{ visibility: isZoomed(zoom) ? "visible" : "hidden" }}>
                  <input type="checkbox" data-testid="save-zoomed" checked={saveZoomed} disabled={!isZoomed(zoom)} onChange={(e) => setSaveZoomed(e.target.checked)} />
                  {saveZoomed ? "Save writes this zoomed view" : "Save writes the whole structure, not this zoomed view"}
                </label>
              </div>
            </>
          ) : (
            <div className="empty">
              <p className="empty-title">Drop a structure file here</p>
              <p>CIF, magnetic CIF or RMCProfile configuration (.rmc6f). Or use <b>Open file…</b> above, or start from an example:</p>
              <div className="examples features">
                {FEATURES.map((x, i) => (
                  <button key={x.title} data-testid={`feature-${x.title}`} title={`${x.title}: ${x.note}`} onClick={() => loadFeature(x)}>
                    <span className="number">{String(i + 1).padStart(2, "0")}</span>
                    <b>{x.title}</b>
                    <span className="note">{x.note}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
        {structure && scene && cell && (
          <aside className="side">
            <div className="tabs" role="tablist">
              {TABS.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} data-testid={`tab-${t.id}`} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
            <TabContext.Provider value={tab}>
            <div className="tab-body">
            {/* Kept mounted, so the conversation stays when another tab is open. */}
            <div hidden={tab !== "assistant"} className="assistant-tab">
              <AssistantPanel chat={chat} />
            </div>
            <Section tab="info" title="File" hint="What the file says. Nothing here changes the figure.">
              <table data-testid="info">
                <tbody>
                  <tr><td>Name</td><td>{structure.name}</td></tr>
                  <tr><td>{structure.magnetic ? "Magnetic space group" : "Space group"}</td><td>{structure.spaceGroupName ?? "not named"}</td></tr>
                  <tr><td>a, b, c (Å)</td><td>{cell.a}, {cell.b}, {cell.c}</td></tr>
                  <tr><td>α, β, γ (°)</td><td>{cell.alpha}, {cell.beta}, {cell.gamma}</td></tr>
                  <tr><td>Symmetry operations</td><td>{structure.operations.length}</td></tr>
                  <tr><td>Sites in the file</td><td>{structure.sites.length}</td></tr>
                  {drawnStructure?.momentsByHand && <tr><td>Moments</td><td data-testid="moments-by-hand">added by hand, not from the file</td></tr>}
                  {largestMoment(structure) > 0 && (
                    <tr><td>Largest moment</td><td data-testid="largest-moment">{largestMoment(structure).toFixed(2)} μB</td></tr>
                  )}
                  {structure.rmc?.folded && (
                    <tr><td>Folded from</td><td data-testid="rmc-info">{structure.rmc.supercell.join(" × ")} cells; copies found by {structure.rmc.grouping}; largest rms spread of a site {structure.rmc.largestSpread?.toFixed(3)} Å</td></tr>
                  )}
                  {structure.distortion && (
                    <tr><td>Distortion</td><td data-testid="distortion-info">{[...new Set(structure.distortion.modes.map((m) => modeName(m.label).irrep))].join(", ")} of the parent; largest displacement {largestDisplacement(structure).toFixed(3)} Å</td></tr>
                  )}
                  <tr><td>Atoms drawn</td><td>{scene.spheres.length}{counts && ` (${counts})`}</td></tr>
                </tbody>
              </table>
            </Section>
            {structure.rmc && (
              <Section tab="structure" title="RMC configuration" hint="An RMCProfile configuration is a supercell with every atom listed. Whole supercell: every atom as it is, with no symmetry (P1). Folded into one cell: each atom moved into one cell, and each site drawn at the average position of its copies (grouped by the file's site numbers), with each element's share of the copies as its occupancy, so a site shared by two elements is a pie sphere. The average is that of RMCProfile Workbench.">
                {(["whole", "folded"] as const).map((mode) => (
                  <label className="row" key={mode}>
                    <input
                      type="radio"
                      name="rmc-fold"
                      data-testid={`rmc-${mode}`}
                      checked={structure.rmc!.folded === (mode === "folded")}
                      onChange={() => refold(mode === "folded")}
                    />
                    {mode === "whole" ? `Whole supercell (${structure.rmc!.supercell.join(" × ")} cells, P1)` : "Folded into one cell, each site averaged"}
                  </label>
                ))}
              </Section>
            )}
            <Section tab="structure" title="Cells shown" hint="The part of the crystal that is drawn: a range along each cell axis, in units of the cell edge. Whole numbers give whole cells; a narrow range gives a slab. An atom within 0.001 of a limit counts as on it.">
              {AXES.map((axis, i) => (
                <div className="row" key={axis}>
                  <i className="axis">{axis}</i> from
                  {[i, i + 3].map((k) => (
                    <span key={k} className="row">
                      {k >= 3 && "to"}
                      <input
                        type="number"
                        step={0.1}
                        data-testid={`range-${k}`}
                        value={rangeText[k]}
                        onChange={(e) => setRangeText((t) => t.map((old, j) => (j === k ? e.target.value : old)))}
                      />
                    </span>
                  ))}
                </div>
              ))}
              <div className="row">
                {[1, 2, 3].map((n) => (
                  <button key={n} data-testid={`cells-${n}`} onClick={() => setRangeText(["0", "0", "0", `${n}`, `${n}`, `${n}`])}>
                    {n}×{n}×{n}
                  </button>
                ))}
              </div>
              <label className="row">
                <input type="checkbox" data-testid="repeat-boundary" checked={repeatBoundary} onChange={(e) => setRepeatBoundary(e.target.checked)} />
                Repeat atoms on the boundary
              </label>
              <p className="sub">
                {repeatBoundary
                  ? "An atom on the edge of the range is drawn at both ends, so a cell looks complete."
                  : "Each atom is drawn once per cell: the true content of the cell."}
              </p>
              {rangeError && <p className="error" data-testid="range-error">{rangeError}</p>}
            </Section>
            <Section tab="structure" title="Elements shown" hint="Untick an element to leave out its atoms, its bonds and any neighbours added for it. A site shared by several elements is one atom, drawn as a pie.">
              {contents.elements.map((element) => {
                const pure = contents.species.find((x) => x.key === element);
                return pure ? (
                  <label className="row" key={element}>
                    <input type="checkbox" title={`Show ${element}`} data-testid={`show-${element}`} checked={!looks[element]?.hidden} onChange={(e) => setLook(element, { hidden: !e.target.checked })} />
                    <span className="swatch" style={{ background: elementColour(element, sceneLooks) }} />
                    <b className="symbol">{element}</b>
                  </label>
                ) : null;
              })}
              {contents.species.filter((x) => x.components.length > 1).map((x) => (
                <label className="row" key={x.key}>
                  <input type="checkbox" title="Show this site" checked={!looks[x.key]?.hidden} onChange={(e) => setLook(x.key, { hidden: !e.target.checked })} />
                  <b>{looks[x.key]?.name ?? x.key}</b>
                  <span className="sub">
                    shared site: {x.components.map((c) => `${c.element} ${c.occupancy}`).join(", ")}
                    {x.varied && " (and other proportions)"}
                  </span>
                </label>
              ))}
            </Section>
            <Section tab="structure" title="Bonds" hint="A bond joins every pair of the two chosen atoms that are no further apart than the distance given. The list shows the distances found in the structure, shortest first. Colour, thickness and highlights are under Visual.">
              {autoNote && bondRules.length > 0 && (
                <p className="sub" data-testid="auto-note">
                  Added when the file was opened: {autoNote}. Change or remove them as you like.
                </p>
              )}
              {bondRules.length > 0 && (
                <div className="row">
                  <button data-testid="remove-bonds" onClick={() => { setBondRules([]); setAutoNote(""); }}>Remove all bonds</button>
                </div>
              )}
              <label className="row" title="Each kind of cation is joined to its nearest anions (or a single element to itself), first shell only, and the neighbours just outside the range are added. A pair that would give an atom more than eight bonds is left out.">
                <input type="checkbox" data-testid="auto-bonds" checked={autoBonds} onChange={(e) => setAutoBonds(e.target.checked)} />
                Add bonds when a file is opened
              </label>
              {bondRules.map((r, index) => (
                <div key={index} className="rule" data-testid={`bond-${index}`}>
                  <div className="row">
                    <b>{nameOf(r.centre)}–{nameOf(r.neighbour)}</b> up to
                    <input
                      type="number"
                      step={0.05}
                      min={0.2}
                      max={10}
                      value={r.maxText}
                      onChange={(e) => setBondRules((all) => all.map((x, i) => (i === index ? { ...x, maxText: e.target.value, max: Number(e.target.value) } : x)))}
                    />
                    Å
                    {r.centre !== r.neighbour && (
                      <button
                        title="Swap which of the two is the centre"
                        data-testid={`bond-swap-${index}`}
                        onClick={() => setBondRules((all) => all.map((x, i) => (i === index ? { ...x, centre: x.neighbour, neighbour: x.centre } : x)))}
                      >
                        ⇄
                      </button>
                    )}
                    <button title="Remove this bond" onClick={() => setBondRules((all) => all.filter((_, i) => i !== index))}>×</button>
                  </div>
                  <label className="row" title={r.polyhedra ? "Polyhedra need every corner, so these are always added while they are drawn." : undefined}>
                    <input
                      type="checkbox"
                      checked={r.complete || (r.polyhedra ?? false)}
                      disabled={r.polyhedra ?? false}
                      onChange={(e) => setBondRules((all) => all.map((x, i) => (i === index ? { ...x, complete: e.target.checked } : x)))}
                    />
                    Add {nameOf(r.neighbour)} outside the range bonded to {nameOf(r.centre)} inside
                  </label>
                  <label className="row">
                    <input type="checkbox" data-testid={`bond-unbonded-${index}`} checked={r.hideUnbonded ?? false} onChange={(e) => changeRule(index, { hideUnbonded: e.target.checked })} />
                    Hide {nameOf(r.neighbour)} with no such bond
                  </label>
                  {r.centre === r.neighbour && (
                    <label className="row">
                      <input type="checkbox" data-testid={`bond-triangles-${index}`} checked={r.onlyTriangles ?? false} onChange={(e) => changeRule(index, { onlyTriangles: e.target.checked })} />
                      Keep only atoms and bonds of complete triangles
                    </label>
                  )}
                  <label className="row" title={`The coordination polyhedron round each ${nameOf(r.centre)} inside the range: the solid whose corners are the ${nameOf(r.neighbour)} this rule bonds it to.`}>
                    <input type="checkbox" data-testid={`bond-polyhedra-${index}`} checked={r.polyhedra ?? false} onChange={(e) => changeRule(index, { polyhedra: e.target.checked })} />
                    Polyhedra round {nameOf(r.centre)}
                  </label>
                  {r.polyhedra && (
                    <>
                      <div className="row">
                        <span className="lab">look</span>
                        <select data-testid={`polyhedron-look-${index}`} value={r.polyhedronLook ?? "glass"} onChange={(e) => changeRule(index, { polyhedronLook: e.target.value as PolyhedronLook })}>
                          <option value="glass">Glass: see-through, every edge</option>
                          <option value="solid">Solid: shaded faces</option>
                          <option value="line">Line art: white, hidden edges dashed</option>
                        </select>
                        <input
                          type="color"
                          data-testid={`polyhedron-colour-${index}`}
                          title={`Colour of the polyhedra (usually the colour of ${nameOf(r.centre)})`}
                          value={r.polyhedronColour ?? scene?.polyhedra?.find((p) => p.rule === sceneRule(index))?.colour ?? "#cccccc"}
                          onChange={(e) => changeRule(index, { polyhedronColour: e.target.value })}
                        />
                        {r.polyhedronColour && (
                          <button className="plain" title={`Back to the colour of ${nameOf(r.centre)}`} data-testid={`polyhedron-colour-reset-${index}`} onClick={() => changeRule(index, { polyhedronColour: undefined })}>
                            ↺
                          </button>
                        )}
                      </div>
                      {(r.polyhedronLook ?? "glass") === "glass" && (
                        <div className="row slider" title="How solid the faces are: to the left clearer, to the right less see-through.">
                          <span className="lab">faces</span>
                          <input
                            type="range"
                            min={0.1}
                            max={1}
                            step={0.05}
                            data-testid={`polyhedron-opacity-${index}`}
                            value={r.polyhedronOpacity ?? DEFAULT_POLYHEDRON_OPACITY}
                            onChange={(e) => changeRule(index, { polyhedronOpacity: Number(e.target.value) })}
                          />
                          <span className="sub">{Math.round((r.polyhedronOpacity ?? DEFAULT_POLYHEDRON_OPACITY) * 100)}% solid</span>
                        </div>
                      )}
                      <label className="row">
                        <input type="checkbox" data-testid={`polyhedron-bonds-${index}`} checked={r.polyhedronBonds ?? false} onChange={(e) => changeRule(index, { polyhedronBonds: e.target.checked })} />
                        Also draw the {nameOf(r.centre)}–{nameOf(r.neighbour)} bonds inside
                      </label>
                    </>
                  )}
                  <p className="sub" data-testid={`bond-count-${index}`}>
                    {r.max > 0.1 && r.max <= 10
                      ? `${bondCount(index)} bonds drawn, in ${scene?.ruleInfo[sceneRule(index)]?.groups ?? 0} connected group(s); ${scene?.ruleInfo[sceneRule(index)]?.triangles ?? 0} triangles` +
                        (r.polyhedra ? `; ${polyhedraText(scene?.ruleInfo[sceneRule(index)]?.polyhedra)}` : "")
                      : "Give a distance between 0.1 and 10 Å."}
                  </p>
                </div>
              ))}
              <div className="row">
                <select className="grow" data-testid="new-pair" value={newPair} onChange={(e) => setNewPair(e.target.value)}>
                  <option value="">Add a bond between…</option>
                  {pairs.map((p) => (
                    <option key={p.key} value={p.key}>
                      {nameOf(p.centre)}–{nameOf(p.neighbour)} (distances {p.distances.slice(0, 3).map((d) => d.toFixed(2)).join(", ")} Å…)
                    </option>
                  ))}
                </select>
                <button data-testid="add-bond" disabled={!newPair} onClick={addBond}>Add</button>
              </div>
            </Section>
            <Section tab="structure" title="Angles" hint="Marks the angle between two drawn bonds that meet at an atom, so add the bonds first. The list shows the kinds of angle found and their sizes. Every angle of the chosen kind whose size lies in the range is marked. Colour, size and labels are under Visual.">
              {angleRules.map((r, index) => (
                <div key={index} className="rule" data-testid={`angle-${index}`}>
                  <div className="row">
                    <b>{nameOf(r.ends[0])}–{nameOf(r.centre)}–{nameOf(r.ends[1])}</b>
                    <button title="Remove this angle" onClick={() => setAngleRules((all) => all.filter((_, i) => i !== index))}>×</button>
                  </div>
                  <div className="row">
                    <span className="lab">from</span>
                    <input type="number" step={0.5} min={0} max={180} data-testid={`angle-min-${index}`} value={r.minText} onChange={(e) => changeAngle(index, { minText: e.target.value })} />
                    to
                    <input type="number" step={0.5} min={0} max={180} data-testid={`angle-max-${index}`} value={r.maxText} onChange={(e) => changeAngle(index, { maxText: e.target.value })} />
                    °
                  </div>
                  {(() => {
                    const kind = scene.angleKinds.find((x) => x.centre === r.centre && x.ends[0] === r.ends[0] && x.ends[1] === r.ends[1]);
                    if (!kind) return <p className="sub">No such angle among the bonds drawn now.</p>;
                    const [lo, hi] = [Number(r.minText), Number(r.maxText)];
                    return (
                      <>
                        <AnglePlot
                          sizes={kind.sizes}
                          counts={kind.counts}
                          min={r.minText.trim() === "" || !(lo >= 0) ? 0 : lo}
                          max={r.maxText.trim() === "" || !(hi <= 180) ? 180 : hi}
                          colour={r.colour ?? DEFAULT_ANGLE_LOOK.colour}
                          onRange={(a, b) => changeAngle(index, { minText: String(a), maxText: String(b) })}
                          onHover={(range) => setAngleHover(range ? { rule: index, range } : null)}
                        />
                        <div className="row">
                          <span className="sub">Click a bar, or drag across several.</span>
                          <button data-testid={`angle-all-${index}`} onClick={() => changeAngle(index, { minText: "0", maxText: "180" })}>All</button>
                        </div>
                      </>
                    );
                  })()}
                  <p className="sub" data-testid={`angle-count-${index}`}>{scene.sectors.filter((x) => x.rule === index).length} angles marked</p>
                </div>
              ))}
              {scene.angleKinds.length === 0 ? (
                <p className="sub">No two drawn bonds meet at an atom yet. Add bonds first.</p>
              ) : (
                <div className="row">
                  <select className="grow" data-testid="new-angle" value={newAngle} onChange={(e) => setNewAngle(e.target.value)}>
                    <option value="">Mark an angle…</option>
                    {scene.angleKinds.map((k) => {
                      const key = `${k.ends[0]}|${k.centre}|${k.ends[1]}`;
                      const sizes = k.sizes.length <= 4 ? k.sizes.map((x) => x.toFixed(1)).join(", ") : `${k.sizes[0]!.toFixed(1)} to ${k.sizes[k.sizes.length - 1]!.toFixed(1)}`;
                      return (
                        <option key={key} value={key}>
                          {nameOf(k.ends[0])}–{nameOf(k.centre)}–{nameOf(k.ends[1])} ({sizes}°)
                        </option>
                      );
                    })}
                  </select>
                  <button
                    data-testid="add-angle"
                    disabled={!newAngle}
                    onClick={() => {
                      const kind = scene.angleKinds.find((k) => `${k.ends[0]}|${k.centre}|${k.ends[1]}` === newAngle);
                      if (!kind) return;
                      // The range starts wide enough to hold every size of this kind, except straight angles.
                      const sizes = kind.sizes.filter((x) => x < 179.5);
                      const lo = Math.max(0, Math.floor((sizes[0] ?? 0) - 0.5));
                      const hi = Math.min(180, Math.ceil((sizes[sizes.length - 1] ?? 180) + 0.5));
                      setAngleRules((all) => [
                        ...all,
                        { centre: kind.centre, ends: kind.ends, min: lo, max: hi, minText: String(lo), maxText: String(hi), radiusText: String(DEFAULT_ANGLE_LOOK.radius), opacityText: String(DEFAULT_ANGLE_LOOK.opacity) },
                      ]);
                      setNewAngle("");
                    }}
                  >
                    Add
                  </button>
                </div>
              )}
            </Section>
            <Section tab="structure" title="Orbitals" hint="A schematic of each orbital: the isosurface of a hydrogen-like wavefunction of its kind (1s, 2p, 3d, 4f), its lobes coloured by the sign of the wavefunction; its isovalue, size and colours are under Visual. The axes are MOTIF's (x along a, y in the a–b plane, z along c*), or a local frame: z along a crystal direction [u v w] you give (towards a ligand, say), x along a second one. Size and colours are under Visual.">
              {orbitalRules.map((r, index) => (
                <div key={index} className="rule" data-testid={`orbital-${index}`}>
                  <div className="row">
                    <b>{nameOf(r.species)}</b>
                    <button title="Remove these orbitals" onClick={() => setOrbitalRules((all) => all.filter((_, i) => i !== index))}>×</button>
                  </div>
                  {[0, 1, 2, 3].map((l) => (
                    <div className="row orbital-row" key={l}>
                      <span className="lab">{"spdf"[l]}</span>
                      <span className="picks">
                      {ORBITALS.filter((o) => o.l === l).map((o) => (
                        <label key={o.id} className="pick">
                          <input
                            type="checkbox"
                            data-testid={`orbital-${index}-${o.id}`}
                            checked={r.orbitals.includes(o.id)}
                            onChange={(e) => changeOrbitalRule(index, { orbitals: e.target.checked ? [...r.orbitals, o.id] : r.orbitals.filter((x) => x !== o.id) })}
                          />
                          {o.label}
                        </label>
                      ))}
                      </span>
                    </div>
                  ))}
                  <div className="row" title="The orbital's local z. Along [u v w]: one crystal direction for every atom (empty: the crystal axes, z along c*). From bonds: each atom's own, so an orbital order shows. Longest bond: along the atom's longest bond to the species chosen (its first shell). Bridge: along the line through its two nearest atoms of that species, as an O between two metals.">
                    <span className="lab">local z</span>
                    <select data-testid={`orbital-zmode-${index}`} value={r.zMode ?? "uvw"} onChange={(e) => changeOrbitalRule(index, { zMode: e.target.value as "uvw" | "longest" | "bridge", zNeighbour: r.zNeighbour ?? contents.species.find((x) => x.key !== r.species)?.key ?? "" })}>
                      <option value="uvw">along [u v w]</option>
                      <option value="longest">longest bond to</option>
                      <option value="bridge">line through two</option>
                    </select>
                    {(r.zMode ?? "uvw") === "uvw" ? (
                      <input type="text" className="indices" placeholder="u v w" data-testid={`orbital-z-${index}`} value={r.zText} onChange={(e) => changeOrbitalRule(index, { zText: e.target.value })} />
                    ) : (
                      <select data-testid={`orbital-zneighbour-${index}`} value={r.zNeighbour ?? ""} onChange={(e) => changeOrbitalRule(index, { zNeighbour: e.target.value })}>
                        {contents.species.map((x) => (
                          <option key={x.key} value={x.key}>
                            {nameOf(x.key)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {(r.zMode ?? "uvw") === "uvw" && r.zText.trim() !== "" && (
                    <div className="row" title="Local x: a second crystal direction; its part perpendicular to z is used (empty: from a).">
                      <span className="lab">local x</span>
                      <input type="text" className="indices" placeholder="u v w" value={r.xText} onChange={(e) => changeOrbitalRule(index, { xText: e.target.value })} />
                      <span className="unit">optional</span>
                    </div>
                  )}
                </div>
              ))}
              <div className="row">
                <select className="grow" data-testid="new-orbital" value={newOrbitalSpecies} onChange={(e) => setNewOrbitalSpecies(e.target.value)}>
                  <option value="">Add orbitals on…</option>
                  {contents.species.map((x) => (
                    <option key={x.key} value={x.key}>
                      {nameOf(x.key)}
                    </option>
                  ))}
                </select>
                <button
                  data-testid="add-orbital"
                  disabled={!newOrbitalSpecies}
                  onClick={() => {
                    setOrbitalRules((all) => [...all, { species: newOrbitalSpecies, orbitals: ["dz2"], sizeText: String(DEFAULT_ORBITAL_SIZE), colours: [...DEFAULT_ORBITAL_COLOURS] as [string, string], opacityText: String(DEFAULT_ORBITAL_OPACITY), iso: DEFAULT_ISO, texture: "soft", zText: "", xText: "" }]);
                    setNewOrbitalSpecies("");
                  }}
                >
                  Add
                </button>
              </div>
            </Section>
            {structure.distortion && drawnStructure && (
              <Section tab="structure" title="Distortion modes" hint="From an ISODISTORT file: the atoms are the distorted structure, and each arrow starts at an atom's centre and shows its displacement from the parent structure, summed over the modes ticked. The amplitudes are in Å, as ISODISTORT gives them; the arrow of the largest displacement has the length set under Visual, the others in proportion.">
                {structure.distortion.modes.map((m, j) => {
                  const name = modeName(m.label);
                  return (
                    <label className="row" key={j} title={m.label}>
                      <input
                        type="checkbox"
                        data-testid={`mode-${j}`}
                        checked={modesOn[j] ?? true}
                        onChange={(e) => setModesOn((all) => all.map((x, k) => (k === j ? e.target.checked : x)))}
                      />
                      <b>{name.irrep}</b>
                      {name.part}
                      <span className="sub">{m.amplitude.toFixed(4)} Å</span>
                    </label>
                  );
                })}
                <p className="sub" data-testid="largest-displacement">
                  Largest displacement now: {largestDisplacement(drawnStructure).toFixed(3)} Å.
                  {structure.distortion.notDrawn.length > 0 && ` Not drawn: ${structure.distortion.notDrawn.join(", ")}.`}
                </p>
              </Section>
            )}
            {arrowSource && (
              <Section tab="structure" title="Arrows" hint="The file gives a vector on some atoms: magnetic moments (an mCIF) or displacements (an ISODISTORT file). Either can be drawn as moments, through the atom and centred on it, or as displacements, starting at the atom's centre in their own colour and thickness. The arrow of the largest vector has the length set under Visual, the others in proportion.">
                <label className="row">
                  <input
                    type="checkbox"
                    data-testid="show-arrows"
                    checked={arrowSource === "moment" ? showMoments : showDisplacements}
                    onChange={(e) => (arrowSource === "moment" ? setShowMoments(e.target.checked) : setShowDisplacements(e.target.checked))}
                  />
                  Draw arrows
                </label>
                {(["moment", "displacement"] as const).map((style) => (
                  <label className="row" key={style}>
                    <input type="radio" name="arrow-style" data-testid={`arrow-style-${style}`} checked={arrowStyle === style} onChange={() => setArrowStyleChoice(style)} />
                    {style === "moment" ? "as moments: through the atom, centred" : "as displacements: from the atom's centre"}
                  </label>
                ))}
                <p className="sub" data-testid="arrow-source">
                  {arrowSource === "moment"
                    ? `The file gives magnetic moments; the largest is ${largestMoment(structure).toFixed(2)} μB.`
                    : `The file gives displacements; the largest is ${largestDisplacement(drawnStructure ?? structure).toFixed(3)} Å.`}
                </p>
              </Section>
            )}
            <Section tab="visual" title="Shading and outlines" hint="How the atoms, bonds and arrows are shaded, and which are outlined. A quick style sets the shading, outlines, lettering weight and legend size together; each can still be changed afterwards. All shading is vector gradients, so the figure stays an editable SVG.">
              <div className="row">
                <span className="lab">quick style</span>
                <select data-testid="style-preset" value="" onChange={(e) => applyPreset(e.target.value)}>
                  <option value="">choose one…</option>
                  {Object.keys(PRESETS).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <span className="lab">atoms</span>
                {materialChoice("atom-material", atomMaterial, setAtomMaterial)}
              </div>
              <div className="row" title="Bonds are drawn as round rods that meet the atoms as a real rod would. Above 1,500 bonds they are drawn as plain strokes, which is much faster.">
                <span className="lab">bonds</span>
                {materialChoice("bond-material", bondMaterial, setBondMaterial)}
              </div>
              <div className="row">
                <span className="lab">arrows</span>
                {materialChoice("arrow-material", arrowMaterial, setArrowMaterial)}
                <span className="sub">moments, axes</span>
              </div>
              {[atomMaterial, bondMaterial, arrowMaterial].includes("glass") && (
                <div className="row slider" title="How solid the glass is: to the left clearer, to the right less see-through. One setting for every glass surface.">
                  <span className="lab">glass</span>
                  <input type="range" min={0.05} max={1} step={0.05} data-testid="glass-solid" value={glassOpacity} onChange={(e) => setGlassOpacity(Number(e.target.value))} />
                  <span className="sub">{Math.round(glassOpacity * 100)}% solid</span>
                </div>
              )}
              <p className="sub group">Thin dark outline on</p>
              <label className="row">
                <input type="checkbox" data-testid="bond-outline" checked={bondOutline} onChange={(e) => setBondOutline(e.target.checked)} />
                bonds
              </label>
              {arrowSource && (
                <label className="row">
                  <input type="checkbox" data-testid="moment-outline" checked={momentOutline} onChange={(e) => setMomentOutline(e.target.checked)} />
                  arrows on atoms
                </label>
              )}
              <label className="row">
                <input type="checkbox" data-testid="axes-outline" checked={axesOutline} onChange={(e) => setAxesOutline(e.target.checked)} />
                axis arrows
              </label>
            </Section>
            <Section tab="visual" title="Atoms" hint="Colour and size of each element. A site shared by several elements is drawn as a pie whose wedges are the occupancies, clockwise from the top in the order given.">
              {contents.elements.map((element) => {
                const pure = contents.species.find((x) => x.key === element);
                return (
                  <div className="row" key={element} data-testid={`look-${element}`}>
                    <input type="color" title={`Colour of ${element}`} value={elementColour(element, sceneLooks)} onChange={(e) => setLook(element, { colour: e.target.value })} />
                    <b className="symbol">{element}</b>
                    {pure && (
                      <>
                        radius
                        <input
                          type="number"
                          step={0.05}
                          min={0.05}
                          max={5}
                          data-testid={`radius-${element}`}
                          value={looks[element]?.radiusText ?? speciesRadius(element, pure.components, {}).toFixed(2)}
                          onChange={(e) => setLook(element, { radiusText: e.target.value })}
                        />
                        Å
                      </>
                    )}
                  </div>
                );
              })}
              {contents.species.filter((x) => x.components.length > 1).map((x) => (
                <div className="rule" key={x.key} data-testid={`look-${x.key}`}>
                  <div className="row">
                    <span className="lab">name</span>
                    <input type="text" className="name" value={looks[x.key]?.name ?? x.key} onChange={(e) => setLook(x.key, { name: e.target.value })} />
                  </div>
                  <div className="row">
                    <span className="lab">wedges</span>
                    <input
                      type="text"
                      className="name"
                      title="Order of the wedges, clockwise from the top: element symbols separated by spaces"
                      data-testid={`order-${x.key}`}
                      value={looks[x.key]?.orderText ?? x.components.map((c) => c.element).join(" ")}
                      onChange={(e) => setLook(x.key, { orderText: e.target.value })}
                    />
                  </div>
                  <div className="row">
                    <span className="lab">radius</span>
                    <input
                      type="number"
                      step={0.05}
                      min={0.05}
                      max={5}
                      value={looks[x.key]?.radiusText ?? speciesRadius(x.key, x.components, {}).toFixed(2)}
                      onChange={(e) => setLook(x.key, { radiusText: e.target.value })}
                    />
                    Å
                  </div>
                </div>
              ))}
              <label className="row">
                <input type="checkbox" data-testid="show-vacancy" checked={showVacancy} onChange={(e) => setShowVacancy(e.target.checked)} />
                Show a vacant share as an empty wedge
              </label>
              <div className="row">
                <button data-testid="reset-looks" onClick={() => setLooks({})}>Reset colours and sizes</button>
              </div>
            </Section>
            {bondRules.length > 0 && (
              <Section tab="visual" title="Bonds" hint="Colour and thickness of each kind of bond. A highlight is a wide translucent band behind a connected group of bonds (a chain, a net); with one group chosen, the rule's other atoms and bonds are drawn pale. Fill triangles fills every three mutually bonded atoms.">
                {bondRules.map((r, index) => (
                  <div key={index} className="rule" data-testid={`bond-look-${index}`}>
                    <div className="row">
                      <b>{nameOf(r.centre)}–{nameOf(r.neighbour)}</b>
                    </div>
                    <div className="row" title="One colour for the whole bond, or each half in the colour of the atom it starts from.">
                      <span className="lab">colour</span>
                      <select
                        data-testid={`bond-colouring-${index}`}
                        value={r.colouring ?? "single"}
                        onChange={(e) => changeRule(index, { colouring: e.target.value as BondColouring })}
                      >
                        <option value="single">one colour</option>
                        <option value="atoms">atom colours, half each</option>
                      </select>
                      {(r.colouring ?? "single") === "single" && (
                        <input type="color" title="Colour of these bonds" value={r.colour ?? DEFAULT_STICK.colour} onChange={(e) => changeRule(index, { colour: e.target.value })} />
                      )}
                    </div>
                    <div className="row" title="A solid rod, or a dashed or dotted one (for weak bonds or contacts). The pattern runs from one atom's surface to the other's.">
                      <span className="lab">line</span>
                      <select data-testid={`bond-line-${index}`} value={r.line ?? "solid"} onChange={(e) => changeRule(index, { line: e.target.value as BondLine })}>
                        <option value="solid">solid</option>
                        <option value="dashed">dashed</option>
                        <option value="dotted">dotted</option>
                      </select>
                    </div>
                    <div className="row">
                      <span className="lab">thickness</span>
                      <input
                        type="number"
                        step={0.02}
                        min={0.02}
                        max={2}
                        data-testid={`bond-width-${index}`}
                        value={r.widthText ?? String(DEFAULT_STICK.width)}
                        onChange={(e) => changeRule(index, { widthText: e.target.value })}
                      />
                      <span className="unit">Å</span>
                    </div>
                    <label className="row">
                      <input type="checkbox" data-testid={`bond-band-${index}`} checked={r.band ?? false} onChange={(e) => changeRule(index, { band: e.target.checked })} />
                      Highlight band behind these bonds
                    </label>
                    {r.band && (scene?.ruleInfo[sceneRule(index)]?.groups ?? 0) > 1 && (
                      <div className="row">
                        <span className="lab">highlight</span>
                        <select
                          data-testid={`bond-chain-${index}`}
                          value={r.chain ?? "all"}
                          onChange={(e) => changeRule(index, { chain: e.target.value === "all" ? null : Number(e.target.value) })}
                        >
                          <option value="all">all chains</option>
                          {Array.from({ length: Math.min(scene?.ruleInfo[sceneRule(index)]?.groups ?? 0, 60) }, (_, g) => (
                            <option key={g} value={g}>
                              chain {g + 1} only
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <label className="row">
                      <input type="checkbox" data-testid={`bond-fill-${index}`} checked={r.fill ?? false} onChange={(e) => changeRule(index, { fill: e.target.checked })} />
                      Fill triangles
                    </label>
                    {r.fill && (scene?.ruleInfo[sceneRule(index)]?.triangles ?? 0) > 0 && (
                      <div className="row">
                        <span className="lab">triangle colour</span>
                        <input
                          type="color"
                          data-testid={`bond-fill-colour-${index}`}
                          title="Colour of the filled triangles (drawn translucent)"
                          value={r.fillColour ?? scene?.ruleInfo[sceneRule(index)]?.fillColour ?? "#cccccc"}
                          onChange={(e) => changeRule(index, { fillColour: e.target.value })}
                        />
                        {r.fillColour && (
                          <button className="plain" title="Back to the usual tint of the atoms' colour" data-testid={`bond-fill-colour-reset-${index}`} onClick={() => changeRule(index, { fillColour: undefined })}>
                            ↺
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </Section>
            )}
            {angleRules.length > 0 && (
              <Section tab="visual" title="Angles" hint="The mark of each kind of angle: a translucent sector in the plane of the two bonds, from the apex atom's surface out to the size given, and optionally its value.">
                {angleRules.map((r, index) => (
                  <div key={index} className="rule" data-testid={`angle-look-${index}`}>
                    <div className="row">
                      <input type="color" title="Colour of the mark" value={r.colour ?? DEFAULT_ANGLE_LOOK.colour} onChange={(e) => changeAngle(index, { colour: e.target.value })} />
                      <b>{nameOf(r.ends[0])}–{nameOf(r.centre)}–{nameOf(r.ends[1])}</b>
                    </div>
                    <div className="row">
                      <span className="lab">opacity</span>
                      <input type="number" step={0.05} min={0.05} max={1} value={r.opacityText} onChange={(e) => changeAngle(index, { opacityText: e.target.value })} />
                      size
                      <input type="number" step={0.1} min={0.1} max={5} value={r.radiusText} onChange={(e) => changeAngle(index, { radiusText: e.target.value })} />
                      Å
                    </div>
                    <label className="row">
                      <input type="checkbox" data-testid={`angle-label-${index}`} checked={r.label ?? DEFAULT_ANGLE_LOOK.label} onChange={(e) => changeAngle(index, { label: e.target.checked })} />
                      Write the angle beside it
                    </label>
                  </div>
                ))}
              </Section>
            )}
            {arrowStyle === "moment" && (
              <Section tab="visual" title="Moment arrows" hint="The arrow of the largest moment in the file has the length given here; the others are in proportion. The cone at the tip keeps its proportion to the rod; head scales it further (also for displacement arrows).">
                <div className="row">
                  <input type="color" title="Colour of the moment arrows" value={momentColour} onChange={(e) => setMomentColour(e.target.value)} />
                  length
                  <input type="number" step={0.25} min={0.25} max={20} data-testid="moment-length" value={momentLengthText} onChange={(e) => setMomentLengthText(e.target.value)} />
                  Å
                </div>
                <div className="row">
                  <span className="lab">thickness</span>
                  <input type="number" step={0.02} min={0.02} max={2} data-testid="moment-thickness" title="Thickness of the rod. The cone at the tip keeps its proportion to it." value={momentThicknessText} onChange={(e) => setMomentThicknessText(e.target.value)} />
                  <span className="unit">Å</span>
                </div>
                <div className="row">
                  <span className="lab">head</span>
                  <input type="number" step={0.1} min={0.2} max={4} data-testid="moment-head" title="Size of the cone at the tip, as a multiple of its usual proportion to the rod." value={momentHeadText} onChange={(e) => setMomentHeadText(e.target.value)} />
                  <span className="unit">×</span>
                </div>
                <div className="row" title="The tail side of the arrow, as a share of the head side. The cone narrows to a point, so an exactly centred arrow (100 %) looks longer on its tail side; a shorter tail looks balanced. The head side always runs half the chosen length from the atom's centre.">
                  <span className="lab">tail</span>
                  <input type="number" step={5} min={20} max={100} data-testid="moment-tail" value={momentTailText} onChange={(e) => setMomentTailText(e.target.value)} />
                  <span className="unit">% of the head side</span>
                </div>
              </Section>
            )}
            {orbitalRules.length > 0 && (
              <Section tab="visual" title="Orbitals" hint="Size: how far the orbital reaches from the atom's centre. Isovalue: where the surface is drawn, as a share of the largest |ψ|; low gives full, rounded lobes, high slim ones. The two colours are the lobes where the orbital is positive and negative. Opacity: below 1 the atoms and bonds show through (0.6 by default).">
                {orbitalRules.map((r, index) => (
                  <div key={index} className="rule" data-testid={`orbital-look-${index}`}>
                    <div className="row">
                      <b>{nameOf(r.species)}</b>
                      <span className="sub">{r.orbitals.map((id) => ORBITALS.find((o) => o.id === id)?.label).join(", ") || "none ticked"}</span>
                    </div>
                    <div className="row">
                      <span className="lab">size</span>
                      <input type="number" step={0.1} min={0.1} max={20} data-testid={`orbital-size-${index}`} value={r.sizeText} onChange={(e) => changeOrbitalRule(index, { sizeText: e.target.value })} />
                      <span className="unit">Å</span>
                    </div>
                    <div className="row" title="Soft: gentle light and shade. Flat: one colour per lobe. Glossy: a bright highlight. Mesh: a pale surface with its grid lines, as in a classic orbital plot.">
                      <span className="lab">surface</span>
                      <select data-testid={`orbital-texture-${index}`} value={r.texture} onChange={(e) => changeOrbitalRule(index, { texture: e.target.value as OrbitalTexture })}>
                        {ORBITAL_TEXTURES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="row" title="A ready-made pair for the positive and negative lobes; each can then be changed below.">
                      <span className="lab">scheme</span>
                      <select
                        className="grow"
                        data-testid={`orbital-scheme-${index}`}
                        value={ORBITAL_SCHEMES.find((x) => x.colours[0] === r.colours[0] && x.colours[1] === r.colours[1])?.name ?? ""}
                        onChange={(e) => {
                          const scheme = ORBITAL_SCHEMES.find((x) => x.name === e.target.value);
                          if (scheme) changeOrbitalRule(index, { colours: [...scheme.colours] as [string, string] });
                        }}
                      >
                        <option value="">own colours</option>
                        {ORBITAL_SCHEMES.map((x) => (
                          <option key={x.name} value={x.name}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="row">
                      <span className="lab">lobes</span>
                      <input type="color" title="Where the orbital is positive" value={r.colours[0]} onChange={(e) => changeOrbitalRule(index, { colours: [e.target.value, r.colours[1]] })} />
                      <span className="unit">+</span>
                      <input type="color" title="Where the orbital is negative" value={r.colours[1]} onChange={(e) => changeOrbitalRule(index, { colours: [r.colours[0], e.target.value] })} />
                      <span className="unit">−</span>
                    </div>
                    <div className="row slider" title="The isosurface |ψ| = value × the largest |ψ| of a schematic hydrogen-like orbital (1s, 2p, 3d, 4f): low gives full, rounded lobes, high slim ones. The size keeps the overall reach.">
                      <span className="lab">isovalue</span>
                      <input type="range" min={0.05} max={0.9} step={0.05} data-testid={`orbital-iso-${index}`} value={r.iso} onChange={(e) => changeOrbitalRule(index, { iso: Number(e.target.value) })} />
                      <span className="sub">{r.iso.toFixed(2)}</span>
                    </div>
                    <div className="row">
                      <span className="lab">opacity</span>
                      <input type="number" step={0.05} min={0.05} max={1} value={r.opacityText} onChange={(e) => changeOrbitalRule(index, { opacityText: e.target.value })} />
                    </div>
                  </div>
                ))}
              </Section>
            )}
            {arrowStyle === "displacement" && (
              <Section tab="visual" title="Displacement arrows" hint="Drawn apart from moment arrows: green and thicker by default. The arrow of the largest displacement has the length given here, measured from the atom's centre; the others are in proportion. The cone at the tip keeps its proportion to the rod.">
                <div className="row">
                  <input type="color" title="Colour of the displacement arrows" data-testid="displacement-colour" value={displacementColour} onChange={(e) => setDisplacementColour(e.target.value)} />
                  length
                  <input type="number" step={0.25} min={0.25} max={20} data-testid="displacement-length" value={displacementLengthText} onChange={(e) => setDisplacementLengthText(e.target.value)} />
                  Å
                </div>
                <div className="row">
                  <span className="lab">thickness</span>
                  <input type="number" step={0.02} min={0.02} max={2} data-testid="displacement-thickness" title="Thickness of the rod. The cone at the tip keeps its proportion to it." value={displacementThicknessText} onChange={(e) => setDisplacementThicknessText(e.target.value)} />
                  <span className="unit">Å</span>
                </div>
                {arrowStyle === "displacement" && (
                  <div className="row">
                    <span className="lab">head</span>
                    <input type="number" step={0.1} min={0.2} max={4} data-testid="moment-head" title="Size of the cone at the tip, as a multiple of its usual proportion to the rod." value={momentHeadText} onChange={(e) => setMomentHeadText(e.target.value)} />
                    <span className="unit">×</span>
                  </div>
                )}
              </Section>
            )}
            <Section tab="visual" title="Unit cell" hint="The outline is drawn for every whole cell inside the range shown (none for a slab). Near and far: the edges in front of the middle of the structure are solid, those behind it paler and dashed, so the box reads as a solid.">
              <label className="row">
                <input type="checkbox" data-testid="show-cell" checked={showCell} onChange={(e) => setShowCell(e.target.checked)} />
                Outline of the unit cell
              </label>
              {showCell && (
                <div className="row" title="Near and far: the edges in front of the middle of the structure are solid, those behind it paler and dashed, so the box reads as a solid. Or all dashed, or all solid.">
                  <span className="lab">lines</span>
                  <select data-testid="cell-style" value={cellStyle} onChange={(e) => setCellStyle(e.target.value as CellStyle)}>
                    <option value="depth">near solid, far dashed</option>
                    <option value="dashed">all dashed</option>
                    <option value="solid">all solid</option>
                  </select>
                </div>
              )}
              {showCell && (
                <div className="row">
                  <span className="lab">width</span>
                  <input type="number" step={0.5} min={0.5} max={12} data-testid="cell-width" title="Line width in px of the figure" value={cellWidthText} onChange={(e) => setCellWidthText(e.target.value)} />
                  <span className="unit">px</span>
                </div>
              )}
            </Section>
            <Section tab="visual" title="Legend" hint="The elements with a sphere of each colour, in the band under the structure.">
              <label className="row">
                <input type="checkbox" data-testid="show-legend" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} />
                Legend
              </label>
              <label className="row" title="The legend's spheres are drawn at the size of the atoms in the figure, and its letters in proportion, so the legend grows and shrinks with the zoom.">
                <input type="checkbox" data-testid="legend-follows" checked={legendFollows} onChange={(e) => setLegendFollows(e.target.checked)} />
                Legend follows the size of the structure
              </label>
              <div className="row" title="Size of the legend as a multiple of the usual size.">
                <span className="lab">size</span>
                <input type="number" step={0.1} min={0.2} max={4} data-testid="legend-size" value={legendSizeText} onChange={(e) => setLegendSizeText(e.target.value)} />×
              </div>
            </Section>
            <Section tab="visual" title="Axes" hint="The arrows are the directions of the cell edges a, b, c. An arrow tilted out of the screen is drawn shorter.">
              <label className="row">
                <input type="checkbox" data-testid="show-axes" checked={showAxes} onChange={(e) => setShowAxes(e.target.checked)} />
                Axes a, b, c
              </label>
              <div className="row">
                <label className="row" title="Draw a, b and c each in its own colour, the letters too. Off: all three grey.">
                  <input type="checkbox" data-testid="axes-coloured" checked={axesColoured} onChange={(e) => setAxesColoured(e.target.checked)} />
                  in colour
                </label>
                {axesColoured &&
                  (["a", "b", "c"] as const).map((name, i) => (
                    <span className="row" key={name}>
                      <span className="axis">{name}</span>
                      <input
                        type="color"
                        data-testid={`axis-colour-${name}`}
                        value={axesColours[i]}
                        onChange={(e) => setAxesColours((old) => old.map((c, j) => (j === i ? e.target.value : c)) as unknown as typeof old)}
                      />
                    </span>
                  ))}
                {axesColoured && axesColours.some((c, i) => c !== AXES_COLOURS[i]) && (
                  <button className="plain" title="Back to the usual red, green, blue" data-testid="axes-colours-reset" onClick={() => setAxesColours(AXES_COLOURS)}>↺</button>
                )}
              </div>
              <div className="row" title="Size of the axis arrows with their letters, and of their cones, as multiples of the usual size.">
                <span className="lab">size</span>
                <input type="number" step={0.1} min={0.2} max={4} data-testid="axes-size" value={axesSizeText} onChange={(e) => setAxesSizeText(e.target.value)} />
                <span className="unit">×</span>
              </div>
              <div className="row" title="Size of the cones of the axis arrows, as a multiple of the usual.">
                <span className="lab">head</span>
                <input type="number" step={0.1} min={0.2} max={4} data-testid="axes-head" value={axesHeadText} onChange={(e) => setAxesHeadText(e.target.value)} />
                <span className="unit">×</span>
              </div>
              <label className="row" title="An axis that points mostly into or out of the page projects to a short stub. With this on it is drawn at least 0.45 of the full length, in its true direction on screen; with it off every arrow is the exact projection.">
                <input type="checkbox" data-testid="axes-readable" checked={axesReadable} onChange={(e) => setAxesReadable(e.target.checked)} />
                Keep short axis arrows readable
              </label>
            </Section>
            <Section tab="visual" title="Lettering" hint="A text size in pt is exact in the saved figure: with a size on paper, 9 pt is 9 pt there; with Fit the frame, 1 px of the figure counts as 1 pt (as Keynote and Illustrator place an SVG). The font must be a font of this computer: the PNG is drawn from the SVG alone, which cannot use a font loaded by the page. Text stays live text in the SVG.">
              <div className="row">
                <span className="lab">font</span>
                <select
                  className="grow"
                  data-testid="font-family"
                  value={customFont ? "other" : fontFamily}
                  onChange={(e) => {
                    setCustomFont(e.target.value === "other");
                    if (e.target.value !== "other") setFontFamily(e.target.value);
                  }}
                >
                  {FONT_GROUPS.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.fonts.map((f) => (
                        <option key={f} value={f}>
                          {fontInstalled(f) ? f : `${f} (not installed)`}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  <option value="other">Other…</option>
                </select>
                {customFont && (
                  <input type="text" className="name" data-testid="font-custom" placeholder="Font name" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} />
                )}
              </div>
              {!fontInstalled(fontFamily) && (
                <p className="sub" data-testid="font-missing">
                  “{fontFamily}” is not installed on this computer, so another font is shown here and in the PNG. The SVG keeps the name. Free fonts can be installed from fonts.google.com or github.com/IBM/plex; then reload this page.
                </p>
              )}
              <div className="row">
                <span className="lab">weight</span>
                <select data-testid="letter-weight" value={letterWeight} onChange={(e) => setLetterWeight(Number(e.target.value))}>
                  <option value={400}>regular</option>
                  <option value={500}>medium</option>
                  <option value={800}>heavy</option>
                </select>
              </div>
              <p className="sub group">Text size in pt; left empty, it follows the legend or axes size (shown greyed)</p>
              <div className="trio">
                <label>
                  <span className="sub">legend</span>
                  <input type="number" step={0.5} min={1} max={400} data-testid="font-pt-legend" placeholder={`${autoPt.legend}`} value={fontPtText.legend} onChange={(e) => setFontPtText((t) => ({ ...t, legend: e.target.value }))} />
                </label>
                <label>
                  <span className="sub">axes</span>
                  <input type="number" step={0.5} min={1} max={400} data-testid="font-pt-axes" placeholder={`${autoPt.axes}`} value={fontPtText.axes} onChange={(e) => setFontPtText((t) => ({ ...t, axes: e.target.value }))} />
                </label>
                <label>
                  <span className="sub">angles</span>
                  <input type="number" step={0.5} min={1} max={400} data-testid="font-pt-angle" placeholder={`${autoPt.angle}`} value={fontPtText.angle} onChange={(e) => setFontPtText((t) => ({ ...t, angle: e.target.value }))} />
                </label>
              </div>
            </Section>
            <Section tab="layout" title="Saved settings" hint="Your preferences for how figures look and are laid out: everything under Visual and Layout (surfaces, outlines, element colours and radii, arrows, unit cell, legend, axes, lettering, canvas size and shape, dpi, scale, dragging), your saved views, and whether bonds are added on opening. Not the structure: the cells shown, bond and angle rules, distortion modes and the current view stay with the file. Kept in this browser; export to a file to keep them elsewhere or use them on another computer.">
              {settingsList.length > 0 && (
                <div className="row">
                  <select data-testid="settings-choice" value={settingsChoice} onChange={(e) => setSettingsChoice(e.target.value)}>
                    <option value="">Saved settings…</option>
                    {settingsList.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name}
                        {s.name === startWith ? " (opens with)" : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    data-testid="settings-load"
                    disabled={!settingsChoice}
                    onClick={() => {
                      const s = settingsList.find((x) => x.name === settingsChoice);
                      if (s) loadSettings(s);
                    }}
                  >
                    Load
                  </button>
                  <button
                    data-testid="settings-delete"
                    title="Remove these settings from this browser"
                    disabled={!settingsChoice}
                    onClick={() => {
                      keepSettingsList(settingsList.filter((x) => x.name !== settingsChoice));
                      if (startWith === settingsChoice) {
                        setStartWith("");
                        setDefaultSettingsName("");
                      }
                      setSettingsNote(`Removed “${settingsChoice}”.`);
                      setSettingsChoice("");
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
              {settingsChoice && (
                <label className="row">
                  <input
                    type="checkbox"
                    data-testid="settings-start"
                    checked={startWith === settingsChoice}
                    onChange={(e) => {
                      const name = e.target.checked ? settingsChoice : "";
                      setStartWith(name);
                      setDefaultSettingsName(name);
                    }}
                  />
                  Open the page with these settings
                </label>
              )}
              <div className="row">
                <input type="text" className="name" data-testid="settings-name" placeholder="Name these settings" value={settingsName} onChange={(e) => setSettingsName(e.target.value)} />
                <button
                  data-testid="settings-save"
                  disabled={settingsName.trim() === ""}
                  title="Save the current settings under this name (replacing any of the same name)"
                  onClick={() => {
                    const name = settingsName.trim().slice(0, 60);
                    keepSettingsList([...settingsList.filter((x) => x.name !== name), { name, values: collectSettings(settingFields) }]);
                    setSettingsChoice(name);
                    setSettingsName("");
                    setSettingsNote(`Saved “${name}”.`);
                  }}
                >
                  Save
                </button>
              </div>
              <div className="row">
                <button
                  data-testid="settings-export"
                  title="Download the current settings as a small file"
                  onClick={() => {
                    const name = settingsChoice || settingsName.trim() || "MOTIF settings";
                    download(new Blob([settingsFileText({ name, values: collectSettings(settingFields) })], { type: "application/json" }), `${name.replace(/[^\w.-]+/g, "_")}.motif-settings.json`);
                  }}
                >
                  Export file
                </button>
                <label className="button">
                  Import file
                  <input
                    type="file"
                    accept=".json,application/json"
                    data-testid="settings-import"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      void file.text().then((text) => {
                        try {
                          const s = readSettingsFile(text);
                          keepSettingsList([...settingsList.filter((x) => x.name !== s.name), s]);
                          setSettingsChoice(s.name);
                          loadSettings(s);
                        } catch (err) {
                          setSettingsNote(err instanceof Error ? err.message : String(err));
                        }
                      });
                    }}
                  />
                </label>
              </div>
              {settingsNote && <p className="sub" data-testid="settings-note">{settingsNote}</p>}
            </Section>
            <Section tab="layout" title="Canvas" hint="Fit the frame: the figure is 1440 px wide and as high as the frame on the page makes it. Size on paper: the width and height you give, in cm or in; the SVG states that size, so a drawing program places it at exactly that size, and the PNG is that size at the dpi given under Save. Lines, spheres and the legend keep their proportions to the figure; text given in pt under Lettering keeps its size. A journal template sets the width a journal asks for (keeping the shape) and the text size, from the journal's own author pages.">
              {(() => {
                const chosen = journalSize(journalChoice);
                const current = chosen && canvasFixed && canvasUnit === chosen.unit && Number(canvasSizeText[0]) === partWidth(chosen.width, journalPart) ? chosen : undefined;
                const apply = applyJournal;
                return (
                  <>
                    <div className="row">
                      <span className="lab">publisher</span>
                      <select
                        className="grow"
                        data-testid="canvas-publisher"
                        value={chosen ? chosen.of.publisher : ""}
                        title="Choose the publisher, then the journal and the column width it asks for"
                        onChange={(e) => {
                          const first = journalsOf(e.target.value)[0];
                          if (first) apply(first.sizes[0]!.id, journalPart);
                        }}
                      >
                        {!chosen && <option value="">Journal template…</option>}
                        {PUBLISHERS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                    {chosen && (
                      <>
                        <div className="row">
                          <span className="lab">journal</span>
                          <select
                            className="grow"
                            data-testid="canvas-journal-name"
                            value={chosen.of.name}
                            disabled={journalsOf(chosen.of.publisher).length < 2}
                            onChange={(e) => {
                              const j = journalsOf(chosen.of.publisher).find((x) => x.name === e.target.value);
                              if (j) apply(j.sizes[0]!.id, journalPart);
                            }}
                          >
                            {journalsOf(chosen.of.publisher).map((j) => (
                              <option key={j.name} value={j.name}>
                                {j.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="row">
                          <span className="lab">column</span>
                          <select className="grow" data-testid="canvas-journal" value={current ? current.id : ""} onChange={(e) => apply(e.target.value, journalPart)}>
                            {!current && <option value="">changed by hand…</option>}
                            {chosen.of.sizes.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                    {chosen && (
                    <div className="row">
                      <span className="lab">width</span>
                      <select
                        data-testid="canvas-journal-part"
                        value={journalPart}
                        title="The whole column width, or a half, a third or a quarter of it (one panel in a row of two, three or four). The text size stays the journal's."
                        onChange={(e) => (chosen ? apply(chosen.id, e.target.value as PartId) : setJournalPart(e.target.value as PartId))}
                      >
                        {PARTS.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      {current && journalPart !== "1" && (
                        <span className="sub">
                          {journalPart} of {current.width} {current.unit} = {partWidth(current.width, journalPart)} {current.unit}
                        </span>
                      )}
                    </div>
                    )}
                    {current && (
                      <p className="sub" data-testid="journal-note">
                        {current.of.note} Text set to {journalTextPt(current.of, capHeight(fontFamily))} pt{"capitalsMm" in current.of.text ? ` (capitals ${current.of.text.capitalsMm} mm in ${fontFamily})` : ""}.
                      </p>
                    )}
                  </>
                );
              })()}
              <div className="row">
                <span className="lab">size</span>
                <select
                  data-testid="canvas-mode"
                  value={canvasFixed ? "fixed" : "frame"}
                  onChange={(e) => {
                    const fixed = e.target.value === "fixed";
                    // Start from a single-column width with the shape the figure has now.
                    if (fixed && !canvasFixed) {
                      const w = canvasUnit === "cm" ? 8.9 : 3.5; // a Nature single column (89 mm)
                      setCanvasSizeText([`${w}`, short(ratio !== null ? w / ratio : (w * canvas.height) / canvas.width)]);
                    }
                    setCanvasFixed(fixed);
                  }}
                >
                  <option value="frame">fit the frame</option>
                  <option value="fixed">size on paper</option>
                </select>
                {!canvasFixed && <span className="sub">{canvas.width} × {canvas.height} px</span>}
              </div>
              <label className="row" title="Rulers along the top and left of the figure on this page, in cm or in for a size on paper, else in px of the figure. They are never saved with the figure.">
                <input type="checkbox" data-testid="show-rulers" checked={showRulers} onChange={(e) => setShowRulers(e.target.checked)} />
                Rulers beside the figure
              </label>
              <div className="row">
                <span className="lab">shape</span>
                <select
                  className="grow"
                  data-testid="canvas-aspect"
                  value={aspect}
                  title="Width : height of the figure. Free: the frame's shape, or the width and height as typed."
                  onChange={(e) => {
                    const r = ratioOf(e.target.value, portrait);
                    if (canvasFixed && r !== null) setCanvasSizeText((t) => [t[0], short(Number(t[0]) / r)]);
                    setAspect(e.target.value);
                  }}
                >
                  {ASPECTS.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {(aspect !== "free" || canvasFixed) && (
                  <button
                    data-testid="canvas-swap"
                    className={portrait ? "on" : ""}
                    title="Landscape or portrait: swap width and height"
                    onClick={() => {
                      setPortrait((p) => !p);
                      if (canvasFixed) setCanvasSizeText((t) => [t[1], t[0]]);
                    }}
                  >
                    ⇄ {portrait ? "portrait" : "landscape"}
                  </button>
                )}
              </div>
              {canvasFixed && (
                <div className="row">
                  <input type="number" step={0.1} min={sideMin} max={sideMax} data-testid="canvas-width" title="Width of the figure" value={canvasSizeText[0]} onChange={(e) => { const v = e.target.value; setCanvasSizeText((t) => [v, ratio !== null && Number(v) > 0 ? short(Number(v) / ratio) : t[1]]); }} />
                  ×
                  <input type="number" step={0.1} min={sideMin} max={sideMax} data-testid="canvas-height" title="Height of the figure" value={canvasSizeText[1]} onChange={(e) => { const v = e.target.value; setCanvasSizeText((t) => [ratio !== null && Number(v) > 0 ? short(Number(v) * ratio) : t[0], v]); }} />
                  <select
                    data-testid="canvas-unit"
                    value={canvasUnit}
                    title="Changing the unit converts the numbers"
                    onChange={(e) => {
                      const unit = e.target.value as PhysicalSize["unit"];
                      const f = PT_PER[canvasUnit] / PT_PER[unit];
                      setCanvasSizeText((t) => [`${+(Number(t[0]) * f).toFixed(3)}`, `${+(Number(t[1]) * f).toFixed(3)}`]);
                      setCanvasUnit(unit);
                    }}
                  >
                    <option value="cm">cm</option>
                    <option value="in">in</option>
                  </select>
                </div>
              )}
              {canvasFixed && !canvasSizeOk && (
                <p className="error" data-testid="canvas-error">
                  Each side must be between {sideMin} and {sideMax} {canvasUnit}, and the height between 0.2 and 5 times the width.
                </p>
              )}
            </Section>
            <Section tab="layout" title="Direction" hint="The view is four numbers: the cell axis that is up, turn about it, tilt (from above when positive) and roll about the line of sight. The line under the figure always shows them, and the nearest low-index direction. A direction given here points at you.">
              <div className="row">
                <span className="lab">up</span>
                <select data-testid="view-up" value={upAxis} onChange={(e) => applyNumbers({ ...numbers, up: Number(e.target.value) as Axis, turn: Number(numberText.turn), tilt: Number(numberText.tilt), roll: Number(numberText.roll) })}>
                  <option value={0}>a</option>
                  <option value={1}>b</option>
                  <option value={2}>c</option>
                </select>
                turn
                <input type="number" step={5} data-testid="view-az" value={numberText.turn} onChange={(e) => typeNumber("turn", e.target.value)} /><span className="deg">°</span>
              </div>
              <div className="row">
                <span className="lab">tilt</span>
                <input type="number" step={5} min={-90} max={90} data-testid="view-el" value={numberText.tilt} onChange={(e) => typeNumber("tilt", e.target.value)} /><span className="deg">°</span>
                roll
                <input type="number" step={5} data-testid="view-roll" value={numberText.roll} onChange={(e) => typeNumber("roll", e.target.value)} /><span className="deg">°</span>
              </div>
              <div className="row">
                <select data-testid="along-kind" value={alongKind} onChange={(e) => setAlongKind(e.target.value as Direction["kind"])}>
                  <option value="uvw">along [u v w]</option>
                  <option value="hkl">normal to (h k l)</option>
                </select>
                <input type="text" className="indices" data-testid="along-text" value={alongText} onChange={(e) => setAlongText(e.target.value)} />
              </div>
              <div className="row">
                <select value={upKind} onChange={(e) => setUpKind(e.target.value as Direction["kind"])}>
                  <option value="uvw">up [u v w]</option>
                  <option value="hkl">up (h k l)</option>
                </select>
                <input type="text" className="indices" data-testid="up-text" placeholder="automatic" value={upText} onChange={(e) => setUpText(e.target.value)} />
                <button
                  data-testid="along-apply"
                  disabled={!parseIndices(alongText)}
                  onClick={() => {
                    const d = parseIndices(alongText);
                    const u = parseIndices(upText);
                    if (d) lookAlong({ kind: alongKind, indices: d }, u ? { kind: upKind, indices: u } : undefined);
                  }}
                >
                  Look
                </button>
              </div>
              {viewNote && <p className="sub">{viewNote}</p>}
              </Section>
            <Section tab="layout" closed title="Scale" hint="Fit each view: the figure fills the canvas, so its scale changes as it turns. Steady: one scale at every angle. Fixed: a stated scale, the same in every figure of a series.">
              <div className="row">
                <span className="lab">scale</span>
                <select data-testid="scale-mode" value={scaleMode} onChange={(e) => setScaleMode(e.target.value as "outline" | "steady" | "fixed")} title="Fit each view: the figure fills the canvas, so its scale changes as it turns. Steady: one scale at every angle. Fixed: a stated scale, the same in every figure.">
                  <option value="outline">fit each view</option>
                  <option value="steady">steady at every angle</option>
                  <option value="fixed">fixed</option>
                </select>
                {scaleMode === "fixed" && (
                  <>
                    <input type="number" min={2} max={1000} step={5} data-testid="fixed-scale" value={fixedScaleText} onChange={(e) => setFixedScaleText(e.target.value)} />
                    px per Å
                  </>
                )}
              </div>
              </Section>
            <Section tab="layout" closed title="Saved views" hint="Kept in this browser. A view is its four numbers (axis up, turn, tilt, roll), so it means the same axes in another structure. Paste a line copied from under the figure to use a view again.">
                
                {savedViews.map((v, k) => (
                  <div className="row" key={`${v.name}-${k}`}>
                    <button data-testid={`saved-${k}`} title={writeView(v)} onClick={() => { setUpAxis(v.up); if (axes) goTo(viewFromNumbers(axes, v)); }}>{v.name}</button>
                    <button title="Remove" onClick={() => storeViews(savedViews.filter((_, i) => i !== k))}>×</button>
                  </div>
                ))}
                <div className="row">
                  <input type="text" className="name" data-testid="view-name" placeholder="Name this view" value={newViewName} onChange={(e) => setNewViewName(e.target.value)} />
                  <button
                    data-testid="view-save"
                    disabled={newViewName.trim() === ""}
                    onClick={() => {
                      storeViews([...savedViews, { ...numbers, name: newViewName.trim() }]);
                      setNewViewName("");
                    }}
                  >
                    Save
                  </button>
                </div>
                <div className="row">
                  <input type="text" className="name" data-testid="view-paste" placeholder="Paste a view line" value={pasted} onChange={(e) => setPasted(e.target.value)} />
                  <button
                    data-testid="view-apply"
                    disabled={!readView(pasted)}
                    onClick={() => {
                      const n = readView(pasted);
                      if (n && axes) {
                        setUpAxis(n.up);
                        goTo(viewFromNumbers(axes, n));
                      }
                    }}
                  >
                    Apply
                  </button>
                </div>
                <label className="row">
                  <input type="checkbox" data-testid="keep-view" checked={keepView} onChange={(e) => setKeepView(e.target.checked)} />
                  Keep the view when another file is loaded
                </label>
              </Section>
            <Section tab="layout" closed title="Dragging" hint="Turntable: left-right turns about the up axis, up-down tilts, and the up axis stays upright. Free: turns about the axes of the screen, any way round. Alt + drag rolls the picture in both.">
              <div className="row">
                <span className="lab">drag</span>
                <select data-testid="drag-mode" value={dragMode} onChange={(e) => setDragMode(e.target.value as "turntable" | "free")} title="Turntable: left-right turns about the up axis, up-down tilts, and the up axis stays upright. Free: turns about the screen's axes, any way round.">
                  <option value="turntable">turntable (up axis stays up)</option>
                  <option value="free">free</option>
                </select>
              </div>
              <label className="row" title={`Releasing a drag within ${SNAP_DEGREES} degrees of a low-index direction ([u v w] or a plane normal, indices up to 2) clicks the view onto it.`}>
                <input type="checkbox" data-testid="snap" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
                Snap to low-index directions on release
              </label>
              <label className="row" title="A short turn on screen when the view changes by a click, so you can follow the axes. It is never part of the saved figure.">
                <input type="checkbox" data-testid="animate" checked={animate} onChange={(e) => setAnimate(e.target.checked)} />
                Animate a change of view
              </label>
              </Section>
            <Section tab="layout" closed title="Large structures" hint="While a large structure is turned, moved or zoomed, a simplified drawing made by the graphics card stands in for it; the full figure returns when you stop. The saved figure is never the simplified one.">
              <label className="row" title="While a large structure is turned, moved or zoomed, a simplified drawing made by the graphics card stands in for it; the full figure returns when you stop. The saved figure is never the simplified one.">
                <input type="checkbox" data-testid="smooth" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} />
                Smooth movement for large structures
              </label>
              {smooth && !preview.failed && (
                <div className="row">
                  <span className="lab">from</span>
                  <input type="number" min={0} step={100} data-testid="preview-from" title="Atoms plus bonds drawn. Below this the vector figure itself is redrawn while moving." value={previewFromText} onChange={(e) => setPreviewFromText(e.target.value)} />
                  <span className="unit">atoms + bonds</span>
                </div>
              )}
              {smooth && !preview.failed && scene && (
                <p className="sub">This structure: {drawLoad} atoms + bonds{scene.orbitals?.length ? " (an orbital counts as 60)" : ""}.</p>
              )}
              {preview.failed && <p className="sub" data-testid="preview-failed">Not available in this browser ({preview.failed}); the vector figure is redrawn instead.</p>}
            </Section>
            </div>
            </TabContext.Provider>
            {/* Under every other tab; the Assistant tab shows the same conversation itself. */}
            {tab !== "assistant" && <AssistantDrawer chat={chat} onSetup={() => setTab("assistant")} />}
          </aside>
        )}
      </main>
      <footer className="foot">
        <span>
          MOTIF {VERSION} · © 2026 Tsung-Han Yang ·{" "}
          <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
            AGPL-3.0
          </a>
        </span>
        <span className="links">
          <a href={`${REPO_URL}#readme`} target="_blank" rel="noopener noreferrer" data-testid="link-docs">
            Documentation
          </a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" data-testid="link-repo">
            Source code
          </a>
        </span>
      </footer>
    </div>
  );
}

const VERSION = "0.1";
/** Text sizes a figure opens with, in pt: Nature asks for 5 to 7 pt (the user's choice, 2026-11-23). */
const DEFAULT_TEXT_PT = { legend: "7", axes: "7", angle: "7" };
/** Where the code and its documentation (the README) live. */
const REPO_URL = "https://github.com/drthyang/motif";

/**
 * One-click looks. Each sets the surfaces, the outlines, the lettering weight and the size of legend and axes.
 * `outlines` is for the arrows; bonds are outlined only in the flat style, where the line is what
 * separates a bond from the atom behind it.
 */
const PRESETS: Record<string, { atoms: Material; bonds: Material; arrows: Material; outlines: boolean; bondOutline: boolean; weight: number; legendSize: number; axesSize: number }> = {
  "Soft shading": { atoms: "soft", bonds: "soft", arrows: "soft", outlines: true, bondOutline: false, weight: 400, legendSize: 1, axesSize: 1 },
  "Flat colour, outlined": { atoms: "flat", bonds: "flat", arrows: "flat", outlines: true, bondOutline: true, weight: 400, legendSize: 0.7, axesSize: 0.8 },
  "Glossy highlight": { atoms: "glossy", bonds: "glossy", arrows: "glossy", outlines: true, bondOutline: false, weight: 500, legendSize: 1, axesSize: 1 },
  "Metallic": { atoms: "metal", bonds: "metal", arrows: "metal", outlines: true, bondOutline: false, weight: 500, legendSize: 1, axesSize: 1 },
  "Clear glass atoms": { atoms: "glass", bonds: "soft", arrows: "soft", outlines: false, bondOutline: false, weight: 400, legendSize: 1, axesSize: 1 },
};
/** Shapes of the canvas, width : height (landscape; "portrait" turns them upright). */
const ASPECTS: { key: string; label: string; ratio: number | null }[] = [
  { key: "free", label: "free", ratio: null },
  { key: "1:1", label: "1 : 1", ratio: 1 },
  { key: "5:4", label: "5 : 4", ratio: 5 / 4 },
  { key: "4:3", label: "4 : 3", ratio: 4 / 3 },
  { key: "3:2", label: "3 : 2", ratio: 3 / 2 },
  { key: "A", label: "√2 : 1 (A4 paper)", ratio: Math.SQRT2 },
  { key: "16:10", label: "16 : 10", ratio: 16 / 10 },
  { key: "16:9", label: "16 : 9 (slide)", ratio: 16 / 9 },
  { key: "2:1", label: "2 : 1", ratio: 2 },
];

/** Limits of the canvas height (its width is 1440): a very flat or very tall window still gives a usable figure. */
const CANVAS_MIN_HEIGHT = 620;
const CANVAS_MAX_HEIGHT = 2600;

/** A drag released within this many degrees of a low-index direction snaps onto it. */
const SNAP_DEGREES = 4;
/** Length of the turn shown when the view changes by a click, ms. */
const TURN_MS = 320;
const SIMPLE_DIRECTIONS = lowIndexDirections(1);

// For testing: "?preview=all" uses the GPU preview for every structure, "?settle=ms" sets how long the view
// must be still before the full figure is drawn again.
const QUERY = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const PREVIEW_LIMIT = QUERY.get("preview") === "all" ? 0 : PREVIEW_FROM;
const SETTLE_MS = Number(QUERY.get("settle")) > 0 ? Number(QUERY.get("settle")) : 180;

/** Fonts offered for the lettering. All are fonts of the computer, not of the page: the PNG is drawn from the SVG alone. */
/**
 * Fonts offered for the lettering, in groups. Each must be installed on the computer to be seen (the PNG is
 * drawn from the SVG alone); the free ones can be had from Google Fonts or IBM's Plex repository.
 */
const FONT_GROUPS: { label: string; fonts: string[] }[] = [
  { label: "macOS", fonts: ["Avenir", "Avenir Next", "Helvetica Neue", "Helvetica", "Arial", "Gill Sans", "Futura", "Optima", "Verdana", "Times New Roman", "Georgia", "Palatino", "Menlo"] },
  { label: "Google Fonts (free)", fonts: ["Open Sans", "Roboto", "Lato", "Source Sans 3", "Noto Sans", "Inter", "Montserrat"] },
  { label: "IBM Plex (free)", fonts: ["IBM Plex Sans", "IBM Plex Sans Condensed", "IBM Plex Serif", "IBM Plex Mono"] },
  { label: "DejaVu (free)", fonts: ["DejaVu Sans", "DejaVu Sans Condensed"] },
];

/**
 * Whether this computer has a font of that name: text set in it is measured against the same text in two
 * generic fonts; a missing font falls back to the generic one and measures the same as it both times.
 */
const fontChecks = new Map<string, boolean>();
/** Height of a capital letter as a fraction of the font size, measured in this browser (0.72 if it cannot be). */
const capHeights = new Map<string, number>();
/** What a rule's polyhedra are, for the line under it: "18 octahedra", "4 tetrahedra and 2 with 5 corners". */
const SHAPE_NAMES: Readonly<Record<number, string>> = { 3: "triangles", 4: "tetrahedra", 6: "octahedra" };
function polyhedraText(found: readonly { readonly corners: number; readonly count: number }[] | undefined): string {
  if (!found || found.length === 0) return "no polyhedra";
  const one = ({ corners, count }: { corners: number; count: number }): string => {
    const name = SHAPE_NAMES[corners];
    if (name) return `${count} ${count === 1 ? name.replace(/a$/, "on").replace(/s$/, "") : name}`;
    return `${count} polyhedr${count === 1 ? "on" : "a"} with ${corners} corners`;
  };
  return found.map(one).join(", ");
}

function capHeight(family: string): number {
  const name = family.replace(/[^A-Za-z0-9 \-]/g, "").trim();
  const known = capHeights.get(name);
  if (known !== undefined) return known;
  const context = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  let h = 0.72;
  if (context) {
    context.font = `200px '${name}', sans-serif`;
    const m = context.measureText("H");
    if (m.actualBoundingBoxAscent > 0) h = m.actualBoundingBoxAscent / 200;
  }
  capHeights.set(name, h);
  return h;
}

function fontInstalled(family: string): boolean {
  const name = family.replace(/[^A-Za-z0-9 \-]/g, "").trim();
  if (name === "") return true;
  const known = fontChecks.get(name);
  if (known !== undefined) return known;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return true;
  const width = (font: string): number => {
    context.font = `72px ${font}`;
    return context.measureText("abcdefgHIJKLMNOP 0123456789 mmmwwwiii").width;
  };
  const installed = ["monospace", "serif"].some((generic) => Math.abs(width(`'${name}', ${generic}`) - width(generic)) > 0.01);
  fontChecks.set(name, installed);
  return installed;
}

/** A phone or tablet: the main pointer is a finger and nothing hovers. The hints under the figure then name gestures. */
const TOUCH_SCREEN = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: none) and (pointer: coarse)").matches;

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "Pm-3m[0,0,0]GM4-(0,0,a)[Ti:a:dsp]T1u(a)" -> irrep "GM4-", part "Ti T1u" (the full label stays in the tooltip). */
function modeName(label: string): { irrep: string; part: string } {
  const irrep = /\]([A-Za-z]+\d*[+-]?)\(/.exec(label)?.[1] ?? label;
  const part = /\[([^:\]]+):[^\]]*\]([^(\s]+)/.exec(label.slice(label.indexOf(")") + 1));
  return { irrep, part: part ? `${part[1]} ${part[2]}` : "" };
}

type ControlId = "turn" | "roll" | "move" | "zoom" | "box" | "fit";

/**
 * The ways to handle the figure, in one quiet line under it: a key, then what it does. The fuller
 * explanation is in each item's tooltip. The control in use (or whose key is held) is lit.
 */
function Controls({ active, turntable, snap, touch }: { active: ControlId | null; turntable: boolean; snap: boolean; touch: boolean }) {
  const turnMore = (turntable ? "Left–right turns, up–down tilts." : "Turns freely.") + (snap ? " On release it snaps to a nearby crystal direction." : "");
  const items: { id: ControlId; key: string; does: string; more: string }[] = touch ? [
    { id: "turn", key: "1 finger", does: "turn", more: turnMore },
    { id: "move", key: "2 fingers", does: "move", more: "Drag with two fingers to move the structure." },
    { id: "zoom", key: "Pinch", does: "zoom", more: "Pinch to zoom about the middle of your fingers. Box, then a drag, zooms to a rectangle." },
    { id: "roll", key: "Twist", does: "roll", more: "Turn two fingers to roll the picture in the screen plane; it starts after a clear twist, so a pinch does not roll." },
    { id: "fit", key: "Double-tap", does: "fit", more: "Fits the whole structure again." },
  ] : [
    { id: "turn", key: "Drag", does: "turn", more: turnMore },
    { id: "roll", key: IS_MAC ? "⌥" : "Alt", does: "roll", more: `${IS_MAC ? "Option" : "Alt"} + drag rolls the picture in the screen plane.` },
    { id: "move", key: "⇧", does: "move", more: "Shift + drag moves the structure; so do a middle-button drag and the arrow keys." },
    { id: "zoom", key: IS_MAC ? "⌘" : "Ctrl", does: "zoom", more: `${IS_MAC ? "Command" : "Ctrl"} + scroll zooms at the pointer; so do a pinch and the + and − keys. Box, then a drag, zooms to a rectangle.` },
    { id: "fit", key: "Double-click", does: "fit", more: "Fits the whole structure again; so does the 0 key." },
  ];
  const lit = active === "box" ? "zoom" : active;
  return (
    <ul className="controls" data-testid="controls" aria-label="How to handle the figure">
      {items.map((x) => (
        <li key={x.id} className={lit === x.id ? "on" : ""} data-testid={`control-${x.id}`} title={x.more}>
          <kbd>{x.key}</kbd>
          {x.does}
        </li>
      ))}
    </ul>
  );
}

/** A card of the side column that can be folded away. The "?" holds the longer explanation. */

type TabId = "info" | "structure" | "visual" | "layout" | "assistant";
const TABS: { id: TabId; label: string }[] = [
  { id: "info", label: "Info" },
  { id: "structure", label: "Structure" },
  { id: "visual", label: "Visual" },
  { id: "layout", label: "Layout" },
  { id: "assistant", label: "Assistant" },
];
const TabContext = createContext<TabId>("structure");

/**
 * A group of controls in the side column, shown when its tab is the open one. It can be folded away, and
 * its "?" opens the longer explanation in place (by click, so it also works by touch).
 */
function Section({ title, hint, closed, tab, children }: { title: string; hint?: string; closed?: boolean; tab: TabId; children: ReactNode }) {
  const active = useContext(TabContext);
  const [explain, setExplain] = useState(false);
  if (tab !== active) return null;
  return (
    <details className="card section" open={!closed}>
      <summary>
        <span>{title}</span>
        {hint && (
          <button
            type="button"
            className={`info${explain ? " on" : ""}`}
            title={hint}
            aria-label={`About ${title}`}
            aria-expanded={explain}
            onClick={(e) => {
              e.preventDefault(); // do not fold the section
              setExplain((x) => !x);
            }}
          >
            ?
          </button>
        )}
      </summary>
      <div className="section-body">
        {hint && explain && <p className="explain">{hint}</p>}
        {children}
      </div>
    </details>
  );
}
