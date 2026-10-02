import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import type { AnalyticsAdapter, Platform as AnalyticsPlatform } from "./analytics-events";
import { NoopAnalyticsAdapter } from "./analytics-events";
import { createPostHogNativeAdapter } from "./analytics-posthog-native";

// The phone's analytics singleton. See docs/analytics.md for every env var
// this reads and where it comes from (EAS environment variables at build
// time, same as EXPO_PUBLIC_REVENUECAT_*_API_KEY in lib/purchases.ts).

export function analyticsApiKey(): string | null {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  return key && key.trim() ? key.trim() : null;
}

export function analyticsAvailable(): boolean {
  return analyticsApiKey() !== null;
}

let cached: AnalyticsAdapter | null = null;

/**
 * The phone's analytics adapter: PostHog when EXPO_PUBLIC_POSTHOG_KEY is
 * set, a silent no-op otherwise, so local dev, Jest and CI need no PostHog
 * account. Created once, lazily, on first use.
 */
export function getAnalytics(): AnalyticsAdapter {
  if (cached) return cached;
  const apiKey = analyticsApiKey();
  if (!apiKey) {
    cached = new NoopAnalyticsAdapter();
    return cached;
  }
  const apiHost = process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
  cached = createPostHogNativeAdapter({ apiKey, apiHost });
  const platform: AnalyticsPlatform = Platform.OS === "android" ? "android" : "ios";
  cached.registerSuperProperties({
    platform,
    appVersion: Constants.expoConfig?.version,
    release: Updates.updateId ?? undefined,
  });
  return cached;
}
