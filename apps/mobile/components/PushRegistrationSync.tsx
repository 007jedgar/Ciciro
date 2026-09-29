import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import Constants from "expo-constants";
import { ciciro } from "../lib/api";
import { getPrefs } from "../lib/prefs";
import {
  parsePushRecord,
  subscribePushRegistrationSync,
  syncPushRegistration,
  type PushRegistrationDeps,
  type PushRegistrationRecord,
} from "../lib/push-registration";
import { useSession } from "../lib/session";

const RECORD_KEY = "push-registration";

function loadRecord(): PushRegistrationRecord | null {
  try {
    return parsePushRecord(getPrefs().getString(RECORD_KEY));
  } catch {
    return null;
  }
}

function saveRecord(record: PushRegistrationRecord | null): void {
  try {
    if (record) getPrefs().set(RECORD_KEY, JSON.stringify(record));
    else getPrefs().remove(RECORD_KEY);
  } catch {
    /* no prefs on this platform */
  }
}

async function nativeDeps(): Promise<PushRegistrationDeps | null> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  try {
    const Notifications = await import("expo-notifications");
    return {
      platform: Platform.OS,
      async getPermission() {
        const { status } = await Notifications.getPermissionsAsync();
        return status === "granted" ? "granted" : status === "denied" ? "denied" : "undetermined";
      },
      async getToken() {
        return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      },
      register: (body) => ciciro.push.register(body),
      unregister: (body) => ciciro.push.unregister(body),
      load: loadRecord,
      save: saveRecord,
    };
  } catch {
    return null; // a build without the notifications module
  }
}

/**
 * Registers this phone for push notifications while someone is signed in and
 * has allowed notifications, on launch, on every return to the foreground,
 * and when the platform rotates the token. Signing out forgets the local
 * record; the server already dropped the token with the session.
 */
export function PushRegistrationSync() {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (previous && previous !== userId) saveRecord(null);
    if (!userId) return;

    let cancelled = false;
    let running = false;
    let tokenSubscription: { remove(): void } | undefined;
    const sync = (force = false) => {
      if (running) return;
      running = true;
      void (async () => {
        const deps = await nativeDeps();
        if (deps && !cancelled) await syncPushRegistration(userId, deps, { force });
      })().finally(() => {
        running = false;
      });
    };

    sync();
    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") sync();
    });
    const unsubscribe = subscribePushRegistrationSync(() => sync());
    void import("expo-notifications")
      .then((Notifications) => {
        if (cancelled) return;
        tokenSubscription = Notifications.addPushTokenListener(() => sync(true));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      appSub.remove();
      unsubscribe();
      tokenSubscription?.remove();
    };
  }, [userId]);

  return null;
}
