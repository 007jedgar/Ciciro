import { describe, expect, it } from "vitest";
import {
  applyPatch,
  clampChatWidth,
  defaultSettings,
  nearestFontSize,
  normalizeSettings,
  parseSettingsJson,
  parseSettingsPatch,
  pickNewer,
  settingsEqual,
} from "@/lib/settings";

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
    expect(clampChatWidth(100)).toBe(280);
  });

  it("ignores unknown theme and font values", () => {
    const s = normalizeSettings({ theme: "neon", editorFont: "comic", formatChrome: "floating" });
    expect(s.theme).toBe("parchment");
    expect(s.editorFont).toBe("serif");
    expect(s.formatChrome).toBe("smart");
  });

  it("parses empty JSON as defaults", () => {
    const s = parseSettingsJson("{}", new Date("2026-01-01T00:00:00.000Z"));
    expect(s.theme).toBe("parchment");
    expect(s.editorFontSize).toBe(19);
    expect(s.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("accepts a Prisma/D1 timestamp string instead of a Date", () => {
    const s = parseSettingsJson("{}", "2026-01-01T00:00:00.000Z");
    expect(s.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(() => parseSettingsJson("{}", "2026-09-20T05:50:19.259+00:00")).not.toThrow();
  });

  it("rejects invalid patches", () => {
    expect(parseSettingsPatch({ theme: "neon" })).toEqual({ error: "Unknown theme." });
    expect(parseSettingsPatch({ formatChrome: "floating" })).toEqual({
      error: "formatChrome must be smart, selection, press, or always.",
    });
    expect(parseSettingsPatch({ formatChrome: "selection" })).toEqual({ formatChrome: "selection" });
    expect(parseSettingsPatch({ autoCorrect: "yes" })).toEqual({
      error: "autoCorrect must be a boolean.",
    });
    expect(parseSettingsPatch({ reduceMotion: "yes" })).toEqual({
      error: "reduceMotion must be a boolean.",
    });
    expect(parseSettingsPatch({ showDailyGoal: "yes" })).toEqual({
      error: "showDailyGoal must be a boolean.",
    });
    expect(parseSettingsPatch({ dailyWordGoal: 250, showDailyGoal: false })).toEqual({
      dailyWordGoal: 250,
      showDailyGoal: false,
    });
    expect(parseSettingsPatch({ weeklyDayTarget: 9 })).toEqual({ weeklyDayTarget: 7 });
    expect(parseSettingsPatch({ weeklyDayTarget: 0 })).toEqual({ weeklyDayTarget: 1 });
    expect(parseSettingsPatch({ theme: "sage" })).toEqual({ theme: "sage" });
  });

  it("picks the newer document and applies patches", () => {
    const older = { ...defaultSettings(new Date("2026-01-01T00:00:00.000Z")), theme: "parchment" as const };
    const newer = { ...defaultSettings(new Date("2026-02-01T00:00:00.000Z")), theme: "inkwell" as const };
    expect(pickNewer(older, newer).theme).toBe("inkwell");
    expect(pickNewer(newer, older).theme).toBe("inkwell");

    const patched = applyPatch(older, { editorFont: "sans" }, new Date("2026-03-01T00:00:00.000Z"));
    expect(patched.editorFont).toBe("sans");
    expect(patched.theme).toBe("parchment");
    expect(patched.updatedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(settingsEqual(older, patched)).toBe(false);
  });
});
