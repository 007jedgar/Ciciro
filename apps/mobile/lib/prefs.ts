import { Platform } from "react-native";
import { createMMKV, type MMKV } from "react-native-mmkv";

let prefs: MMKV | null = null;

/** Tiny flags and chrome prefs. Session tokens stay in SecureStore. */
export function getPrefs(): MMKV {
  if (Platform.OS === "web") {
    throw new Error("MMKV prefs are native-only.");
  }
  if (!prefs) {
    prefs = createMMKV({ id: "ciciro-prefs" });
  }
  return prefs;
}
