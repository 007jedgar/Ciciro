import { getLocales } from "expo-localization";
import type { VoiceOption } from "./read-aloud";

/** The phone's own speech voices, as the voice list shows them. Empty where the module is missing. */
export async function loadSystemVoices(): Promise<VoiceOption[]> {
  try {
    const Speech = require("expo-speech") as typeof import("expo-speech");
    const all = await Speech.getAvailableVoicesAsync();
    return all.map((v) => ({
      identifier: v.identifier,
      name: v.name,
      language: v.language,
      quality: String(v.quality),
    }));
  } catch {
    return [];
  }
}

export function deviceLocale(): string {
  try {
    return getLocales()[0]?.languageTag ?? "";
  } catch {
    return "";
  }
}
