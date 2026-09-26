import { defaultSettings, normalizeSettings, settingsEqual } from "../lib/app-settings";

const mockDisk = new Map<string, string>();
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({
    getString: (key: string) => mockDisk.get(key),
    set: (key: string, value: string) => {
      mockDisk.set(key, value);
    },
  }),
}));

function loadFocusMode(): typeof import("../lib/focus-mode") {
  let mod!: typeof import("../lib/focus-mode");
  jest.isolateModules(() => {
    mod = require("../lib/focus-mode");
  });
  return mod;
}

describe("synced settings", () => {
  it("carry typewriter mode but not focus mode", () => {
    expect(defaultSettings().typewriterMode).toBe(false);
    const normalized = normalizeSettings({ focusMode: true, typewriterMode: true });
    expect(normalized.typewriterMode).toBe(true);
    expect(normalized).not.toHaveProperty("focusMode");
    const a = defaultSettings();
    expect(settingsEqual(a, { ...a, typewriterMode: true })).toBe(false);
  });
});

describe("device focus mode", () => {
  beforeEach(() => mockDisk.clear());

  it("starts off and survives an app restart", () => {
    const first = loadFocusMode();
    expect(first.getFocusMode()).toBe(false);
    first.setFocusMode(true);
    expect(loadFocusMode().getFocusMode()).toBe(true);
    loadFocusMode().setFocusMode(false);
    expect(loadFocusMode().getFocusMode()).toBe(false);
  });

  it("hides chrome only on the editor while on", () => {
    const { focusChromeHidden } = loadFocusMode();
    expect(focusChromeHidden(true, true)).toBe(true);
    expect(focusChromeHidden(true, false)).toBe(false);
    expect(focusChromeHidden(false, true)).toBe(false);
  });
});

describe("typewriterInsets", () => {
  const { typewriterInsets, TYPEWRITER_MIN_TEXT_HEIGHT } = loadFocusMode();

  it("pads a tall editor by a share of its height", () => {
    expect(typewriterInsets(true, 800)).toEqual({ top: 320, bottom: 320 });
  });

  it("keeps a writing band visible when the keyboard shrinks the editor", () => {
    const height = 380;
    const { top, bottom } = typewriterInsets(true, height);
    expect(height - top - bottom).toBeGreaterThanOrEqual(TYPEWRITER_MIN_TEXT_HEIGHT);
    expect(top).toBe(bottom);
    expect(top).toBeGreaterThan(0);
  });

  it("adds nothing when off, unmeasured, or too short to pad", () => {
    expect(typewriterInsets(false, 800)).toEqual({ top: 0, bottom: 0 });
    expect(typewriterInsets(true, 0)).toEqual({ top: 0, bottom: 0 });
    expect(typewriterInsets(true, TYPEWRITER_MIN_TEXT_HEIGHT - 20)).toEqual({ top: 0, bottom: 0 });
  });
});
