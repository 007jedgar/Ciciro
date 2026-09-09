import {
  applyPatch,
  defaultSettings,
  nearestFontSize,
  normalizeSettings,
  SETTINGS_EPOCH,
  settingsEqual,
} from "../lib/app-settings";

describe("app settings", () => {
  it("fills defaults and clamps values", () => {
    const s = normalizeSettings({
      theme: "ember",
      editorFont: "sans",
      editorFontSize: 20.4,
      autoCorrect: false,
      chatWidth: 9999,
    });
    expect(s.theme).toBe("ember");
    expect(s.editorFont).toBe("sans");
    expect(s.editorFontSize).toBe(21);
    expect(s.autoCorrect).toBe(false);
    expect(s.chatWidth).toBe(720);
    expect(nearestFontSize(14)).toBe(15);
  });

  it("ignores unknown theme and font values", () => {
    const s = normalizeSettings({ theme: "neon", editorFont: "comic" });
    expect(s).toMatchObject({
      theme: "parchment",
      editorFont: "serif",
      editorFontSize: 19,
      autoCorrect: true,
      updatedAt: SETTINGS_EPOCH,
    });
  });

  it("applies patches without dropping other fields", () => {
    const older = defaultSettings();
    const patched = applyPatch(older, { editorFont: "sans", autoCorrect: false });
    expect(patched.editorFont).toBe("sans");
    expect(patched.autoCorrect).toBe(false);
    expect(patched.theme).toBe("parchment");
    expect(Date.parse(patched.updatedAt)).toBeGreaterThan(Date.parse(older.updatedAt));
    expect(settingsEqual(older, patched)).toBe(false);
  });
});
