import { useEffect } from "react";
import { AppState } from "react-native";
import { createForegroundUpdateCheck } from "../lib/app-updates";

/** Downloads an over-the-air update when the app comes back to the foreground (see lib/app-updates.ts). */
export function UpdateSync() {
  useEffect(() => {
    let cancelled = false;
    let subscription: { remove(): void } | undefined;
    void import("expo-updates")
      .then((Updates) => {
        if (cancelled || !Updates.isEnabled) return;
        const check = createForegroundUpdateCheck(Updates, Date.now());
        subscription = AppState.addEventListener("change", (state) => {
          if (state === "active") void check();
        });
      })
      .catch(() => {
        /* a dev client built before expo-updates was added */
      });
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  return null;
}
