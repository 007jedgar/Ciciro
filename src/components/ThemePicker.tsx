"use client";

import { useEffect, useRef, useState } from "react";
import {
  THEMES,
  applyTheme,
  getStoredTheme,
  resolveTheme,
  setStoredTheme,
  type ThemeId,
} from "@/lib/theme";

export default function ThemePicker({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>("parchment");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = resolveTheme(getStoredTheme());
    setTheme(id);
    applyTheme(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(id: ThemeId) {
    setTheme(id);
    setStoredTheme(id);
    setOpen(false);
  }

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div className={`theme-picker ${compact ? "compact" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="btn small theme-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Choose theme"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="theme-swatch"
          style={{
            background: `linear-gradient(135deg, ${current.swatch[0]} 55%, ${current.swatch[1]} 55%)`,
          }}
        />
        {!compact && <span>{current.label}</span>}
      </button>
      {open && (
        <div className="theme-menu" role="listbox" aria-label="Themes">
          <div className="theme-menu-label">Light</div>
          <div className="theme-grid">
            {THEMES.filter((t) => t.mode === "light").map((t) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={t.id === theme}
                className={`theme-option ${t.id === theme ? "active" : ""}`}
                onClick={() => pick(t.id)}
              >
                <span
                  className="theme-swatch lg"
                  style={{
                    background: `linear-gradient(135deg, ${t.swatch[0]} 55%, ${t.swatch[1]} 55%)`,
                  }}
                />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="theme-menu-label">Dark</div>
          <div className="theme-grid">
            {THEMES.filter((t) => t.mode === "dark").map((t) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={t.id === theme}
                className={`theme-option ${t.id === theme ? "active" : ""}`}
                onClick={() => pick(t.id)}
              >
                <span
                  className="theme-swatch lg"
                  style={{
                    background: `linear-gradient(135deg, ${t.swatch[0]} 55%, ${t.swatch[1]} 55%)`,
                  }}
                />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
