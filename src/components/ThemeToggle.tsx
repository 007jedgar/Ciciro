"use client";

import { useSettings } from "@/components/SettingsProvider";
import { DEFAULT_DARK, DEFAULT_LIGHT, THEMES } from "@/lib/theme";

/**
 * Day or night, one click, for the public pages. It sets the same theme the
 * Settings picker does (so a signed-in writer's choice syncs like any other),
 * and a first visit follows the OS until it is clicked. Which icon shows is
 * CSS on the root's data-mode, set before paint, so it never flashes the wrong
 * one while the page hydrates.
 */
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { settings, patch } = useSettings();
  const night = THEMES.find((t) => t.id === settings.theme)?.mode === "dark";
  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      aria-label="Night mode"
      aria-pressed={night}
      title={night ? "Switch to day" : "Switch to night"}
      onClick={() => patch({ theme: night ? DEFAULT_LIGHT : DEFAULT_DARK })}
    >
      <svg className="theme-toggle-moon" viewBox="0 0 24 24" aria-hidden>
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      </svg>
      <svg className="theme-toggle-sun" viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
      </svg>
    </button>
  );
}
