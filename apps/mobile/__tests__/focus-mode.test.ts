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

describe("typewriterBottomInset", () => {
  const { typewriterBottomInset, TYPEWRITER_MIN_TEXT_HEIGHT } = loadFocusMode();

  it("pads a tall editor by half its height so the last line can reach the middle", () => {
    expect(typewriterBottomInset(true, 800)).toBe(400);
  });

  it("keeps a writing area visible when the keyboard shrinks the editor", () => {
    const height = 300;
    const pad = typewriterBottomInset(true, height);
    expect(pad).toBeGreaterThan(0);
    expect(height - pad).toBeGreaterThanOrEqual(TYPEWRITER_MIN_TEXT_HEIGHT);
  });

  it("adds nothing when off, unmeasured, or too short to pad", () => {
    expect(typewriterBottomInset(false, 800)).toBe(0);
    expect(typewriterBottomInset(true, 0)).toBe(0);
    expect(typewriterBottomInset(true, TYPEWRITER_MIN_TEXT_HEIGHT - 20)).toBe(0);
  });
});
