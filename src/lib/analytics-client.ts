import type { AnalyticsAdapter } from "@/lib/analytics-events";
import { NoopAnalyticsAdapter } from "@/lib/analytics-events";
import { clearPostHogWebStorage, createPostHogWebAdapter } from "@/lib/analytics-posthog-web";

// The browser analytics singleton. See docs/analytics.md for every env var
// this reads and where it comes from, and its "Opt-in consent" bullet for
// the gating this file enforces. posthog-js is initialized (PostHog's own
// recommended consent posture - see analytics-posthog-web.ts) the first time
// setAnalyticsEnabled runs, whatever its argument: if that first call is
// `false` (no decision yet, or a rejection), it initializes with
// `persistence: "memory"` and capturing opted out by default, so nothing
// ever lands in a cookie or localStorage until a later `true` call. Either
// way, getAnalytics() returns a no-op adapter - so no event is ever sent -
// until `setAnalyticsEnabled(true)` has actually run.
//
// NEXT_PUBLIC_ vars must be accessed as a static `process.env.NEXT_PUBLIC_X`
// property read (never bracket access, never a dynamic name) so Next.js can
// inline them at build time.

const noop = new NoopAnalyticsAdapter();
let posthogAdapter: AnalyticsAdapter | null = null;
let enabled = false;
let started = false;

function ensurePostHogAdapter(grantedAtInit: boolean): AnalyticsAdapter | null {
  if (posthogAdapter) return posthogAdapter;
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return null;

  const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";
  const adapter = createPostHogWebAdapter({ apiKey, apiHost, grantedAtInit });
  const release = process.env.NEXT_PUBLIC_CICIRO_RELEASE;
  adapter.registerSuperProperties(release ? { platform: "web", release } : { platform: "web" });
  posthogAdapter = adapter;
  return adapter;
}

/**
 * Turn PostHog capture on or off for this browser, called from
 * AnalyticsProvider whenever "device consent granted AND (signed out OR the
 * account's analyticsEnabled)" changes. Withdrawal order matters: opt out,
 * then reset() (which itself only returns the SDK to its default consent
 * state - see analytics-posthog-web.ts - so it must come after the opt-out,
 * never before an opt-in), then sweep every `ph_*` key outright. The sweep
 * also covers a visitor who already had PostHog identifiers from before
 * this gating shipped: their first load with no consent decision calls
 * this with `false`, which cleans those up too.
 */
export function setAnalyticsEnabled(on: boolean): void {
  if (typeof window === "undefined") return;
  const firstRun = !started;
  started = true;
  if (enabled === on && !firstRun) return;
  enabled = on;
  const adapter = ensurePostHogAdapter(on);
  if (on) {
    adapter?.setOptedOut(false);
    return;
  }
  adapter?.setOptedOut(true);
  adapter?.reset();
  // Unconditional, even with no PostHog key configured: a visitor who
  // carries identifiers from before this gating shipped (or from a key
  // that used to be configured) still gets swept clean on this device.
  clearPostHogWebStorage();
}

/** The browser analytics adapter: PostHog once enabled, a silent no-op otherwise. */
export function getAnalytics(): AnalyticsAdapter {
  if (typeof window === "undefined" || !enabled || !posthogAdapter) return noop;
  return posthogAdapter;
}
