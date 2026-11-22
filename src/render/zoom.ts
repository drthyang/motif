// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * Zoom and pan on top of the fitted placement. Zoom 1 with no pan is the fitted figure.
 * All lengths are px of the canvas (the SVG's own coordinates), not of the screen.
 */
import type { Fit } from "./svg";

export interface Zoom {
  /** Magnification relative to the fitted figure: 1 = fitted. */
  readonly factor: number;
  /** Shift of the structure, px: positive x to the right, positive y down. */
  readonly x: number;
  readonly y: number;
}

export const NO_ZOOM: Zoom = { factor: 1, x: 0, y: 0 };
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 30;

export const isZoomed = (zoom: Zoom): boolean => zoom.factor !== 1 || zoom.x !== 0 || zoom.y !== 0;

/** A point of the canvas, px. */
export type Point = readonly [number, number];

/**
 * The placement of the structure with a zoom applied to the fitted placement `base`.
 * `centre` is the middle of the space the structure is fitted into: zooming without a pan
 * keeps that point where it is.
 */
export function zoomedFit(base: Fit, zoom: Zoom, centre: Point): Fit {
  if (!isZoomed(zoom)) return base;
  return {
    scale: base.scale * zoom.factor,
    x: centre[0] + (base.x - centre[0]) * zoom.factor + zoom.x,
    y: centre[1] + (base.y - centre[1]) * zoom.factor + zoom.y,
    clip: true,
  };
}

/** Zoom by `by` (above 1 = closer) keeping the canvas point `about` where it is on the canvas. */
export function zoomAbout(zoom: Zoom, by: number, about: Point, centre: Point): Zoom {
  const factor = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom.factor * by));
  const k = factor / zoom.factor;
  // A point q of the fitted figure is drawn at centre + (q - centre) * factor + pan. Solving for the pan
  // that leaves the drawn point `about` unchanged:
  return { factor, x: about[0] - centre[0] - (about[0] - centre[0] - zoom.x) * k, y: about[1] - centre[1] - (about[1] - centre[1] - zoom.y) * k };
}

/** Move the structure by (dx, dy) px. */
export function panBy(zoom: Zoom, dx: number, dy: number): Zoom {
  return { factor: zoom.factor, x: zoom.x + dx, y: zoom.y + dy };
}

/**
 * Zoom so that the rectangle dragged on the canvas (two opposite corners) fills the space of
 * `width` x `height` px centred on `centre`, as far as its shape allows.
 */
export function zoomToBox(zoom: Zoom, from: Point, to: Point, centre: Point, width: number, height: number): Zoom {
  const [w, h] = [Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])];
  if (w < 4 || h < 4) return zoom; // too small to be meant
  const middle: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const zoomed = zoomAbout(zoom, Math.min(width / w, height / h), middle, centre);
  // zoomAbout kept the middle of the box in place; now bring it to the centre. (If the zoom limit cut the
  // magnification short, the box is still centred.)
  return panBy(zoomed, centre[0] - middle[0], centre[1] - middle[1]);
}
