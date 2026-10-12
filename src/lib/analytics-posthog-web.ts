import posthog from "posthog-js";
import type { AnalyticsAdapter, EventName, PersonProperties, SuperProperties } from "@/lib/analytics-events";

// The PostHog adapter for the browser. Only src/lib/analytics-client.ts
// constructs this; nothing else in the app imports posthog-js directly. See
// docs/analytics.md.

export type PostHogWebConfig = {
  apiKey: string;
  apiHost: string;
  /**
   * Whether analytics consent is already granted at the moment this adapter
   * is constructed (a returning visitor with a current-version "granted"
   * record). When false (no decision yet, or a rejection), posthog-js is
   * still initialized - this is PostHog's own documented consent posture -
   * but with `persistence: "memory"` and `opt_out_capturing_by_default:
   * true`, so nothing lands in a cookie or localStorage and no event is
   * actually sent until setOptedOut(false) runs. See
   * https://posthog.com/docs/privacy/data-collection and
   * src/lib/analytics-client.ts.
   */
  grantedAtInit: boolean;
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
    persistence: config.grantedAtInit ? "localStorage+cookie" : "memory",
    opt_out_capturing_by_default: !config.grantedAtInit,
  });

  let superProperties: SuperProperties = {};

  return {
    identify(userId: string, properties?: PersonProperties): void {
      posthog.identify(userId, properties);
    },
    reset(): void {
      // reset() returns the SDK to its default consent state
      // (opt_out_capturing_by_default: true means that default is opted
      // out), so this must never run after opt_in_capturing() without a
      // setOptedOut(true) in between - see setOptedOut below and
      // src/lib/analytics-client.ts's withdrawal order.
      posthog.reset();
      posthog.register(superProperties);
    },
    track<E extends EventName>(
      event: E,
      properties: Record<string, unknown>,
      options?: { beacon?: boolean }
    ): void {
      posthog.capture(event, properties, options?.beacon ? { transport: "sendBeacon" } : undefined);
    },
    screen(name: string, properties?: Record<string, unknown>): void {
      posthog.capture("$pageview", { $screen_name: name, ...properties });
    },
    registerSuperProperties(properties: SuperProperties): void {
      superProperties = { ...superProperties, ...properties };
      posthog.register(properties);
    },
    setOptedOut(optedOut: boolean): void {
      if (optedOut) {
        // Stop capture first, then shrink the storage footprint back down -
        // the same memory-only posture as pre-consent init.
        posthog.opt_out_capturing();
        posthog.set_config({ persistence: "memory" });
      } else {
        // Persistence first, then opt in, so the identifiers opt_in_capturing
        // creates land in localStorage+cookie rather than memory.
        posthog.set_config({ persistence: "localStorage+cookie" });
        // No $opt_in event: this runs on every load, not only on a change.
        posthog.opt_in_capturing({ captureEventName: false });
      }
    },
    deleteUser(): void {
      // No-op: deleting a person needs a personal API key, which must never
      // reach the browser. Account deletion runs server-side; see
      // src/lib/analytics-server.ts and src/lib/account/delete.ts.
    },
  };
}

/**
 * Remove every `ph_*` cookie and localStorage key PostHog may have written
 * on this device. Called on consent withdrawal alongside reset(): reset()
 * clears the SDK's in-memory and persisted identifiers, but a GDPR
 * withdrawal needs the keys gone outright, not just reinitialized - see
 * docs/analytics.md's "Opt-in consent" bullet and src/lib/analytics-client.ts.
 */
export function clearPostHogWebStorage(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("ph_")) window.localStorage.removeItem(key);
    }
  } catch {
    /* storage unavailable */
  }
  try {
    for (const pair of document.cookie.split("; ")) {
      const name = pair.split("=")[0];
      if (name?.startsWith("ph_")) document.cookie = `${name}=; Max-Age=0; Path=/`;
    }
  } catch {
    /* ignore */
  }
}
