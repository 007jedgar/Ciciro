import posthog from "posthog-js";
import type { AnalyticsAdapter, EventName, PersonProperties, SuperProperties } from "@/lib/analytics-events";

// The PostHog adapter for the browser. Only src/lib/analytics-client.ts
// constructs this; nothing else in the app imports posthog-js directly. See
// docs/analytics.md.

export type PostHogWebConfig = {
  apiKey: string;
  apiHost: string;
};

/**
 * Initialize posthog-js and wrap it as an AnalyticsAdapter. Session
 * recording is off entirely; autocapture is limited to click/submit so no
 * input value can ever be captured, and masks every element's text and
 * attributes, since a clicked card or button can show a title or prose.
 * Pageviews go only through screen(), called explicitly by the app, so
 * every page view is also a typed event. Super properties survive reset(),
 * which would otherwise clear them.
 */
export function createPostHogWebAdapter(config: PostHogWebConfig): AnalyticsAdapter {
  posthog.init(config.apiKey, {
    api_host: config.apiHost,
    disable_session_recording: true,
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: { dom_event_allowlist: ["click", "submit"] },
    mask_all_text: true,
    mask_all_element_attributes: true,
    person_profiles: "identified_only",
  });

  let superProperties: SuperProperties = {};

  return {
    identify(userId: string, properties?: PersonProperties): void {
      posthog.identify(userId, properties);
    },
    reset(): void {
      posthog.reset();
      posthog.register(superProperties);
    },
    track<E extends EventName>(event: E, properties: Record<string, unknown>): void {
      posthog.capture(event, properties);
    },
    screen(name: string, properties?: Record<string, unknown>): void {
      posthog.capture("$pageview", { $screen_name: name, ...properties });
    },
    registerSuperProperties(properties: SuperProperties): void {
      superProperties = { ...superProperties, ...properties };
      posthog.register(properties);
    },
    setOptedOut(optedOut: boolean): void {
      if (optedOut) posthog.opt_out_capturing();
      else posthog.opt_in_capturing();
    },
    deleteUser(): void {
      // No-op: deleting a person needs a personal API key, which must never
      // reach the browser. Account deletion runs server-side; see
      // src/lib/analytics-server.ts and src/lib/account/delete.ts.
    },
  };
}
