// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_EPOCH } from "@/lib/settings";
import { THEMES } from "@/lib/theme";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";

function boot({ settings, osDark = false }: { settings?: Record<string, unknown>; osDark?: boolean }) {
  if (settings) localStorage.setItem("ciciro-settings", JSON.stringify(settings));
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: osDark && query.includes("dark") }));
  new Function(THEME_BOOT_SCRIPT)();
  const root = document.documentElement;
  return { theme: root.getAttribute("data-theme"), mode: root.getAttribute("data-mode") };
}

const SAVED = "2026-09-01T00:00:00.000Z";

describe("the web's pre-paint theme script", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-mode");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("paints a phone-only theme as the web's default of its mode, whatever the OS prefers", () => {
    expect(boot({ settings: { theme: "ciciro-night", updatedAt: SAVED } })).toEqual({ theme: "ember", mode: "dark" });
    expect(boot({ settings: { theme: "ciciro", updatedAt: SAVED }, osDark: true })).toEqual({
      theme: "parchment",
      mode: "light",
    });
  });

  it("keeps a web theme as stored, and follows the OS for settings nobody chose", () => {
    expect(boot({ settings: { theme: "walnut", updatedAt: SAVED } })).toEqual({ theme: "walnut", mode: "dark" });
    expect(boot({ settings: { theme: "ciciro-night", updatedAt: SETTINGS_EPOCH } })).toEqual({
      theme: "parchment",
      mode: "light",
    });
    expect(boot({ settings: { theme: "neon", updatedAt: SAVED }, osDark: true })).toEqual({ theme: "ember", mode: "dark" });
  });

  it("boots every theme the picker offers as itself, in that theme's mode", () => {
    for (const { id, mode } of THEMES) {
      expect(boot({ settings: { theme: id, updatedAt: SAVED }, osDark: mode === "light" })).toEqual({ theme: id, mode });
    }
  });
});
