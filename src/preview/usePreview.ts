// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Scene } from "../scene/scene";
import { buildPreviewData, type PreviewFrame } from "./data";

/** From this many drawn atoms and bonds on, a structure counts as large: its movement is shown by the GPU preview. */
export const PREVIEW_FROM = 1200;

export interface Preview {
  /** The canvas laid over the figure. A new canvas gets a new worker at the next load. */
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  /** The scene the worker holds now; a frame can be drawn only for this scene. */
  readonly loaded: Scene | null;
  /** Number of the last frame the worker has drawn. */
  readonly drawn: number;
  /** Why there is no preview on this browser, if so. */
  readonly failed: string;
  /** Give the worker a scene. */
  readonly load: (scene: Scene) => void;
  /** Ask for a frame; returns its number. */
  readonly draw: (frame: PreviewFrame, pixelWidth: number, pixelHeight: number) => number;
}

/**
 * The GPU preview's worker and canvas. The worker is started the first time a scene is loaded and
 * lives as long as its canvas: when the canvas is replaced (a structure closed, another opened), the
 * next scene starts a new worker on the new canvas. If the browser cannot do it (no OffscreenCanvas or no WebGL 2 in a
 * worker), `failed` says so and the page simply keeps redrawing the SVG.
 */
export function usePreview(): Preview {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worker = useRef<Worker | null>(null);
  /** The canvas the current worker draws into. */
  const given = useRef<HTMLCanvasElement | null>(null);
  const ready = useRef(false);
  const waiting = useRef<Scene | null>(null);
  const frameId = useRef(0);
  // One frame is with the worker at a time. A frame asked for meanwhile waits, and a newer one replaces it:
  // the worker always draws the latest view and never works through a queue of stale ones.
  const busy = useRef(false);
  const next = useRef<{ frame: PreviewFrame; pixelWidth: number; pixelHeight: number; id: number } | null>(null);
  const [loaded, setLoaded] = useState<Scene | null>(null);
  const [drawn, setDrawn] = useState(0);
  const [failed, setFailed] = useState("");

  const send = useCallback((scene: Scene) => {
    const data = buildPreviewData(scene);
    worker.current!.postMessage({ type: "scene", spheres: data.spheres, lines: data.lines, centre: data.centre, reach: data.reach }, [data.spheres.buffer, data.lines.buffer]);
    setLoaded(scene);
  }, []);

  const load = useCallback(
    (scene: Scene) => {
      if (failed) return;
      // The canvas is taken off the page when the structure is closed, and a new one is put there when the next
      // opens. A worker draws only into the canvas it was given, so for a new canvas a new worker is started;
      // otherwise the preview would draw into the old, unseen one and the structure would vanish while moving.
      if (worker.current && given.current !== canvasRef.current) {
        worker.current.terminate();
        worker.current = null;
        ready.current = false;
        busy.current = false;
        next.current = null;
        waiting.current = null;
      }
      if (!worker.current) {
        const canvas = canvasRef.current;
        if (!canvas || typeof canvas.transferControlToOffscreen !== "function" || typeof Worker === "undefined") {
          setFailed("This browser cannot draw in a worker.");
          return;
        }
        try {
          const offscreen = canvas.transferControlToOffscreen();
          given.current = canvas;
          const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
          w.onmessage = (event: MessageEvent<{ type: string; id?: number; message?: string }>) => {
            if (event.data.type === "ready") {
              ready.current = true;
              if (waiting.current) send(waiting.current);
              waiting.current = null;
            } else if (event.data.type === "drawn") {
              setDrawn(event.data.id ?? 0);
              busy.current = false;
              if (next.current) {
                busy.current = true;
                w.postMessage({ type: "frame", ...next.current });
                next.current = null;
              }
            }
            else if (event.data.type === "error") setFailed(event.data.message ?? "The preview failed.");
          };
          w.onerror = () => setFailed("The preview worker could not start.");
          w.postMessage({ type: "init", canvas: offscreen }, [offscreen]);
          worker.current = w;
        } catch (error) {
          setFailed(error instanceof Error ? error.message : String(error));
          return;
        }
      }
      if (ready.current) send(scene);
      else waiting.current = scene;
    },
    [failed, send],
  );

  const draw = useCallback((frame: PreviewFrame, pixelWidth: number, pixelHeight: number): number => {
    frameId.current += 1;
    const message = { frame, pixelWidth, pixelHeight, id: frameId.current };
    if (busy.current) next.current = message;
    else if (worker.current) {
      busy.current = true;
      worker.current.postMessage({ type: "frame", ...message });
    }
    return frameId.current;
  }, []);

  // Nothing to clean up: the worker serves its canvas until the page is closed or the canvas is replaced.
  useEffect(() => undefined, []);
  return { canvasRef, loaded, drawn, failed, load, draw };
}
