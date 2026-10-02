import type { AnalyticsAdapter, EventName, PersonProperties, SuperProperties } from "@/lib/analytics-events";
import { waitUntilRequest } from "@/lib/db";

// The PostHog adapter for server-side sends (webhooks, signup, run
// completion): plain fetch to the capture HTTP API, no SDK, so it runs
// unmodified on Cloudflare Workers. Only src/lib/analytics-server.ts
// constructs this. See docs/analytics.md.

export type PostHogServerConfig = {
  apiKey: string;
  apiHost: string;
  /** Override for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

type CaptureBody = {
  api_key: string;
  event: string;
  distinct_id: string;
  properties?: Record<string, unknown>;
  timestamp: string;
};

/**
 * A fresh instance per unit of work (see src/lib/analytics-server.ts) - never
 * a shared singleton, since its identify() state must never leak between
 * concurrent requests sharing a Worker isolate. Every send is fire-and-forget
 * through waitUntilRequest and swallows its own errors: it must never block
 * or fail the request that triggered it.
 */
export function createPostHogServerAdapter(config: PostHogServerConfig): AnalyticsAdapter {
  const fetchImpl = config.fetchImpl ?? fetch;
  let distinctId: string | null = null;
  let superProperties: SuperProperties = {};

  function send(event: string, properties: Record<string, unknown>): void {
    if (!distinctId) return;
    const body: CaptureBody = {
      api_key: config.apiKey,
      event,
      distinct_id: distinctId,
      properties: { ...superProperties, ...properties },
      timestamp: new Date().toISOString(),
    };
    const promise = fetchImpl(`${config.apiHost}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(() => undefined)
      .catch((error: unknown) => {
        console.error("[analytics] server capture failed", error);
      });
    waitUntilRequest(promise);
  }

  return {
    identify(userId: string, properties?: PersonProperties): void {
      distinctId = userId;
      if (properties && Object.keys(properties).length > 0) {
        send("$identify", { $set: properties });
      }
    },
    reset(): void {
      distinctId = null;
    },
    track<E extends EventName>(event: E, properties: Record<string, unknown>): void {
      send(event, properties);
    },
    screen(name: string, properties?: Record<string, unknown>): void {
      send("$pageview", { $screen_name: name, ...properties });
    },
    registerSuperProperties(properties: SuperProperties): void {
      superProperties = { ...superProperties, ...properties };
    },
    setOptedOut(): void {
      // No-op here: call sites check analyticsOptedOut() before constructing
      // and using an adapter at all (see src/lib/analytics-server.ts).
    },
  };
}
