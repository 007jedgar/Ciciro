import {
  activeDailyGoal,
  applyPatch,
  defaultSettings,
  nearestFontSize,
  normalizeSettings,
  SETTINGS_EPOCH,
  settingsEqual,
  cachedSettingsSaved,
  reconcileSettings,
  withPhoneDefaultTheme,
  type AppSettings,
} from "../lib/app-settings";

describe("activeDailyGoal", () => {
  it("is the stored goal while it is on, and 0 (none) while it is off", () => {
    expect(activeDailyGoal({ showDailyGoal: true, dailyWordGoal: 500 })).toBe(500);
    expect(activeDailyGoal({ showDailyGoal: false, dailyWordGoal: 500 })).toBe(0);
    expect(activeDailyGoal(defaultSettings())).toBe(250);
  });
});

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

  describe("the phone's default theme", () => {
    const CREATED = "2026-09-01T00:00:00.000Z";
    const server = (over: Record<string, unknown> = {}): AppSettings =>
      normalizeSettings({ ...defaultSettings(), theme: "parchment", updatedAt: CREATED, ...over });

    it("shows Ciciro for settings nobody saved, and leaves saved or unknown ones as stored", () => {
      expect(withPhoneDefaultTheme(server(), false).theme).toBe("ciciro");
      expect(withPhoneDefaultTheme(server(), true).theme).toBe("parchment");
      expect(withPhoneDefaultTheme(server(), null).theme).toBe("parchment");
    });

    it("counts a cache still at the epoch as never saved, and an older synced one as unknown", () => {
      expect(cachedSettingsSaved(defaultSettings(), null)).toBe(false);
      expect(cachedSettingsSaved(server(), null)).toBeNull();
      expect(cachedSettingsSaved(server(), true)).toBe(true);
      expect(cachedSettingsSaved(server(), false)).toBe(false);
    });

    it("gives a new phone Ciciro when the account never saved settings", () => {
      const next = reconcileSettings({
        local: defaultSettings(),
        localSaved: false,
        owned: true,
        remote: server(),
        remoteSaved: false,
      });
      expect(next).toMatchObject({ saved: false, sync: "none" });
      expect(next.settings.theme).toBe("ciciro");
    });

    it("keeps an explicitly saved Parchment on a new phone and after signing in again", () => {
      for (const local of [defaultSettings(), server({ theme: "ember", updatedAt: "2026-08-01T00:00:00.000Z" })]) {
        for (const owned of [true, false]) {
          const next = reconcileSettings({ local, localSaved: null, owned, remote: server(), remoteSaved: true });
          expect(next.settings.theme).toBe("parchment");
          expect(next.saved).toBe(true);
        }
      }
    });

    it("moves an older install's cached blank Parchment to Ciciro once the server says it was never saved", () => {
      const next = reconcileSettings({
        local: server(),
        localSaved: null,
        owned: true,
        remote: server(),
        remoteSaved: false,
      });
      expect(next).toMatchObject({ saved: false, sync: "none" });
      expect(next.settings.theme).toBe("ciciro");
    });

    it("keeps a cached Parchment the author picked, even before the server has heard of it", () => {
      const picked = applyPatch(server({ theme: "ember" }), { theme: "parchment" });
      const next = reconcileSettings({
        local: picked,
        localSaved: true,
        owned: true,
        remote: server(),
        remoteSaved: false,
      });
      expect(next).toMatchObject({ saved: true, sync: "put" });
      expect(next.settings.theme).toBe("parchment");

      const synced = reconcileSettings({
        local: server({ updatedAt: picked.updatedAt }),
        localSaved: true,
        owned: true,
        remote: server({ updatedAt: picked.updatedAt }),
        remoteSaved: true,
      });
      expect(synced.settings.theme).toBe("parchment");
    });

    it("never moves a stored theme when an older server does not say whether settings were saved", () => {
      for (const local of [defaultSettings(), server()]) {
        const next = reconcileSettings({ local, localSaved: null, owned: true, remote: server(), remoteSaved: undefined });
        expect(next.settings.theme).toBe("parchment");
        expect(next.saved).toBeNull();
      }
    });

    it("shows the other account's own copy when the cache belongs to someone else", () => {
      const next = reconcileSettings({
        local: server({ theme: "walnut", updatedAt: "2026-10-01T00:00:00.000Z" }),
        localSaved: true,
        owned: false,
        remote: server(),
        remoteSaved: false,
      });
      expect(next).toMatchObject({ saved: false, sync: "none" });
      expect(next.settings.theme).toBe("ciciro");
    });
  });
});
