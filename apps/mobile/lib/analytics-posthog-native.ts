import PostHog from "posthog-react-native";
import type { PostHogEventProperties } from "@posthog/core";
import type { AnalyticsAdapter, PersonProperties, SuperProperties } from "./analytics-events";

function asEventProperties(properties?: Record<string, unknown>): PostHogEventProperties | undefined {
  return properties as PostHogEventProperties | undefined;
}

// The PostHog adapter for the phone. Only lib/analytics-client.ts constructs
// this; nothing else in the app imports posthog-react-native directly. See
// docs/analytics.md.
//
// No PostHogProvider: posthog-react-native supports a standalone client
// (its own docs recommend this when you don't want the provider), which
// keeps this adapter usable from plain lib modules, not only components.

export type PostHogNativeConfig = {
  apiKey: string;
  apiHost: string;
};

/**
 * Construct the posthog-react-native client and wrap it as an
 * AnalyticsAdapter. Session replay is never enabled (it defaults off and
 * nothing here turns it on); autocapture covers taps only.
 */
export function createPostHogNativeAdapter(config: PostHogNativeConfig): AnalyticsAdapter {
  const client = new PostHog(config.apiKey, {
    host: config.apiHost,
    captureAppLifecycleEvents: true,
  });

  return {
    identify(userId: string, properties?: PersonProperties): void {
      client.identify(userId, properties);
    },
    reset(): void {
      client.reset();
    },
    track(event: string, properties: Record<string, unknown>): void {
      client.capture(event, asEventProperties(properties));
    },
    screen(name: string, properties?: Record<string, unknown>): void {
      void client.screen(name, asEventProperties(properties));
    },
    registerSuperProperties(properties: SuperProperties): void {
      void client.register(properties);
    },
    setOptedOut(optedOut: boolean): void {
      if (optedOut) void client.optOut();
      else void client.optIn();
    },
    deleteUser(): void {
      // No-op: deleting a person needs a personal API key, which must never
      // ship in the app bundle. Account deletion runs server-side; see
      // src/lib/analytics-server.ts and src/lib/account/delete.ts.
    },
  };
}
