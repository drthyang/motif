import { useCallback, useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { svgToPng } from "../render/png";
import { DEFAULT_CANVAS, renderSvg } from "../render/svg";
import { DEFAULT_VIEW, dragView, type View } from "../render/view";
import { buildScene } from "../scene/scene";
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

export function App() {
  const [structure, setStructure] = useState<Structure | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [transparent, setTransparent] = useState(true);
  const [pngWidth, setPngWidth] = useState(2880);
  const [over, setOver] = useState(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const load = useCallback((text: string, name: string) => {
    try {
      const read = readCif(text);
      buildScene(read); // fail here, with a message, rather than while drawing
      setStructure(read);
      setFileName(name);
      setError("");
      setView(DEFAULT_VIEW);
    } catch (e) {
      setError(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const scene = useMemo(() => (structure ? buildScene(structure) : null), [structure]);
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
                <tr><td>Atoms drawn</td><td>{scene.spheres.length} (one unit cell)</td></tr>
              </tbody>
            </table>
            {scene.warnings.map((w) => (
              <p key={w} className="warning">{w}</p>
            ))}

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
