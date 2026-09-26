import { defaultSettings, normalizeSettings, settingsEqual } from "../lib/app-settings";
import { focusChromeHidden, typewriterInsets } from "../lib/focus-mode";

describe("focus and typewriter settings", () => {
  it("default off and normalize from unknown input", () => {
    const s = defaultSettings();
    expect(s.focusMode).toBe(false);
    expect(s.typewriterMode).toBe(false);
    expect(normalizeSettings({ focusMode: true, typewriterMode: true })).toMatchObject({
      focusMode: true,
      typewriterMode: true,
    });
    expect(normalizeSettings({ focusMode: "yes" }).focusMode).toBe(false);
  });

  it("counts both flags in settingsEqual", () => {
    const a = defaultSettings();
    expect(settingsEqual(a, { ...a, focusMode: true })).toBe(false);
    expect(settingsEqual(a, { ...a, typewriterMode: true })).toBe(false);
  });
});

describe("focusChromeHidden", () => {
  it("hides chrome only on the editor while focus mode is on", () => {
    expect(focusChromeHidden({ focusMode: true }, true)).toBe(true);
    expect(focusChromeHidden({ focusMode: true }, false)).toBe(false);
    expect(focusChromeHidden({ focusMode: false }, true)).toBe(false);
  });
});

describe("typewriterInsets", () => {
  it("pads the page by a share of the viewport", () => {
    expect(typewriterInsets(true, 800)).toEqual({ top: 320, bottom: 320 });
  });
  it("adds nothing when off or unmeasured", () => {
    expect(typewriterInsets(false, 800)).toEqual({ top: 0, bottom: 0 });
    expect(typewriterInsets(true, 0)).toEqual({ top: 0, bottom: 0 });
  });
});
