import i18n, {
  asStringList,
  asStringMatrix,
  isAppLocale,
  resolveDeviceLocale,
  setAppLocale,
  SUPPORTED_LOCALES,
} from "../lib/i18n";
import en from "../lib/i18n/locales/en";
import es from "../lib/i18n/locales/es";
import hi from "../lib/i18n/locales/hi";
import zh from "../lib/i18n/locales/zh";
import * as Localization from "expo-localization";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return prefix ? [prefix] : [];
  if (!value || typeof value !== "object") return prefix ? [prefix] : [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe("i18n", () => {
  it("keeps the same keys in every locale", () => {
    const expected = flattenKeys(en).sort();
    expect(flattenKeys(es).sort()).toEqual(expected);
    expect(flattenKeys(hi).sort()).toEqual(expected);
    expect(flattenKeys(zh).sort()).toEqual(expected);
  });

  it("translates chrome strings for each supported language", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("settings.title")).toBe("Settings");
    expect(i18n.t("auth.working")).toBe("Inking…");

    await i18n.changeLanguage("es");
    expect(i18n.t("settings.title")).toBe("Ajustes");
    expect(i18n.t("manuscripts.count", { count: 2 })).toBe("2 manuscritos");

    await i18n.changeLanguage("hi");
    expect(i18n.t("settings.title")).toBe("सेटिंग्स");

    await i18n.changeLanguage("zh");
    expect(i18n.t("settings.title")).toBe("设置");
    expect(i18n.t("chapters.wordCount", { count: 12 })).toBe("12 词");
  });

  it("returns living-page passages and ledes as lists", () => {
    const passages = asStringMatrix(i18n.t("livingPage.passages", { returnObjects: true }));
    const ledes = asStringList(i18n.t("livingPage.ledes", { returnObjects: true }));
    expect(passages).toHaveLength(en.livingPage.passages.length);
    expect(ledes).toHaveLength(en.livingPage.ledes.length);
    expect(passages[0]?.length).toBeGreaterThan(0);
  });

  it("maps device language codes onto the supported set", () => {
    (Localization.getLocales as jest.Mock).mockReturnValueOnce([{ languageCode: "es", languageTag: "es-MX" }]);
    expect(resolveDeviceLocale()).toBe("es");

    (Localization.getLocales as jest.Mock).mockReturnValueOnce([{ languageCode: "zh", languageTag: "zh-Hans-CN" }]);
    expect(resolveDeviceLocale()).toBe("zh");

    (Localization.getLocales as jest.Mock).mockReturnValueOnce([{ languageCode: "fr", languageTag: "fr-FR" }]);
    expect(resolveDeviceLocale()).toBe("en");
  });

  it("changes language through setAppLocale", async () => {
    await setAppLocale("hi");
    expect(i18n.language).toBe("hi");
    expect(isAppLocale("hi")).toBe(true);
    expect(SUPPORTED_LOCALES).toContain("zh");
  });
});
