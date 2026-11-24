// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

import { rulerTicks, type RulerUnit } from "./ruler";

/** Thickness of the rulers on screen, px: the top one, and the one on the left. */
export const RULER_TOP = 20;
export const RULER_LEFT = 26;

/**
 * Rulers along the top and the left of the figure on the page, measuring the figure itself (cm or in on paper,
 * else px of the figure). `box` is where the drawing sits in its frame, in screen px. Never part of a saved figure.
 */
export function Rulers({ box, width, height, unit }: { box: { left: number; top: number; width: number; height: number }; width: number; height: number; unit: RulerUnit }) {
  if (box.width < 10 || box.height < 10) return null;
  const top = rulerTicks(width, unit, box.width / width);
  const side = rulerTicks(height, unit, box.height / height);
  const len = (major: boolean) => (major ? 9 : 4);
  return (
    <>
      <div className="ruler-corner" style={{ top: -RULER_TOP, left: -RULER_LEFT, width: RULER_LEFT, height: RULER_TOP }} aria-hidden>
        {unit}
      </div>
      <svg className="ruler" data-testid="ruler-top" style={{ top: -RULER_TOP, left: box.left, width: box.width, height: RULER_TOP }} aria-hidden>
        {top.map((t, i) => {
          const x = Math.min(box.width - 0.5, Math.max(0.5, (t.at / width) * box.width));
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={RULER_TOP} y2={RULER_TOP - len(t.major)} />
              {t.label !== undefined && x < box.width - 12 && (
                <text x={x + 2.5} y={RULER_TOP - 9}>
                  {t.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <svg className="ruler" data-testid="ruler-left" style={{ left: -RULER_LEFT, top: box.top, width: RULER_LEFT, height: box.height }} aria-hidden>
        {side.map((t, i) => {
          const y = Math.min(box.height - 0.5, Math.max(0.5, (t.at / height) * box.height));
          return (
            <g key={i}>
              <line y1={y} y2={y} x1={RULER_LEFT} x2={RULER_LEFT - len(t.major)} />
              {t.label !== undefined && y < box.height - 10 && (
                <text x={RULER_LEFT - 11} y={y + 2.5} textAnchor="end" dominantBaseline="hanging">
                  {t.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </>
  );
}
