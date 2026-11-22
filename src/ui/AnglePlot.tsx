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
  const ticks = [lo, ...sizes.filter((_, i) => sizes.length <= 4 || i === hover), hi];
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
      {ticks.map((t, i) => (
        <text key={`${t}-${i}`} x={x(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"} fontSize={9.5} fill="#5f594f">
          {Number.isInteger(t) ? t : t.toFixed(1)}°
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
