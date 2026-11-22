// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { svgToPng } from "../render/png";
import { previewFrame } from "../preview/data";
import { PREVIEW_FROM, usePreview } from "../preview/usePreview";
import { AnglePlot } from "./AnglePlot";
import { DEFAULT_CANVAS, fitView, renderSvg, steadyFit, structureCentre, structureHeight, type Fit } from "../render/svg";
import { NO_ZOOM, isZoomed, panBy, zoomAbout, zoomToBox, zoomedFit, type Zoom } from "../render/zoom";
import {
  between, directAxes, directionVector, fromBehind, lowIndexDirections, nearestDirection, numbersFromView, readView, rolled, snapTo, viewAlong, viewFromNumbers,
  writeDirection, writeView, type Axis, type Direction, type ViewNumbers,
} from "../render/camera";
import { DEFAULT_VIEW, dragView, type View } from "../render/view";
import { buildScene, DEFAULT_SPEC, DEFAULT_STICK, elementColour, largestMoment, speciesRadius, type Look, type Scene } from "../scene/scene";
import { expandToUnitCell } from "../structure/expand";
import { DEFAULT_ANGLE_LOOK, type AngleRule } from "../scene/angles";
import { pairDistances, type BondRule } from "../scene/bonds";
import type { BoundaryRule, Range } from "../scene/select";
import { readCif } from "../structure/readCif";
import type { Structure } from "../structure/types";

// Published structures shipped with the page (see examples/README.md).
const EXAMPLES = Object.entries(
  import.meta.glob<string>("../../examples/*.{cif,mcif}", { query: "?raw", import: "default", eager: true }),
).map(([path, text]) => ({ file: path.split("/").pop()!, name: path.split("/").pop()!.replace(/\.m?cif$/, ""), text }));

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
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [transparent, setTransparent] = useState(true);
  const [pngWidth, setPngWidth] = useState(2880);
  const [over, setOver] = useState(false);
  const [rangeText, setRangeText] = useState<string[]>(ONE_CELL_TEXT);
  const [repeatBoundary, setRepeatBoundary] = useState(true);
  const [bondRules, setBondRules] = useState<(BondRule & { maxText: string; widthText?: string })[]>([]);
  const [showCell, setShowCell] = useState(true);
  const [newPair, setNewPair] = useState("");
  // The user's changes to colours, sizes and names. Radii are kept as typed, so a box can be emptied while editing.
  const [looks, setLooks] = useState<Record<string, { colour?: string; radiusText?: string; name?: string; hidden?: boolean; orderText?: string }>>({});
  // ---- The view. It is kept as a rotation matrix; the four numbers (axis up, turn, tilt, roll) are read from it,
  // so they are always true, whatever moved the view.
  const [upAxis, setUpAxis] = useState<Axis>(2);
  const axes = useMemo(() => (structure ? directAxes(structure.cell) : null), [structure]);
  const numbers: ViewNumbers = useMemo(() => (axes ? numbersFromView(axes, view, upAxis) : { up: upAxis, turn: 18, tilt: 12, roll: 0 }), [axes, view, upAxis]);
  const lastNumbers = useRef(numbers);
  lastNumbers.current = numbers;
  // The number boxes hold what was typed while typing; any other change of the view rewrites them.
  const [numberText, setNumberText] = useState({ turn: "18", tilt: "12", roll: "0" });
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
  const goTo = (target: View) => {
    cancelAnimationFrame(turning.current);
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
  const viewLine = `${writeView(numbers)}${named ? (named.angle < 0.05 ? ` · along ${writeDirection(named.direction)}` : ` · ${named.angle.toFixed(1)}° from ${writeDirection(named.direction)}`) : ""}`;
  const [showVacancy, setShowVacancy] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [letterWeight, setLetterWeight] = useState(DEFAULT_SPEC.letterWeight);
  const [legendFollows, setLegendFollows] = useState(false);
  const [legendSizeText, setLegendSizeText] = useState("1");
  const [axesSizeText, setAxesSizeText] = useState("1");
  const sizeOf = (text: string): number => (Number(text) >= 0.2 && Number(text) <= 4 ? Number(text) : 1);
  const [legendSize, axesSize] = [sizeOf(legendSizeText), sizeOf(axesSizeText)];
  const [momentHeadText, setMomentHeadText] = useState("1");
  const [axesHeadText, setAxesHeadText] = useState("1");
  const [momentHeadSize, axesHeadSize] = [sizeOf(momentHeadText), sizeOf(axesHeadText)];
  const [momentOutline, setMomentOutline] = useState(false);
  const [axesOutline, setAxesOutline] = useState(false);
  const [fontFamily, setFontFamily] = useState(DEFAULT_SPEC.fontFamily);
  const [customFont, setCustomFont] = useState(false);
  // Angle rules; the limits and the look are kept as typed.
  const [angleRules, setAngleRules] = useState<(AngleRule & { minText: string; maxText: string; radiusText: string; opacityText: string })[]>([]);
  const [newAngle, setNewAngle] = useState("");
  // While the pointer rests on a bar of an angle plot: that rule shows only the bar's angles.
  const [angleHover, setAngleHover] = useState<{ rule: number; range: [number, number] } | null>(null);
  const changeAngle = (index: number, change: Partial<(typeof angleRules)[number]>) => setAngleRules((all) => all.map((x, i) => (i === index ? { ...x, ...change } : x)));
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
  const [momentThicknessText, setMomentThicknessText] = useState(String(DEFAULT_SPEC.momentThickness));
  const momentThickness = Number(momentThicknessText) >= 0.02 && Number(momentThicknessText) <= 2 ? Number(momentThicknessText) : DEFAULT_SPEC.momentThickness;
  const momentLength = Number(momentLengthText) > 0 && Number(momentLengthText) <= 20 ? Number(momentLengthText) : DEFAULT_SPEC.momentLength;
  const [showAxes, setShowAxes] = useState(true);
  const setLook = (key: string, change: { colour?: string; radiusText?: string; name?: string; hidden?: boolean; orderText?: string }) =>
    setLooks((all) => ({ ...all, [key]: { ...all[key], ...change } }));
  const last = useRef<{ x: number; y: number } | null>(null);
  // While dragging, the placement of the moment the drag began is kept, so the figure turns without jumping.
  const [heldFit, setHeldFit] = useState<Fit | null>(null);
  // Zoom and pan of the structure within its space; and whether the saved figure follows them.
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const [saveZoomed, setSaveZoomed] = useState(true);

  const keepViewRef = useRef(false);
  keepViewRef.current = keepView;
  const load = useCallback((text: string, name: string) => {
    try {
      const read = readCif(text);
      buildScene(read); // fail here, with a message, rather than while drawing
      lastScene.current = null;
      setStructure(read);
      setFileName(name);
      setError("");
      // A new file starts from the default view, or (if asked) keeps the present one in the new cell's own
      // terms: the same axis up, the same turn, tilt and roll.
      setView(keepViewRef.current ? viewFromNumbers(directAxes(read.cell), lastNumbers.current) : DEFAULT_VIEW);
      setRangeText(ONE_CELL_TEXT);
      setZoom(NO_ZOOM);
      setBondRules([]);
      setNewPair("");
      setLooks({});
      setAngleRules([]);
      setAngleHover(null);
      setNewAngle("");
      if (!keepViewRef.current) setUpAxis(2);
    } catch (e) {
      setError(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

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
      return { scene: buildScene(structure, { range, bonds, showCell, looks: sceneLooks, showVacancy, angles: sceneAngles, showMoments, momentLength, momentColour, momentThickness, momentHeadSize, axesHeadSize, momentOutline, axesOutline, letterWeight, fontFamily, legendFollowsZoom: legendFollows, legendSize, axesSize, showLegend, showAxes }), rangeError: "" };
    } catch (e) {
      return { scene: lastScene.current, rangeError: e instanceof Error ? e.message : String(e) };
    }
  }, [structure, rangeText, repeatBoundary, bondRules, showCell, sceneLooks, showVacancy, sceneAngles, showMoments, momentLength, momentColour, momentThickness, momentHeadSize, axesHeadSize, momentOutline, axesOutline, letterWeight, fontFamily, legendFollows, legendSize, axesSize, showLegend, showAxes]);
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
  const large = scene !== null && scene.spheres.length + scene.sticks.length >= previewFrom;
  const usePreviewNow = smooth && large && !preview.failed;
  useEffect(() => {
    if (!scene || !usePreviewNow || preview.loaded === scene) return;
    preview.load(scene);
    // Draw one frame at once, unseen: the graphics card then has the structure and the programs ready
    // before the first movement, instead of preparing them during it.
    const f = fitView(scene, view, DEFAULT_CANVAS);
    preview.draw(previewFrame(scene, view, DEFAULT_CANVAS, f), 720, 550);
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
  const canvasOptions = useMemo(() => ({ ...DEFAULT_CANVAS, background: transparent ? null : "#ffffff" }), [transparent]);
  const fixedScale = Number(fixedScaleText) >= 2 && Number(fixedScaleText) <= 1000 ? Number(fixedScaleText) : 60;
  const fit = useMemo(() => {
    if (!scene) return null;
    // Fitted to the outline of each view (held still during a drag), or a scale that does not depend on the view.
    const base = scaleMode === "outline" ? (heldFit ?? fitView(scene, view, DEFAULT_CANVAS)) : steadyFit(scene, DEFAULT_CANVAS, scaleMode === "fixed" ? fixedScale : undefined);
    return zoomedFit(base, zoom, structureCentre(scene, DEFAULT_CANVAS));
  }, [scene, view, heldFit, zoom, scaleMode, fixedScale]);
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
    const k = Math.min(r.width / DEFAULT_CANVAS.width, r.height / DEFAULT_CANVAS.height) * Math.min(window.devicePixelRatio || 1, 2);
    const id = preview.draw(previewFrame(scene, view, DEFAULT_CANVAS, fit), Math.round(DEFAULT_CANVAS.width * k), Math.round(DEFAULT_CANVAS.height * k));
    if (!wasPreviewing.current) setFirstFrame(id);
    wasPreviewing.current = true;
  }, [previewing, scene, view, fit, preview.draw]);
  // Where the drawing sits inside its frame, in screen px: centred, with the canvas's own shape.
  const [drawingBox, setDrawingBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  useEffect(() => {
    const el = figureRef.current;
    if (!el) return;
    const measure = () => {
      const k = Math.min(el.clientWidth / DEFAULT_CANVAS.width, el.clientHeight / DEFAULT_CANVAS.height);
      const [width, height] = [DEFAULT_CANVAS.width * k, DEFAULT_CANVAS.height * k];
      setDrawingBox({ left: (el.clientWidth - width) / 2 + el.clientLeft, top: (el.clientHeight - height) / 2 + el.clientTop, width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scene !== null]);
  // The preview is shown once the worker has drawn a frame of this movement; until then the last full figure stays.
  const previewLive = previewing && firstFrame > 0 && preview.drawn >= firstFrame;
  // The page shows the figure as two layers: the structure, and on top of it the legend and axes. While the
  // preview is live the structure layer is only hidden (its drawing is kept, so nothing has to be torn down),
  // and the legend and axes go on following the view. Both layers come from the same code as the saved figure.
  const lastStructure = useRef("");
  const structureSvg = useMemo(() => {
    if (!scene || !fit) return "";
    if (!previewing) lastStructure.current = renderSvg(scene, view, canvasOptions, fit, "structure");
    return lastStructure.current;
  }, [scene, view, canvasOptions, fit, previewing]);
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
    if (file) void file.text().then((text) => load(text, file.name));
  };
  // ---- Gestures on the figure. Plain drag turns; Shift + drag or the middle button moves; Ctrl/Cmd + wheel,
  // a pinch, or the + and - keys zoom; double-click or 0 resets the zoom; "Box" then a drag zooms to a rectangle.
  const figureRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<"turn" | "move" | "box" | "pinch" | null>(null);
  const [boxMode, setBoxMode] = useState(false);
  const [box, setBox] = useState<{ from: [number, number]; to: [number, number] } | null>(null);
  const centre = scene ? structureCentre(scene, DEFAULT_CANVAS) : ([0, 0] as [number, number]);
  /** Px of the canvas per px of the screen, and the canvas point under a screen point. */
  const canvasScale = (): number => {
    const r = figureRef.current!.getBoundingClientRect();
    return 1 / Math.min(r.width / DEFAULT_CANVAS.width, r.height / DEFAULT_CANVAS.height);
  };
  const toCanvas = (clientX: number, clientY: number): [number, number] => {
    const r = figureRef.current!.getBoundingClientRect();
    const k = canvasScale();
    // The SVG is centred in the frame, with empty strips on two sides when the shapes differ.
    return [(clientX - r.left - (r.width - DEFAULT_CANVAS.width / k) / 2) * k, (clientY - r.top - (r.height - DEFAULT_CANVAS.height / k) / 2) * k];
  };
  const resetZoom = () => setZoom(NO_ZOOM);
  const zoomAtCentre = (by: number) => setZoom((z) => zoomAbout(z, by, centre, centre));

  const onPointerDown = (e: PointerEvent) => {
    if (!scene) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    last.current = { x: e.clientX, y: e.clientY };
    if (pointers.current.size === 2) {
      gesture.current = "pinch";
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
      setHeldFit(fitView(scene, view, DEFAULT_CANVAS));
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!last.current || !gesture.current) return;
    const before = pointers.current.get(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.current === "pinch") {
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (!before || !other) return;
      const [was, now] = [Math.hypot(before.x - other.x, before.y - other.y), Math.hypot(e.clientX - other.x, e.clientY - other.y)];
      const middle = toCanvas((e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
      if (was > 0) setZoom((z) => zoomAbout(z, now / was, middle, centre));
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
    if (gesture.current === "box" && box && scene) {
      setZoom((z) => zoomToBox(z, box.from, box.to, centre, DEFAULT_CANVAS.width, structureHeight(scene, DEFAULT_CANVAS)));
      setBoxMode(false);
    }
    setBox(null);
    if (pointers.current.size === 0) {
      // Released close to a low-index direction: click onto it exactly.
      if (gesture.current === "turn" && snap && near && near.angle > 0.02 && near.angle <= SNAP_DEGREES && structure) {
        goTo(snapTo(view, directionVector(structure.cell, near.direction)));
      }
      last.current = null;
      gesture.current = null;
      setHeldFit(null); // refit to the new orientation
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
      setZoom((z) => zoomAbout(z, Math.exp(-e.deltaY * 0.01), about, structureCentre(scene!, DEFAULT_CANVAS)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);
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

  const cell = structure?.cell;
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark">MOTIF</span>
          <span className="tagline">Crystal structure figures from CIF and mCIF</span>
        </div>
        <div className="actions">
          <label className="button primary">
            Open file…
            <input
              type="file"
              accept=".cif,.mcif"
              data-testid="file"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void file.text().then((text) => load(text, file.name));
                e.target.value = ""; // so the same file can be opened again
              }}
            />
          </label>
          <select
            data-testid="example"
            value=""
            onChange={(e) => {
              const example = EXAMPLES.find((x) => x.name === e.target.value);
              if (example) load(example.text, example.file);
            }}
          >
            <option value="">Examples…</option>
            {EXAMPLES.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name}
              </option>
            ))}
          </select>
          {scene && (
            <>
              <span className="divider" />
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
                  title="Image made from the same SVG, at the width given"
                  onClick={() => {
                    svgToPng(figureToSave(), pngWidth).then(
                      (blob) => download(blob, `${baseName}.png`),
                      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
                    );
                  }}
                >
                  Save PNG
                </button>
                <input type="number" min={100} step={10} title="Width of the PNG in pixels" value={pngWidth} onChange={(e) => setPngWidth(Number(e.target.value))} />
                <span className="unit">px ({(pngWidth / DEFAULT_CANVAS.width).toFixed(2)}×)</span>
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
              <div className="figure-wrap">
                <div
                  ref={figureRef}
                  className={`figure${transparent ? "" : " white"}${boxMode ? " boxing" : ""}`}
                  data-testid="figure"
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
                  style={{ display: previewLive ? "block" : "none", left: drawingBox.left, top: drawingBox.top, width: drawingBox.width, height: drawingBox.height }}
                />
                {previewLive && <div className="preview-note">Simplified while moving</div>}
                {box && (() => {
                  // The dragged rectangle, in screen px of the frame.
                  const r = figureRef.current!.getBoundingClientRect();
                  const k = canvasScale();
                  const sx = (x: number): number => x / k + (r.width - DEFAULT_CANVAS.width / k) / 2;
                  const sy = (y: number): number => y / k + (r.height - DEFAULT_CANVAS.height / k) / 2;
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
                </p>
                <p className="hint">
                  Drag to turn · Alt + drag to roll · Shift + drag to move · Ctrl/⌘ + wheel or pinch to zoom · double-click to fit.
                  {transparent && " The checker marks where the figure is transparent."}
                </p>
                {isZoomed(zoom) && (
                  <label className="check" data-testid="save-zoomed-label">
                    <input type="checkbox" data-testid="save-zoomed" checked={saveZoomed} onChange={(e) => setSaveZoomed(e.target.checked)} />
                    {saveZoomed ? "Save writes this zoomed view" : "Save writes the whole structure, not this zoomed view"}
                  </label>
                )}
              </div>
            </>
          ) : (
            <div className="empty">
              <p className="empty-title">Drop a CIF or mCIF file here</p>
              <p>or use <b>Open file…</b> or <b>Examples…</b> above.</p>
              <p className="faint">The file is read in this page and never leaves your computer.</p>
            </div>
          )}
        </section>
        {structure && scene && cell && (
          <aside className="side">
            <Section title="Structure" hint="What the file says. Nothing here changes the figure." closed>
              <table data-testid="info">
                <tbody>
                  <tr><td>Name</td><td>{structure.name}</td></tr>
                  <tr><td>{structure.magnetic ? "Magnetic space group" : "Space group"}</td><td>{structure.spaceGroupName ?? "not named"}</td></tr>
                  <tr><td>a, b, c (Å)</td><td>{cell.a}, {cell.b}, {cell.c}</td></tr>
                  <tr><td>α, β, γ (°)</td><td>{cell.alpha}, {cell.beta}, {cell.gamma}</td></tr>
                  <tr><td>Symmetry operations</td><td>{structure.operations.length}</td></tr>
                  <tr><td>Sites in the file</td><td>{structure.sites.length}</td></tr>
                  {largestMoment(structure) > 0 && (
                    <tr><td>Largest moment</td><td data-testid="largest-moment">{largestMoment(structure).toFixed(2)} μB</td></tr>
                  )}
                  <tr><td>Atoms drawn</td><td>{scene.spheres.length}{counts && ` (${counts})`}</td></tr>
                </tbody>
              </table>
            </Section>
            <Section title="Shown" hint="The part of the crystal that is drawn: a range along each cell axis, in units of the cell edge. Whole numbers give whole cells; a narrow range gives a slab. An atom within 0.001 of a limit counts as on it.">
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
            <Section title="Atoms" hint="Colour and size of each element. A site shared by several elements is drawn as a pie whose wedges are the occupancies. Untick an element to leave it out.">
              {contents.elements.map((element) => {
                const pure = contents.species.find((x) => x.key === element);
                return (
                  <div className="row" key={element} data-testid={`look-${element}`}>
                    <input
                      type="color"
                      title={`Colour of ${element}`}
                      value={elementColour(element, sceneLooks)}
                      onChange={(e) => setLook(element, { colour: e.target.value })}
                    />
                    <b className="symbol">{element}</b>
                    {pure && (
                      <>
                        <input
                          type="checkbox"
                          title={`Show ${element}`}
                          data-testid={`show-${element}`}
                          checked={!looks[element]?.hidden}
                          onChange={(e) => setLook(element, { hidden: !e.target.checked })}
                        />
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
                  <p className="sub">
                    Shared site: {x.components.map((c) => `${c.element} ${c.occupancy}`).join(", ")}
                    {x.varied && " (and other proportions)"}
                  </p>
                  <div className="row">
                    <input type="checkbox" title="Show this site" checked={!looks[x.key]?.hidden} onChange={(e) => setLook(x.key, { hidden: !e.target.checked })} />
                    name
                    <input type="text" className="name" value={looks[x.key]?.name ?? x.key} onChange={(e) => setLook(x.key, { name: e.target.value })} />
                  </div>
                  <div className="row">
                    wedges
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
                    radius
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
            <Section title="Bonds" hint="A bond joins every pair of the two chosen atoms that are no further apart than the distance given. The list shows the distances found in the structure, shortest first.">
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
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={r.complete}
                      onChange={(e) => setBondRules((all) => all.map((x, i) => (i === index ? { ...x, complete: e.target.checked } : x)))}
                    />
                    Add {nameOf(r.neighbour)} outside the range bonded to {nameOf(r.centre)} inside
                  </label>
                  <div className="row">
                    <input type="color" title="Colour of these bonds" value={r.colour ?? DEFAULT_STICK.colour} onChange={(e) => changeRule(index, { colour: e.target.value })} />
                    thickness
                    <input
                      type="number"
                      step={0.02}
                      min={0.02}
                      max={2}
                      data-testid={`bond-width-${index}`}
                      value={r.widthText ?? String(DEFAULT_STICK.width)}
                      onChange={(e) => changeRule(index, { widthText: e.target.value })}
                    />
                    Å
                  </div>
                  <label className="row">
                    <input type="checkbox" data-testid={`bond-band-${index}`} checked={r.band ?? false} onChange={(e) => changeRule(index, { band: e.target.checked })} />
                    Highlight band behind these bonds
                  </label>
                  {r.band && (scene?.ruleInfo[sceneRule(index)]?.groups ?? 0) > 1 && (
                    <div className="row">
                      highlight
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
                  <p className="sub" data-testid={`bond-count-${index}`}>
                    {r.max > 0.1 && r.max <= 10
                      ? `${bondCount(index)} bonds drawn, in ${scene?.ruleInfo[sceneRule(index)]?.groups ?? 0} connected group(s); ${scene?.ruleInfo[sceneRule(index)]?.triangles ?? 0} triangles`
                      : "Give a distance between 0.1 and 10 Å."}
                  </p>
                </div>
              ))}
              <div className="row">
                <select data-testid="new-pair" value={newPair} onChange={(e) => setNewPair(e.target.value)}>
                  <option value="">Add a bond between…</option>
                  {pairs.map((p) => (
                    <option key={p.key} value={p.key}>
                      {nameOf(p.centre)}–{nameOf(p.neighbour)} (distances {p.distances.slice(0, 3).map((d) => d.toFixed(2)).join(", ")} Å…)
                    </option>
                  ))}
                </select>
                <button data-testid="add-bond" disabled={!newPair} onClick={addBond}>Add</button>
              </div>
              <label className="row">
                <input type="checkbox" data-testid="show-cell" checked={showCell} onChange={(e) => setShowCell(e.target.checked)} />
                Unit cell outline
              </label>
            </Section>
            <Section title="Angles" hint="Marks the angle between two drawn bonds that meet at an atom, so add the bonds first. The list shows the kinds of angle found and their sizes. Every angle of the chosen kind whose size lies in the range is marked.">
              {angleRules.map((r, index) => (
                <div key={index} className="rule" data-testid={`angle-${index}`}>
                  <div className="row">
                    <b>{nameOf(r.ends[0])}–{nameOf(r.centre)}–{nameOf(r.ends[1])}</b>
                    <button title="Remove this angle" onClick={() => setAngleRules((all) => all.filter((_, i) => i !== index))}>×</button>
                  </div>
                  <div className="row">
                    from
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
                  <div className="row">
                    <input type="color" title="Colour of the mark" value={r.colour ?? DEFAULT_ANGLE_LOOK.colour} onChange={(e) => changeAngle(index, { colour: e.target.value })} />
                    opacity
                    <input type="number" step={0.05} min={0.05} max={1} value={r.opacityText} onChange={(e) => changeAngle(index, { opacityText: e.target.value })} />
                    size
                    <input type="number" step={0.1} min={0.1} max={5} value={r.radiusText} onChange={(e) => changeAngle(index, { radiusText: e.target.value })} />
                    Å
                  </div>
                  <label className="row">
                    <input type="checkbox" data-testid={`angle-label-${index}`} checked={r.label ?? DEFAULT_ANGLE_LOOK.label} onChange={(e) => changeAngle(index, { label: e.target.checked })} />
                    Write the angle beside it
                  </label>
                  <p className="sub" data-testid={`angle-count-${index}`}>{scene.sectors.filter((x) => x.rule === index).length} angles marked</p>
                </div>
              ))}
              {scene.angleKinds.length === 0 ? (
                <p className="sub">No two drawn bonds meet at an atom yet. Add bonds first.</p>
              ) : (
                <div className="row">
                  <select data-testid="new-angle" value={newAngle} onChange={(e) => setNewAngle(e.target.value)}>
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
            {largestMoment(structure) > 0 && (
              <Section title="Magnetic moments" hint="A moment is drawn as an arrow through its atom, centred on it. The arrow of the largest moment in the file has the length given here; the others are in proportion.">
                <label className="row">
                  <input type="checkbox" data-testid="show-moments" checked={showMoments} onChange={(e) => setShowMoments(e.target.checked)} />
                  Arrows through the atoms
                </label>
                <div className="row">
                  <input type="color" title="Colour of the arrows" value={momentColour} onChange={(e) => setMomentColour(e.target.value)} />
                  length
                  <input type="number" step={0.25} min={0.25} max={20} data-testid="moment-length" value={momentLengthText} onChange={(e) => setMomentLengthText(e.target.value)} />
                  Å
                </div>
                <div className="row">
                  thickness
                  <input type="number" step={0.02} min={0.02} max={2} data-testid="moment-thickness" title="Thickness of the rod. The cone at the tip keeps its proportion to it." value={momentThicknessText} onChange={(e) => setMomentThicknessText(e.target.value)} />
                  Å
                  head
                  <input type="number" step={0.1} min={0.2} max={4} data-testid="moment-head" title="Size of the cone at the tip, as a multiple of its usual proportion to the rod." value={momentHeadText} onChange={(e) => setMomentHeadText(e.target.value)} />×
                </div>
                <label className="row">
                  <input type="checkbox" data-testid="moment-outline" checked={momentOutline} onChange={(e) => setMomentOutline(e.target.checked)} />
                  Outline the arrows
                </label>
              </Section>
            )}
            <Section title="Legend and axes" hint="The arrows are the directions of the cell edges a, b, c. An arrow tilted out of the screen is drawn shorter.">
              <label className="row">
                <input type="checkbox" data-testid="show-legend" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} />
                Legend
              </label>
              <label className="row" title="The legend's spheres are drawn at the size of the atoms in the figure, and its letters in proportion, so the legend grows and shrinks with the zoom.">
                <input type="checkbox" data-testid="legend-follows" checked={legendFollows} onChange={(e) => setLegendFollows(e.target.checked)} />
                Legend follows the size of the structure
              </label>
              <label className="row">
                <input type="checkbox" data-testid="show-axes" checked={showAxes} onChange={(e) => setShowAxes(e.target.checked)} />
                Axes a, b, c
              </label>
              <div className="row" title="Size of the legend, and of the axis arrows with their letters, as multiples of the usual size.">
                legend size
                <input type="number" step={0.1} min={0.2} max={4} data-testid="legend-size" value={legendSizeText} onChange={(e) => setLegendSizeText(e.target.value)} />×
                axes size
                <input type="number" step={0.1} min={0.2} max={4} data-testid="axes-size" value={axesSizeText} onChange={(e) => setAxesSizeText(e.target.value)} />×
                axes head
                <input type="number" step={0.1} min={0.2} max={4} data-testid="axes-head" title="Size of the cones of the axis arrows, as a multiple of the usual." value={axesHeadText} onChange={(e) => setAxesHeadText(e.target.value)} />×
              </div>
              <label className="row">
                <input type="checkbox" data-testid="axes-outline" checked={axesOutline} onChange={(e) => setAxesOutline(e.target.checked)} />
                Outline the axis arrows
              </label>
              <div className="row">
                font
                <select
                  data-testid="font-family"
                  value={customFont ? "other" : fontFamily}
                  onChange={(e) => {
                    setCustomFont(e.target.value === "other");
                    if (e.target.value !== "other") setFontFamily(e.target.value);
                  }}
                >
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                  <option value="other">Other…</option>
                </select>
                {customFont && (
                  <input type="text" className="name" data-testid="font-custom" placeholder="Font name" value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} />
                )}
              </div>
              {!fontInstalled(fontFamily) && (
                <p className="sub" data-testid="font-missing">
                  “{fontFamily}” is not installed on this computer, so another font is shown here and in the PNG. The SVG keeps the name.
                </p>
              )}
              <div className="row">
                weight
                <select data-testid="letter-weight" value={letterWeight} onChange={(e) => setLetterWeight(Number(e.target.value))}>
                  <option value={400}>regular</option>
                  <option value={500}>medium</option>
                  <option value={800}>heavy</option>
                </select>
              </div>
            </Section>
            <Section title="View" hint="The view is four numbers: the cell axis that is up, turn about it, tilt (from above when positive) and roll about the line of sight. The line under the figure always shows them, and the nearest low-index direction. A direction given here points at you.">
              <div className="row">
                up
                <select data-testid="view-up" value={upAxis} onChange={(e) => applyNumbers({ ...numbers, up: Number(e.target.value) as Axis, turn: Number(numberText.turn), tilt: Number(numberText.tilt), roll: Number(numberText.roll) })}>
                  <option value={0}>a</option>
                  <option value={1}>b</option>
                  <option value={2}>c</option>
                </select>
                turn
                <input type="number" step={5} data-testid="view-az" value={numberText.turn} onChange={(e) => typeNumber("turn", e.target.value)} />°
              </div>
              <div className="row">
                tilt
                <input type="number" step={5} min={-90} max={90} data-testid="view-el" value={numberText.tilt} onChange={(e) => typeNumber("tilt", e.target.value)} />°
                roll
                <input type="number" step={5} data-testid="view-roll" value={numberText.roll} onChange={(e) => typeNumber("roll", e.target.value)} />°
              </div>
              <div className="row">
                look along
                {(["a", "b", "c"] as const).map((name, k) => {
                  const indices: [number, number, number] = [0, 0, 0];
                  indices[k] = 1;
                  return (
                    <span key={name} className="row">
                      <button data-testid={`along-${name}`} title={`Along ${name}, pointing at you`} onClick={() => lookAlong({ kind: "uvw", indices })}>{name}</button>
                      <button data-testid={`along-${name}-star`} title={`Along ${name}*, the normal to the planes, pointing at you`} onClick={() => lookAlong({ kind: "hkl", indices })}>{name}*</button>
                    </span>
                  );
                })}
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
              <div className="row">
                <button data-testid="view-behind" title="The same line of sight, seen from the opposite side" onClick={() => goTo(fromBehind(view))}>Other side</button>
                <button data-testid="view-quarter" title="Turn the picture a quarter turn about the line of sight" onClick={() => goTo(rolled(view, 90))}>Turn 90°</button>
                <button
                  data-testid="view-reset"
                  onClick={() => {
                    setUpAxis(2);
                    goTo(DEFAULT_VIEW);
                  }}
                >
                  Reset
                </button>
              </div>
              <div className="row">
                drag
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
              <div className="row">
                scale
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
              <div className="rule">
                <p className="sub">Saved views (kept in this browser). A view is its four numbers, so it means the same axes in another structure.</p>
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
              </div>
              <label className="row" title="While a large structure is turned, moved or zoomed, a simplified drawing made by the graphics card stands in for it; the full figure returns when you stop. The saved figure is never the simplified one.">
                <input type="checkbox" data-testid="smooth" checked={smooth} onChange={(e) => setSmooth(e.target.checked)} />
                Smooth movement for large structures
              </label>
              {smooth && !preview.failed && (
                <div className="row">
                  from
                  <input type="number" min={0} step={100} data-testid="preview-from" title="Atoms plus bonds drawn. Below this the vector figure itself is redrawn while moving." value={previewFromText} onChange={(e) => setPreviewFromText(e.target.value)} />
                  atoms and bonds
                  {scene && <span className="sub">(now {scene.spheres.length + scene.sticks.length})</span>}
                </div>
              )}
              {preview.failed && <p className="sub" data-testid="preview-failed">Not available in this browser ({preview.failed}); the vector figure is redrawn instead.</p>}
            </Section>
          </aside>
        )}
      </main>
      <footer className="foot">
        <span>The file is read in this page and never leaves your computer.</span>
        <span>MOTIF {VERSION}</span>
      </footer>
    </div>
  );
}

const VERSION = "0.1";
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
const FONTS = ["Avenir", "Avenir Next", "Helvetica Neue", "Helvetica", "Arial", "Gill Sans", "Futura", "Optima", "Verdana", "Times New Roman", "Georgia", "Palatino", "Menlo"];

/**
 * Whether this computer has a font of that name: text set in it is measured against the same text in two
 * generic fonts; a missing font falls back to the generic one and measures the same as it both times.
 */
const fontChecks = new Map<string, boolean>();
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

/** A card of the side column that can be folded away. The "?" holds the longer explanation. */
function Section({ title, hint, closed, children }: { title: string; hint?: string; closed?: boolean; children: ReactNode }) {
  return (
    <details className="card section" open={!closed}>
      <summary>
        <span>{title}</span>
        {hint && (
          <span className="info" title={hint} aria-label={hint} role="img">
            ?
          </span>
        )}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
