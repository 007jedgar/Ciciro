import { Platform } from "react-native";
import { createMMKV, type MMKV } from "react-native-mmkv";

let prefs: MMKV | null = null;

/** Tiny flags, chrome prefs, and a Fast Refresh mirror of the session token. */
export function getPrefs(): MMKV {
  if (Platform.OS === "web") {
    throw new Error("MMKV prefs are native-only.");
  }
  if (!prefs) {
    prefs = createMMKV({ id: "ciciro-prefs" });
  }
  return prefs;
}
