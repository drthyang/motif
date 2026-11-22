import { useCallback, useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { svgToPng } from "../render/png";
import { DEFAULT_CANVAS, renderSvg } from "../render/svg";
import { DEFAULT_VIEW, dragView, type View } from "../render/view";
import { buildScene, type Scene } from "../scene/scene";
import { pairDistances, type BondRule } from "../scene/bonds";
import type { BoundaryRule, Range } from "../scene/select";
import { readCif } from "../structure/readCif";
import type { Structure } from "../structure/types";

// Published structures shipped with the page (see examples/README.md).
const EXAMPLES = Object.entries(
  import.meta.glob<string>("../../examples/*.cif", { query: "?raw", import: "default", eager: true }),
).map(([path, text]) => ({ name: path.split("/").pop()!.replace(/\.cif$/, ""), text }));

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
  const [bondRules, setBondRules] = useState<(BondRule & { maxText: string })[]>([]);
  const [showCell, setShowCell] = useState(true);
  const [newPair, setNewPair] = useState("");
  const last = useRef<{ x: number; y: number } | null>(null);

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
    } catch (e) {
      setError(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  // The scene for the chosen range; while the range is unusable the last good scene stays on screen.
  const lastScene = useRef<Scene | null>(null);
  const { scene, rangeError } = useMemo((): { scene: Scene | null; rangeError: string } => {
    if (!structure) return { scene: null, rangeError: "" };
    const range = rangeFromText(rangeText, repeatBoundary ? "both" : "once");
    if (!range) return { scene: lastScene.current, rangeError: "Fill in all six limits." };
    try {
      // A rule whose distance box holds no usable number is left out until it does.
      const bonds = bondRules.filter((r) => r.max > 0.1 && r.max <= 10);
      return { scene: buildScene(structure, { range, bonds, showCell }), rangeError: "" };
    } catch (e) {
      return { scene: lastScene.current, rangeError: e instanceof Error ? e.message : String(e) };
    }
  }, [structure, rangeText, repeatBoundary, bondRules, showCell]);
  // Every pair of elements in the file, with the distances between them (a guide for the bond length).
  const pairs = useMemo(() => {
    if (!structure) return [];
    const elements = [...new Set(structure.sites.map((s) => s.element))];
    const out: { key: string; centre: string; neighbour: string; distances: number[] }[] = [];
    elements.forEach((centre, i) => {
      for (const neighbour of elements.slice(i)) {
        const distances = pairDistances(structure, centre, neighbour);
        if (distances.length) out.push({ key: `${centre}-${neighbour}`, centre, neighbour, distances });
      }
    });
    return out.sort((p, q) => p.distances[0]! - q.distances[0]!);
  }, [structure]);
  const addBond = () => {
    const pair = pairs.find((p) => p.key === newPair);
    if (!pair) return;
    // Suggested longest distance: 10 % above the shortest distance of this pair.
    const max = Math.ceil(pair.distances[0]! * 1.1 * 100) / 100;
    setBondRules((r) => [...r, { centre: pair.centre, neighbour: pair.neighbour, max, maxText: String(max), complete: false }]);
    setNewPair("");
  };
  const bondCount = (index: number): number => {
    const used = bondRules.map((r, i) => (r.max > 0.1 && r.max <= 10 ? i : -1)).filter((i) => i >= 0);
    return scene?.sticks.filter((s) => used[s.rule] === index).length ?? 0;
  };
  lastScene.current = scene;
  const counts = useMemo(() => {
    const n = new Map<string, number>();
    for (const s of scene?.spheres ?? []) n.set(s.style, (n.get(s.style) ?? 0) + 1);
    return [...n].map(([element, k]) => `${element} ${k}`).join(", ");
  }, [scene]);
  const svg = useMemo(
    () => (scene ? renderSvg(scene, view, { ...DEFAULT_CANVAS, background: transparent ? null : "#ffffff" }) : ""),
    [scene, view, transparent],
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
              if (example) load(example.text, `${example.name}.cif`);
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
                <tr><td>Space group</td><td>{structure.spaceGroupName ?? "not named"}</td></tr>
                <tr><td>a, b, c (Å)</td><td>{cell.a}, {cell.b}, {cell.c}</td></tr>
                <tr><td>α, β, γ (°)</td><td>{cell.alpha}, {cell.beta}, {cell.gamma}</td></tr>
                <tr><td>Symmetry operations</td><td>{structure.operations.length}</td></tr>
                <tr><td>Sites in the file</td><td>{structure.sites.length}</td></tr>
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

            <h2>Bonds</h2>
            {bondRules.map((r, index) => (
              <div key={index} className="rule" data-testid={`bond-${index}`}>
                <div className="row">
                  <b>{r.centre}–{r.neighbour}</b> up to
                  <input
                    type="number"
                    step={0.05}
                    min={0.2}
                    max={10}
                    value={r.maxText}
                    onChange={(e) => setBondRules((all) => all.map((x, i) => (i === index ? { ...x, maxText: e.target.value, max: Number(e.target.value) } : x)))}
                  />
                  Å
                  <button title="Remove this bond" onClick={() => setBondRules((all) => all.filter((_, i) => i !== index))}>×</button>
                </div>
                <label className="row">
                  <input
                    type="checkbox"
                    checked={r.complete}
                    onChange={(e) => setBondRules((all) => all.map((x, i) => (i === index ? { ...x, complete: e.target.checked } : x)))}
                  />
                  Add {r.neighbour} outside the range bonded to {r.centre} inside
                </label>
                <p className="sub" data-testid={`bond-count-${index}`}>
                  {r.max > 0.1 && r.max <= 10 ? `${bondCount(index)} bonds drawn` : "Give a distance between 0.1 and 10 Å."}
                </p>
              </div>
            ))}
            <div className="row">
              <select data-testid="new-pair" value={newPair} onChange={(e) => setNewPair(e.target.value)}>
                <option value="">Add a bond between…</option>
                {pairs.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.centre}–{p.neighbour} (distances {p.distances.slice(0, 3).map((d) => d.toFixed(2)).join(", ")} Å…)
                  </option>
                ))}
              </select>
              <button data-testid="add-bond" disabled={!newPair} onClick={addBond}>Add</button>
            </div>
            <label className="row">
              <input type="checkbox" data-testid="show-cell" checked={showCell} onChange={(e) => setShowCell(e.target.checked)} />
              Unit cell outline
            </label>

            <h2>View</h2>
            <p className="sub">Drag the figure to rotate.</p>
            <div className="row">
              <button onClick={() => setView(DEFAULT_VIEW)}>Reset view</button>
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
