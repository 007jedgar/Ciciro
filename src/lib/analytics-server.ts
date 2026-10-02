import type { AnalyticsAdapter, EventName, EventProperties, PersonProperties } from "@/lib/analytics-events";
import { NoopAnalyticsAdapter } from "@/lib/analytics-events";
import { createPostHogServerAdapter } from "@/lib/analytics-posthog-server";
import { prisma } from "@/lib/db";
import { defaultSettings, parseSettingsJson } from "@/lib/settings";

// Server-side analytics: events only the server knows reliably (subscription
// webhooks, account created, run completed). See docs/analytics.md.
//
// Bracket access, like src/lib/email/index.ts: Next.js must not replace these
// with empty strings from the Workers CI build environment. The hosted
// Worker copies secrets onto process.env per request (src/worker/index.ts).
function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * A fresh server analytics adapter for one unit of work (one webhook event,
 * one API route call). Never cache or reuse this across requests: Workers
 * can interleave concurrent requests on one isolate, and the adapter carries
 * per-call identify() state that must never leak between them. A silent
 * no-op with no POSTHOG_PROJECT_API_KEY configured.
 */
export function createServerAnalytics(): AnalyticsAdapter {
  const apiKey = readEnv("POSTHOG_PROJECT_API_KEY");
  if (!apiKey) return new NoopAnalyticsAdapter();
  const apiHost = readEnv("POSTHOG_HOST") || "https://us.i.posthog.com";
  const personalApiKey = readEnv("POSTHOG_PERSONAL_API_KEY");
  const projectId = readEnv("POSTHOG_PROJECT_ID");
  const appHost = readEnv("POSTHOG_APP_HOST") || "https://us.posthog.com";
  const adapter = createPostHogServerAdapter({
    apiKey,
    apiHost,
    deletion: personalApiKey && projectId ? { appHost, personalApiKey, projectId } : undefined,
  });
  const release = readEnv("CICIRO_RELEASE");
  adapter.registerSuperProperties(release ? { platform: "web", release } : { platform: "web" });
  return adapter;
}

/**
 * Ask PostHog to forget a deleted account's person record. Never throws - a
 * PRE_DELETE_HOOKS entry whose failure should not block account deletion
 * (see src/lib/account/delete.ts).
 */
export async function deleteAnalyticsPerson(userId: string): Promise<void> {
  try {
    createServerAnalytics().deleteUser(userId);
  } catch (error) {
    console.error("[analytics] deleteAnalyticsPerson failed", error);
  }
}

/** Whether a user has opted out of analytics (AppSettings.analyticsEnabled === false). */
export async function analyticsOptedOut(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { settingsJson: true, settingsUpdatedAt: true },
  });
  if (!user) return defaultSettings().analyticsEnabled === false;
  return parseSettingsJson(user.settingsJson, user.settingsUpdatedAt).analyticsEnabled === false;
}

/**
 * Identify and send one server-confirmed event for a user, honoring their
 * analytics opt-out. Never throws - wrap the call in waitUntilRequest (see
 * src/lib/db.ts) at the call site so it cannot block or fail the response.
 */
export async function captureServerEvent<E extends EventName>(
  userId: string,
  event: E,
  properties: EventProperties<E>,
  personProperties?: PersonProperties
): Promise<void> {
  try {
    if (await analyticsOptedOut(userId)) return;
    const analytics = createServerAnalytics();
    analytics.identify(userId, personProperties);
    analytics.track(event, properties);
  } catch (error) {
    console.error("[analytics] captureServerEvent failed", error);
  }
}
