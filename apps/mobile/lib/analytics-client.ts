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
const NOOP_ADAPTER: AnalyticsAdapter = new NoopAnalyticsAdapter();

// Device consent (see lib/consent.ts) gates whether a real PostHog client
// ever exists. Starts false - the safe, pre-consent default - and is set by
// AnalyticsSync whenever the on-device consent record changes. No call site
// touches this directly.
let consentGranted = false;

/** Builds (once) and caches the real adapter, independent of consent - callers gate on consent themselves. */
function ensureClient(): AnalyticsAdapter {
  if (cached) return cached;
  const apiKey = analyticsApiKey();
  if (!apiKey) {
    cached = new NoopAnalyticsAdapter();
    return cached;
  }
  const apiHost = process.env.EXPO_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";
  cached = createPostHogNativeAdapter({ apiKey, apiHost });
  const platform: AnalyticsPlatform = Platform.OS === "android" ? "android" : "ios";
  cached.registerSuperProperties({
    platform,
    appVersion: Constants.expoConfig?.version,
    release: Updates.updateId ?? undefined,
  });
  return cached;
}

/**
 * Called whenever the device's analytics consent changes (AnalyticsSync,
 * from lib/consent.ts's record). Both directions act on the adapter
 * immediately and explicitly, never relying on whatever opted-in/out state
 * construction happened to leave it in: granting lazily builds the real
 * adapter if needed (it starts opted out - see analytics-posthog-native.ts)
 * and opts it in; withdrawing stops capture and clears PostHog's stored
 * identifiers (optOut() first, then reset(), the required order). The
 * adapter itself is never torn down on withdrawal, so a later re-grant in
 * the same session - withdraw then change your mind again - opts the same
 * instance back in without needing an app restart. `active` is whether it
 * should capture right now (false while the signed-in account's own setting
 * is off): the device's grant alone decides whether the client exists and
 * keeps its identity, so an account-level "off" only opts it out, never
 * resets it. `userId` is the account signed in at the moment of the grant: a
 * client built after sign-in never saw that sign-in's identify, so it is
 * identified here.
 */
export function setAnalyticsConsent(
  granted: boolean,
  active: boolean = granted,
  userId: string | null = null
): void {
  if (granted === consentGranted) return;
  consentGranted = granted;
  if (!granted) {
    if (cached) {
      cached.setOptedOut(true);
      cached.reset();
    }
    return;
  }
  const client = ensureClient();
  client.setOptedOut(!active);
  if (userId) client.identify(userId);
}

/**
 * The phone's analytics adapter: a silent no-op before analytics consent is
 * granted on this device (see lib/consent.ts) or with no
 * EXPO_PUBLIC_POSTHOG_KEY configured, so local dev, Jest and CI need no
 * PostHog account and nothing is ever captured or persisted pre-consent.
 * setAnalyticsConsent (above) is what actually builds and opts in the real
 * adapter; this is just the gated getter every call site uses.
 */
export function getAnalytics(): AnalyticsAdapter {
  if (!consentGranted) return NOOP_ADAPTER;
  return ensureClient();
}

/**
 * A device that ran a build from before this consent gate shipped may
 * already have a PostHog-persisted anonymous identity (distinct id, device
 * id) from the old opt-out-by-default behavior. Call this once, when a
 * "Don't allow" decision is first recorded (lib/consent.ts's decideConsent),
 * to sweep that legacy identity: it builds the real adapter if one does not
 * already exist purely to reset() it, then leaves it opted out. A fresh
 * install with no legacy PostHog history has nothing to sweep, but calling
 * this unconditionally is harmless either way.
 */
export function sweepLegacyAnalyticsIdentity(): void {
  const adapter = ensureClient();
  adapter.setOptedOut(true);
  adapter.reset();
}
