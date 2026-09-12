"use client";

import { useEffect, useRef, useState } from "react";
import { THEMES, type ThemeId } from "@/lib/theme";
import { EDITOR_FONT_SIZES } from "@/lib/settings";
import { useSettings } from "@/components/SettingsProvider";

export default function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { settings, patch } = useSettings();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const theme = settings.theme;

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

  function pickTheme(id: ThemeId) {
    patch({ theme: id });
  }

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const sizeIndex = EDITOR_FONT_SIZES.indexOf(settings.editorFontSize);

  return (
    <div className={`theme-picker ${compact ? "compact" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="btn small theme-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Appearance and writing settings"
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
        <div className="theme-menu" role="dialog" aria-label="App settings">
          <div className="theme-menu-label">Light</div>
          <div className="theme-grid">
            {THEMES.filter((t) => t.mode === "light").map((t) => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={t.id === theme}
                className={`theme-option ${t.id === theme ? "active" : ""}`}
                onClick={() => pickTheme(t.id)}
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
                onClick={() => pickTheme(t.id)}
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

          <div className="theme-menu-label">Manuscript</div>
          <div className="settings-row">
            <span>Type</span>
            <div className="settings-seg">
              <button
                type="button"
                className={settings.editorFont === "serif" ? "active" : ""}
                onClick={() => patch({ editorFont: "serif" })}
              >
                Serif
              </button>
              <button
                type="button"
                className={settings.editorFont === "sans" ? "active" : ""}
                onClick={() => patch({ editorFont: "sans" })}
              >
                Sans
              </button>
            </div>
          </div>
          <div className="settings-row">
            <span>Size</span>
            <div className="settings-seg">
              <button
                type="button"
                aria-label="Smaller type"
                disabled={sizeIndex <= 0}
                onClick={() =>
                  patch({ editorFontSize: EDITOR_FONT_SIZES[Math.max(0, sizeIndex - 1)] })
                }
              >
                A-
              </button>
              <span className="settings-size">{settings.editorFontSize}</span>
              <button
                type="button"
                aria-label="Larger type"
                disabled={sizeIndex >= EDITOR_FONT_SIZES.length - 1}
                onClick={() =>
                  patch({
                    editorFontSize:
                      EDITOR_FONT_SIZES[Math.min(EDITOR_FONT_SIZES.length - 1, sizeIndex + 1)],
                  })
                }
              >
                A+
              </button>
            </div>
          </div>
          <div className="settings-row">
            <span>Autocorrect</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.autoCorrect}
              className={`settings-switch ${settings.autoCorrect ? "on" : ""}`}
              onClick={() => patch({ autoCorrect: !settings.autoCorrect })}
            >
              {settings.autoCorrect ? "On" : "Off"}
            </button>
          </div>
          <div className="settings-row">
            <span>Reduce motion</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.reduceMotion}
              className={`settings-switch ${settings.reduceMotion ? "on" : ""}`}
              onClick={() => patch({ reduceMotion: !settings.reduceMotion })}
            >
              {settings.reduceMotion ? "On" : "Off"}
            </button>
          </div>

          <div className="theme-menu-label">Daily words</div>
          <p className="settings-hint">Five minutes is a session. There is no streak to protect.</p>
          <div className="settings-row">
            <span>Show meter</span>
            <button
              type="button"
              role="switch"
              aria-checked={settings.showDailyGoal}
              className={`settings-switch ${settings.showDailyGoal ? "on" : ""}`}
              onClick={() => patch({ showDailyGoal: !settings.showDailyGoal })}
            >
              {settings.showDailyGoal ? "On" : "Off"}
            </button>
          </div>
          {settings.showDailyGoal ? (
            <div className="settings-row">
              <span>Goal</span>
              <div className="settings-seg">
                {([100, 250, 500] as const).map((goal) => (
                  <button
                    key={goal}
                    type="button"
                    className={settings.dailyWordGoal === goal ? "active" : ""}
                    onClick={() => patch({ dailyWordGoal: goal })}
                  >
                    {goal}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
