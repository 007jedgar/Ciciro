import type { AnalyticsAdapter } from "@/lib/analytics-events";
import { NoopAnalyticsAdapter } from "@/lib/analytics-events";
import { createPostHogWebAdapter } from "@/lib/analytics-posthog-web";

// The browser analytics singleton. See docs/analytics.md for every env var
// this reads and where it comes from.
//
// NEXT_PUBLIC_ vars must be accessed as a static `process.env.NEXT_PUBLIC_X`
// property read (never bracket access, never a dynamic name) so Next.js can
// inline them at build time.

let cached: AnalyticsAdapter | null = null;

/**
 * The browser analytics adapter: PostHog when NEXT_PUBLIC_POSTHOG_KEY is
 * set, a silent no-op otherwise, so local dev, tests and CI need no PostHog
 * account. Created once, lazily, in the browser only (posthog-js needs
 * `window`).
 */
export function getAnalytics(): AnalyticsAdapter {
  if (cached) return cached;
  if (typeof window === "undefined") return new NoopAnalyticsAdapter();

  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) {
    cached = new NoopAnalyticsAdapter();
    return cached;
  }

  const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
  cached = createPostHogWebAdapter({ apiKey, apiHost });
  const release = process.env.NEXT_PUBLIC_CICIRO_RELEASE;
  cached.registerSuperProperties(release ? { platform: "web", release } : { platform: "web" });
  return cached;
}
