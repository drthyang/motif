// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { useRef, useState, type PointerEvent } from "react";

/**
 * The distribution of one kind of bond angle among the drawn bonds: a bar for each size found,
 * as high as the number of angles of that size. Point at a bar to see those angles marked in the
 * figure; click a bar, or drag across several, to keep them marked. The marked range is shaded.
 */
export function AnglePlot(props: {
  sizes: readonly number[];
  counts: readonly number[];
  min: number;
  max: number;
  colour: string;
  /** Called with the range to mark (degrees). */
  onRange: (min: number, max: number) => void;
  /** Called with a range while the pointer rests on a bar, and with null when it leaves. */
  onHover: (range: [number, number] | null) => void;
}) {
  const { sizes, counts, min, max, colour } = props;
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (sizes.length === 0) return null;

  // The axis: a little beyond the sizes found, at least 30 degrees wide, within 0 to 180.
  const [W, H, left, right, top, bottom] = [300, 96, 8, 8, 14, 20];
  let lo = Math.floor(sizes[0]! - 6);
  let hi = Math.ceil(sizes[sizes.length - 1]! + 6);
  if (hi - lo < 30) {
    const mid = (lo + hi) / 2;
    [lo, hi] = [Math.floor(mid - 15), Math.ceil(mid + 15)];
  }
  if (lo < 0) [lo, hi] = [0, Math.min(180, hi - lo)];
  if (hi > 180) [lo, hi] = [Math.max(0, lo - (hi - 180)), 180];
  const x = (degrees: number): number => left + ((degrees - lo) / (hi - lo)) * (W - left - right);
  const degreesAt = (clientX: number): number => {
    const box = ref.current!.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    return Math.max(lo, Math.min(hi, lo + ((px - left) / (W - left - right)) * (hi - lo)));
  };
  const tallest = Math.max(...counts);
  const barWidth = Math.max(3, ((W - left - right) / (hi - lo)) * 0.6);
  // The bar under a position, if the pointer is within reach of one.
  const barAt = (degrees: number): number | null => {
    const reach = (barWidth / 2 + 3) * ((hi - lo) / (W - left - right));
    let best: number | null = null;
    sizes.forEach((s, i) => {
      if (Math.abs(s - degrees) <= reach && (best === null || Math.abs(s - degrees) < Math.abs(sizes[best]! - degrees))) best = i;
    });
    return best;
  };
  const around = (i: number): [number, number] => [Math.round((sizes[i]! - 0.5) * 10) / 10, Math.round((sizes[i]! + 0.5) * 10) / 10];

  const onDown = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = degreesAt(e.clientX);
    setDrag({ from: d, to: d });
  };
  const onMove = (e: PointerEvent) => {
    const d = degreesAt(e.clientX);
    if (drag) {
      setDrag({ from: drag.from, to: d });
      return;
    }
    const bar = barAt(d);
    if (bar !== hover) {
      setHover(bar);
      props.onHover(bar === null ? null : around(bar));
    }
  };
  const onUp = () => {
    if (!drag) return;
    const [a, b] = [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)];
    setDrag(null);
    if (b - a < (hi - lo) * 0.015) {
      // A click: the bar under it, or nothing.
      const bar = barAt((a + b) / 2);
      if (bar !== null) props.onRange(...around(bar));
    } else {
      props.onRange(Math.floor(a * 10) / 10, Math.ceil(b * 10) / 10);
    }
  };
  const onLeave = () => {
    if (hover !== null) {
      setHover(null);
      props.onHover(null);
    }
  };

  const shade = drag ? [Math.min(drag.from, drag.to), Math.max(drag.from, drag.to)] : [Math.max(lo, min), Math.min(hi, max)];
  const labels = axisLabels(lo, hi, sizes.length <= 4 ? sizes : hover !== null ? [sizes[hover]!] : [], x, W - right);
  return (
    <svg
      ref={ref}
      className="angle-plot"
      data-testid="angle-plot"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Distribution of this angle. Click a bar or drag across several to mark those angles."
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onLeave}
    >
      <rect x={x(shade[0]!)} y={top - 6} width={Math.max(0, x(shade[1]!) - x(shade[0]!))} height={H - top - bottom + 6} fill={colour} opacity={0.18} />
      <line x1={left} y1={H - bottom} x2={W - right} y2={H - bottom} stroke="#b9b0a0" />
      {sizes.map((s, i) => {
        const h = (counts[i]! / tallest) * (H - top - bottom - 4);
        const marked = s >= min - 1e-9 && s <= max + 1e-9;
        return (
          <rect key={s} data-size={s} x={x(s) - barWidth / 2} y={H - bottom - h} width={barWidth} height={h} rx={1.5} fill={marked ? colour : "#b9b0a0"} opacity={hover === i ? 1 : 0.85} />
        );
      })}
      {labels.map((l) => (
        <text key={`${l.text}-${l.x}`} x={l.x} y={H - 6} textAnchor={l.anchor} fontSize={LABEL_SIZE} fill="#5f594f">
          {l.text}
        </text>
      ))}
      {hover !== null && (
        <text x={Math.min(W - 40, Math.max(40, x(sizes[hover]!)))} y={10} textAnchor="middle" fontSize={10} fontWeight={600} fill="#191714">
          {sizes[hover]!.toFixed(1)}° × {counts[hover]}
        </text>
      )}
    </svg>
  );
}

/** Size of the axis labels, in the plot's units. */
const LABEL_SIZE = 9.5;
/** Estimated width of a label: about 0.58 of the font size per character, plus a small gap to the next. */
const labelWidth = (text: string): number => text.length * LABEL_SIZE * 0.58 + 4;
const degreesText = (d: number): string => `${Number.isInteger(d) ? d : d.toFixed(1)}`;

export interface AxisLabel {
  readonly x: number;
  readonly text: string;
  readonly anchor: "start" | "middle" | "end";
}

/**
 * The labels under the angle axis, none overlapping. The values of the bars are grouped where their labels would
 * collide, and a group of several is labelled by its range ("108.2–109.4°") at its middle. The two ends of the
 * axis are labelled when there is room beside the bars' labels; the bars' labels come first.
 */
export function axisLabels(lo: number, hi: number, values: readonly number[], x: (d: number) => number, rightEdge: number): AxisLabel[] {
  const sorted = [...values].sort((a, b) => a - b);
  // Group values whose single labels would overlap: a value joins the group before it when its label's left
  // edge would fall inside the previous label.
  const groups: number[][] = [];
  for (const v of sorted) {
    const last = groups[groups.length - 1];
    if (last) {
      const prev = last[last.length - 1]!;
      const gap = x(v) - x(prev);
      if (gap < (labelWidth(`${degreesText(prev)}°`) + labelWidth(`${degreesText(v)}°`)) / 2) {
        last.push(v);
        continue;
      }
    }
    groups.push([v]);
  }
  const left = x(lo);
  let middle: AxisLabel[] = groups.map((g) => {
    const text = g.length === 1 ? `${degreesText(g[0]!)}°` : `${degreesText(g[0]!)}–${degreesText(g[g.length - 1]!)}°`;
    const centre = (x(g[0]!) + x(g[g.length - 1]!)) / 2;
    const half = labelWidth(text) / 2;
    // Kept inside the axis.
    return { x: Math.max(left + half, Math.min(rightEdge - half, centre)), text, anchor: "middle" as const };
  });
  // Groups that still collide after merging (very crowded axes) are merged again into one range.
  for (let k = 1; k < middle.length; k++) {
    const [a, b] = [middle[k - 1]!, middle[k]!];
    if (b.x - labelWidth(b.text) / 2 < a.x + labelWidth(a.text) / 2) {
      const range = `${degreesText(sorted[0]!)}–${degreesText(sorted[sorted.length - 1]!)}°`;
      middle = [{ x: Math.max(left + labelWidth(range) / 2, Math.min(rightEdge - labelWidth(range) / 2, (x(sorted[0]!) + x(sorted[sorted.length - 1]!)) / 2)), text: range, anchor: "middle" }];
      break;
    }
  }
  const out: AxisLabel[] = [];
  const startText = `${degreesText(lo)}°`;
  const endText = `${degreesText(hi)}°`;
  const firstLeft = middle.length ? middle[0]!.x - labelWidth(middle[0]!.text) / 2 : Infinity;
  const lastRight = middle.length ? middle[middle.length - 1]!.x + labelWidth(middle[middle.length - 1]!.text) / 2 : -Infinity;
  if (left + labelWidth(startText) <= firstLeft) out.push({ x: left, text: startText, anchor: "start" });
  out.push(...middle);
  if (rightEdge - labelWidth(endText) >= lastRight) out.push({ x: rightEdge, text: endText, anchor: "end" });
  return out;
}
