// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-Han Yang

/**
 * The page colour, as a small dot at the left of the header's buttons. A click opens a row of the six colours;
 * choosing one applies it and closes the row, as does a click elsewhere or Escape. Only the page changes: figures
 * never do. The choice is kept in this browser (theme.ts). The row is placed against the window, under the dot, so the
 * header's buttons scrolling sideways on a phone do not cut it off.
 */
import { useEffect, useRef, useState } from "react";
import { applyTheme, readTheme, THEMES } from "./theme";

export function ThemeCue() {
  const [theme, setTheme] = useState(readTheme);
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0]!;

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(null);
    };
    const key = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className="theme-cue" ref={box}>
      <button
        type="button"
        className="theme-dot"
        data-testid="theme-cue"
        aria-label={`Page colour: ${current.name}`}
        aria-expanded={open !== null}
        title={`Page colour: ${current.name}. Only the page changes, never the figure.`}
        style={{ background: current.accent }}
        onClick={(e) => {
          if (open) return setOpen(null);
          const r = e.currentTarget.getBoundingClientRect();
          // Six 20 px dots 8 px apart in 8 px of padding: 176 px wide; kept 8 px inside the window.
          setOpen({ top: r.bottom + 8, left: Math.max(8, Math.min(r.left - 8, window.innerWidth - 184)) });
        }}
      />
      {open && (
        <div className="theme-row" role="radiogroup" aria-label="Page colour" style={open}>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={theme === t.id}
              aria-label={t.name}
              title={t.name}
              data-testid={`theme-${t.id}`}
              className={theme === t.id ? "theme-dot on" : "theme-dot"}
              style={{ background: t.accent }}
              onClick={() => {
                applyTheme(t.id);
                setTheme(t.id);
                setOpen(null);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
