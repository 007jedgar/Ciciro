// Over-the-air updates (expo-updates, EAS Update). A release build checks on
// every cold launch without waiting for it (app.json: checkAutomatically
// ON_LOAD, fallbackToCacheTimeout 0), and the update it downloads runs on the
// next cold launch. Writing sessions can last days without a relaunch, so the
// app also checks when it returns to the foreground, downloads in the
// background, and still waits for the next launch to switch: it never reloads
// under someone who is writing. See docs/mobile-release.md#over-the-air-updates.

export type UpdatesClient = {
  /** False in development and in builds without expo-updates. */
  isEnabled: boolean;
  checkForUpdateAsync(): Promise<{ isAvailable: boolean }>;
  fetchUpdateAsync(): Promise<unknown>;
};

/** At most one foreground check per this long; launch already checked. */
export const FOREGROUND_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export type ForegroundCheckResult = "downloaded" | "current" | "skipped" | "failed";

/**
 * A foreground check to run whenever the app becomes active. The first call
 * counts from `startedAt`, since the launch check just ran; overlapping calls
 * and calls inside the interval are skipped.
 */
export function createForegroundUpdateCheck(
  client: UpdatesClient,
  startedAt: number,
  interval = FOREGROUND_CHECK_INTERVAL_MS
): (now?: number) => Promise<ForegroundCheckResult> {
  let lastCheck = startedAt;
  let inFlight = false;
  let downloaded = false;
  return async (now = Date.now()) => {
    if (!client.isEnabled || inFlight || downloaded || now - lastCheck < interval) return "skipped";
    inFlight = true;
    lastCheck = now;
    try {
      const result = await client.checkForUpdateAsync();
      if (!result.isAvailable) return "current";
      await client.fetchUpdateAsync();
      downloaded = true;
      return "downloaded";
    } catch {
      return "failed"; // offline, or the update server is down: try next time
    } finally {
      inFlight = false;
    }
  };
}
