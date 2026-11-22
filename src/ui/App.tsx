import { useCallback, useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { svgToPng } from "../render/png";
import { DEFAULT_CANVAS, fitView, renderSvg, type Fit } from "../render/svg";
import { DEFAULT_VIEW, dragView, viewWithAxisUp, type View } from "../render/view";
import { buildScene, cellAxes, DEFAULT_SPEC, DEFAULT_STICK, elementColour, largestMoment, speciesRadius, type Look, type Scene } from "../scene/scene";
import { expandToUnitCell } from "../structure/expand";
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
  const [looks, setLooks] = useState<Record<string, { colour?: string; radiusText?: string; name?: string; hidden?: boolean }>>({});
  const [upAxis, setUpAxis] = useState<0 | 1 | 2>(2);
  const [azText, setAzText] = useState("18");
  const [elText, setElText] = useState("12");
  const applyView = (up: 0 | 1 | 2, az: string, el: string) => {
    if (!structure || !Number.isFinite(Number(az)) || !Number.isFinite(Number(el)) || az.trim() === "" || el.trim() === "") return;
    const [a, b, c] = cellAxes(structure).map((x) => x.direction);
    setView(viewWithAxisUp([a!, b!, c!], up, Number(az), Number(el)));
  };
  const [showVacancy, setShowVacancy] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [showMoments, setShowMoments] = useState(true);
  const [momentLengthText, setMomentLengthText] = useState(String(DEFAULT_SPEC.momentLength));
  const [momentColour, setMomentColour] = useState(DEFAULT_SPEC.momentColour);
  const momentLength = Number(momentLengthText) > 0 && Number(momentLengthText) <= 20 ? Number(momentLengthText) : DEFAULT_SPEC.momentLength;
  const [showAxes, setShowAxes] = useState(true);
  const setLook = (key: string, change: { colour?: string; radiusText?: string; name?: string; hidden?: boolean }) =>
    setLooks((all) => ({ ...all, [key]: { ...all[key], ...change } }));
  const last = useRef<{ x: number; y: number } | null>(null);
  // While dragging, the placement of the moment the drag began is kept, so the figure turns without jumping.
  const [heldFit, setHeldFit] = useState<Fit | null>(null);

  const load = useCallback((text: string, name: string) => {
    try {
      const read = readCif(text);
      buildScene(read); // fail here, with a message, rather than while drawing
      lastScene.current = null;
      setStructure(read);
      setFileName(name);
      setError("");
      setView(DEFAULT_VIEW);
      setRangeText(ONE_CELL_TEXT);
      setBondRules([]);
      setNewPair("");
      setLooks({});
      setUpAxis(2);
      setAzText("18");
      setElText("12");
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
      return { scene: buildScene(structure, { range, bonds, showCell, looks: sceneLooks, showVacancy, showMoments, momentLength, momentColour, showLegend, showAxes }), rangeError: "" };
    } catch (e) {
      return { scene: lastScene.current, rangeError: e instanceof Error ? e.message : String(e) };
    }
  }, [structure, rangeText, repeatBoundary, bondRules, showCell, sceneLooks, showVacancy, showMoments, momentLength, momentColour, showLegend, showAxes]);
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
  const svg = useMemo(
    () => (scene ? renderSvg(scene, view, { ...DEFAULT_CANVAS, background: transparent ? null : "#ffffff" }, heldFit ?? undefined) : ""),
    [scene, view, transparent, heldFit],
  );
  const baseName = fileName.replace(/\.[^.]+$/, "") || "motif";

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files[0];
    // The file is read here, in the page. Nothing is uploaded.
    if (file) void file.text().then((text) => load(text, file.name));
  };
  const onPointerDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = { x: e.clientX, y: e.clientY };
    if (scene) setHeldFit(fitView(scene, view, DEFAULT_CANVAS));
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!last.current) return;
    const k = (2 * Math.PI) / DRAG_PX_PER_TURN;
    const dx = (e.clientX - last.current.x) * k;
    const dy = (e.clientY - last.current.y) * k;
    last.current = { x: e.clientX, y: e.clientY };
    setView((v) => dragView(v, dx, dy));
  };
  const onPointerUp = () => {
    last.current = null;
    setHeldFit(null); // refit to the new orientation
  };

  const cell = structure?.cell;
  return (
    <div className="app">
      <div
        className={`stage${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {scene ? (
          <div
            className={`figure${transparent ? "" : " white"}`}
            data-testid="figure"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <p className="empty">
            Drop a CIF file here
            <br />
            or pick an example on the right.
          </p>
        )}
      </div>
      <div className="panel">
        <h1>MOTIF</h1>
        <p className="sub">Crystal structure figures from CIF</p>

        <h2>File</h2>
        <div className="row">
          <input
            type="file"
            accept=".cif,.mcif"
            data-testid="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void file.text().then((text) => load(text, file.name));
            }}
          />
        </div>
        <div className="row">
          <select
            data-testid="example"
            value=""
            onChange={(e) => {
              const example = EXAMPLES.find((x) => x.name === e.target.value);
              if (example) load(example.text, example.file);
            }}
          >
            <option value="">Load an example…</option>
            {EXAMPLES.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <p className="sub">The file stays on this computer.</p>
        {error && <p className="error" data-testid="error">{error}</p>}

        {structure && scene && cell && (
          <>
            <h2>Structure</h2>
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
                <tr><td>Atoms drawn</td><td data-testid="counts">{scene.spheres.length}{counts && ` (${counts})`}</td></tr>
              </tbody>
            </table>
            {scene.warnings.map((w) => (
              <p key={w} className="warning">{w}</p>
            ))}

            <h2>Shown</h2>
            <p className="sub">Range along each cell axis, in units of the cell edge. A narrow range is a slab.</p>
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

            <h2>Atoms</h2>
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

            <h2>Bonds</h2>
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

            {largestMoment(structure) > 0 && (
              <>
                <h2>Magnetic moments</h2>
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
                <p className="sub">Length of the arrow of the largest moment; the others are in proportion.</p>
              </>
            )}

            <h2>Legend and axes</h2>
            <label className="row">
              <input type="checkbox" data-testid="show-legend" checked={showLegend} onChange={(e) => setShowLegend(e.target.checked)} />
              Legend
            </label>
            <label className="row">
              <input type="checkbox" data-testid="show-axes" checked={showAxes} onChange={(e) => setShowAxes(e.target.checked)} />
              Axes a, b, c
            </label>

            <h2>View</h2>
            <p className="sub">Drag the figure to rotate, or set the direction:</p>
            <div className="row">
              up
              <select
                data-testid="view-up"
                value={upAxis}
                onChange={(e) => {
                  const up = Number(e.target.value) as 0 | 1 | 2;
                  setUpAxis(up);
                  applyView(up, azText, elText);
                }}
              >
                <option value={0}>a</option>
                <option value={1}>b</option>
                <option value={2}>c</option>
              </select>
              turn
              <input type="number" step={5} data-testid="view-az" value={azText} onChange={(e) => { setAzText(e.target.value); applyView(upAxis, e.target.value, elText); }} />
              °
            </div>
            <div className="row">
              tilt
              <input type="number" step={5} data-testid="view-el" value={elText} onChange={(e) => { setElText(e.target.value); applyView(upAxis, azText, e.target.value); }} />
              ° (from above when positive)
            </div>
            <div className="row">
              <button
                onClick={() => {
                  setUpAxis(2);
                  setAzText("18");
                  setElText("12");
                  setView(DEFAULT_VIEW);
                }}
              >
                Reset view
              </button>
            </div>

            <h2>Export</h2>
            <label className="row">
              <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
              Transparent background
            </label>
            <div className="row">
              <button data-testid="export-svg" onClick={() => download(new Blob([svg], { type: "image/svg+xml" }), `${baseName}.svg`)}>
                Save SVG
              </button>
            </div>
            <div className="row">
              <button
                data-testid="export-png"
                onClick={() => {
                  svgToPng(svg, pngWidth).then(
                    (blob) => download(blob, `${baseName}.png`),
                    (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
                  );
                }}
              >
                Save PNG
              </button>
              <input type="number" min={100} step={10} value={pngWidth} onChange={(e) => setPngWidth(Number(e.target.value))} />
              px wide ({(pngWidth / DEFAULT_CANVAS.width).toFixed(2)}×)
            </div>
          </>
        )}
      </div>
    </div>
  );
}
