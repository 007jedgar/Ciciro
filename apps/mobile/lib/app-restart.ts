import { DevSettings } from "react-native";

export type RestartClient = {
  /** False in development and in builds without expo-updates (see lib/app-updates.ts). */
  isEnabled: boolean;
  reloadAsync(): Promise<void>;
};

/**
 * Reload the JS runtime in place, no force-quit needed. expo-updates'
 * reloadAsync is the release-build path, since `isEnabled` is only true
 * there; Expo Go and a dev client without expo-updates fall back to
 * `DevSettings.reload`, Metro's own "Reload" and the only JS reload those
 * builds have. Throws only when neither path is available (a release build
 * stripped of both), which the caller should treat as "tell the author to
 * close and reopen the app".
 */
export async function restartApp(client?: RestartClient): Promise<void> {
  const updates = client ?? (await loadUpdatesClient());
  if (updates?.isEnabled) {
    await updates.reloadAsync();
    return;
  }
  if (typeof DevSettings?.reload !== "function") {
    throw new Error("No JS reload is available on this build");
  }
  DevSettings.reload();
}

async function loadUpdatesClient(): Promise<RestartClient | null> {
  try {
    const Updates = (await import("expo-updates")) as unknown as RestartClient;
    return Updates;
  } catch {
    // A dev client built before expo-updates was added.
    return null;
  }
}
