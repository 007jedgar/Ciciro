// The forced-update gate: checks the installed version against the server's
// policy (src/lib/app-version-policy.ts) on launch and on foreground, caches
// the last-known-good policy, and opens the store listing. Comparison and
// decision logic lives in lib/version-policy.ts; this file is the network,
// caching, and React side. See docs/mobile-release.md#forced-update.
import { useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import * as Application from "expo-application";
import { api } from "./api";
import { getPrefs } from "./prefs";
import {
  platformPolicyFrom,
  requiresForceUpdate,
  type VersionPolicyResponse,
} from "./version-policy";

/** At most one foreground re-check per this long; launch already checked. */
export const FOREGROUND_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const CACHE_KEY = "force-update-policy";

export type VersionPolicyClient = {
  fetchPolicy(): Promise<VersionPolicyResponse>;
};

const defaultClient: VersionPolicyClient = {
  fetchPolicy: () => api<VersionPolicyResponse>("/api/app/version-policy"),
};

function readCachedPolicy(): VersionPolicyResponse | null {
  try {
    const raw = getPrefs().getString(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as VersionPolicyResponse) : null;
  } catch {
    return null; // web, tests, or a missing native module
  }
}

function writeCachedPolicy(policy: VersionPolicyResponse): void {
  try {
    getPrefs().set(CACHE_KEY, JSON.stringify(policy));
  } catch {
    /* web, tests, or a missing native module */
  }
}

/**
 * One blocked/ok decision for `installedVersion`. A fetch failure falls back
 * to the last cached policy; a missing cache, or any malformed data along
 * the way, resolves "not blocked" rather than throwing - this must never
 * stop the app from opening.
 */
export async function checkForceUpdate(
  installedVersion: string | null | undefined,
  platform: "ios" | "android",
  client: VersionPolicyClient = defaultClient
): Promise<boolean> {
  let response: VersionPolicyResponse | null;
  try {
    response = await client.fetchPolicy();
    writeCachedPolicy(response);
  } catch {
    response = readCachedPolicy();
  }
  if (!response) return false;
  return requiresForceUpdate(installedVersion, platformPolicyFrom(response, platform));
}

/**
 * A poller that always runs on its first call (the launch check) and then at
 * most once per `interval` after that, returning the last decision in
 * between. Exposed as a factory, like `createForegroundUpdateCheck` in
 * lib/app-updates.ts, so the hook below stays a thin React wrapper.
 */
export function createForceUpdatePoller(
  client: VersionPolicyClient,
  platform: "ios" | "android",
  installedVersion: string | null | undefined,
  interval = FOREGROUND_CHECK_INTERVAL_MS
): (now?: number) => Promise<boolean> {
  let lastCheck = -Infinity;
  let blocked = false;
  return async (now = Date.now()) => {
    if (now - lastCheck < interval) return blocked;
    lastCheck = now;
    blocked = await checkForceUpdate(installedVersion, platform, client);
    return blocked;
  };
}

/** True once the installed build is confirmed below the server's minimum. */
export function useForceUpdateGate(): boolean {
  const [blocked, setBlocked] = useState(false);
  const checkRef = useRef<((now?: number) => Promise<boolean>) | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    const platform = Platform.OS === "android" ? "android" : "ios";
    const check = createForceUpdatePoller(defaultClient, platform, Application.nativeApplicationVersion);
    checkRef.current = check;
    void check().then((result) => {
      if (!cancelled) setBlocked(result);
    });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void check().then((result) => {
        if (!cancelled) setBlocked(result);
      });
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return blocked;
}

const IOS_APP_ID = "6817787071";
const IOS_STORE_URL = `https://apps.apple.com/app/id${IOS_APP_ID}`;
const IOS_ITMS_URL = `itms-apps://apps.apple.com/app/id${IOS_APP_ID}`;
const ANDROID_PACKAGE = "app.ciciro.mobile";
const ANDROID_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
const ANDROID_MARKET_URL = `market://details?id=${ANDROID_PACKAGE}`;

async function openWithFallback(preferred: string, fallback: string): Promise<void> {
  try {
    if (await Linking.canOpenURL(preferred)) {
      await Linking.openURL(preferred);
      return;
    }
  } catch {
    /* fall through to the https URL */
  }
  await Linking.openURL(fallback);
}

/** Opens the app's store listing: the App Store on iOS, Play Store on Android. */
export async function openStoreListing(): Promise<void> {
  if (Platform.OS === "android") {
    await openWithFallback(ANDROID_MARKET_URL, ANDROID_STORE_URL);
    return;
  }
  await openWithFallback(IOS_ITMS_URL, IOS_STORE_URL);
}
