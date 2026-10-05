import {
  applyPatch,
  defaultSettings,
  nearestFontSize,
  normalizeSettings,
  SETTINGS_EPOCH,
  settingsEqual,
  withPhoneDefaultTheme,
} from "../lib/app-settings";

describe("app settings", () => {
  it("fills defaults and clamps values", () => {
    const s = normalizeSettings({
      theme: "ember",
      editorFont: "sans",
      editorFontSize: 20.4,
      autoCorrect: false,
      reduceMotion: true,
      chatWidth: 9999,
    });
    expect(s.theme).toBe("ember");
    expect(s.editorFont).toBe("sans");
    expect(s.editorFontSize).toBe(21);
    expect(s.autoCorrect).toBe(false);
    expect(s.reduceMotion).toBe(true);
    expect(s.chatWidth).toBe(720);
    expect(s.dailyWordGoal).toBe(250);
    expect(s.weeklyDayTarget).toBe(4);
    expect(s.showDailyGoal).toBe(true);
    expect(s.formatChrome).toBe("smart");
    expect(nearestFontSize(14)).toBe(15);
  });

  it("ignores unknown theme and font values", () => {
    const s = normalizeSettings({ theme: "neon", editorFont: "comic", formatChrome: "floating" });
    expect(s).toMatchObject({
      theme: "ciciro",
      editorFont: "serif",
      editorFontSize: 19,
      autoCorrect: true,
      reduceMotion: false,
      dailyWordGoal: 250,
      weeklyDayTarget: 4,
      showDailyGoal: true,
      formatChrome: "smart",
      updatedAt: SETTINGS_EPOCH,
    });
  });

  it("clamps weekly day targets into 1–7", () => {
    expect(normalizeSettings({ weeklyDayTarget: 9 }).weeklyDayTarget).toBe(7);
    expect(normalizeSettings({ weeklyDayTarget: 0 }).weeklyDayTarget).toBe(1);
  });

  it("has Ciciro suggest line edits unless the author turned it off", () => {
    expect(defaultSettings().aiSuggestions).toBe(true);
    expect(normalizeSettings({}).aiSuggestions).toBe(true);
    expect(normalizeSettings({ aiSuggestions: false }).aiSuggestions).toBe(false);
    expect(settingsEqual(defaultSettings(), { ...defaultSettings(), aiSuggestions: false })).toBe(false);
  });

  it("keeps the Experimental writing prompt off until the author turns it on", () => {
    expect(defaultSettings().craftDefaults).toBe(false);
    expect(normalizeSettings({}).craftDefaults).toBe(false);
    expect(normalizeSettings({ craftDefaults: true }).craftDefaults).toBe(true);
    expect(normalizeSettings({ craftDefaults: "on" }).craftDefaults).toBe(false);
    expect(settingsEqual(defaultSettings(), { ...defaultSettings(), craftDefaults: true })).toBe(false);
  });

  it("applies patches without dropping other fields", () => {
    const older = defaultSettings();
    const patched = applyPatch(older, { editorFont: "sans", autoCorrect: false });
    expect(patched.editorFont).toBe("sans");
    expect(patched.autoCorrect).toBe(false);
    expect(patched.theme).toBe("ciciro");
    expect(Date.parse(patched.updatedAt)).toBeGreaterThan(Date.parse(older.updatedAt));
    expect(settingsEqual(older, patched)).toBe(false);
  });

  it("falls back to Ciciro for anyone who never picked a theme", () => {
    expect(defaultSettings().theme).toBe("ciciro");
    expect(normalizeSettings({}).theme).toBe("ciciro");
    expect(normalizeSettings({ theme: "neon" }).theme).toBe("ciciro");
    expect(normalizeSettings({ theme: 4 }).theme).toBe("ciciro");
  });

  it("keeps a stored theme, new or old", () => {
    for (const theme of ["ciciro", "ciciro-night", "parchment", "sage", "ember", "walnut", "inkwell", "candle"]) {
      expect(normalizeSettings({ theme }).theme).toBe(theme);
    }
  });

  describe("withPhoneDefaultTheme", () => {
    const server = (over: Record<string, unknown> = {}) =>
      normalizeSettings({ ...defaultSettings(), theme: "parchment", updatedAt: "2026-09-01T00:00:00.000Z", ...over });

    it("keeps the phone default when the server only holds its own blank settings", () => {
      expect(withPhoneDefaultTheme(server()).theme).toBe("ciciro");
    });

    it("leaves an account that changed anything else, or picked another theme, as stored", () => {
      expect(withPhoneDefaultTheme(server({ dailyWordGoal: 500 })).theme).toBe("parchment");
      expect(withPhoneDefaultTheme(server({ theme: "walnut" })).theme).toBe("walnut");
      expect(withPhoneDefaultTheme(server({ theme: "ciciro-night" })).theme).toBe("ciciro-night");
    });
  });
});
