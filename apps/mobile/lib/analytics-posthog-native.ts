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
 * AnalyticsAdapter. Session replay and autocapture are never enabled
 * (touch autocapture needs PostHogProvider, which this adapter does not
 * use), so only the app's typed events, screens and lifecycle events are
 * sent. Super properties survive reset(), which would otherwise clear them.
 *
 * Only ever constructed after device consent is granted (lib/analytics-client.ts
 * creates it lazily on first consent), so `defaultOptIn: false` is defense
 * in depth, not the only gate - it stops app-lifecycle autocapture from
 * firing before the explicit optIn() below runs.
 *
 * posthog-react-native has a known cold-start race where a *native-side*
 * persisted opt-out/opt-in marker from a previous launch can override the
 * JS `defaultOptIn` config before JS gets a chance to correct it (fixed
 * upstream by a `persistOptOut: false` option that makes JS the sole source
 * of truth - PostHog/posthog-js#4973). As of the pinned ^4.78.4 that option
 * does not exist yet (checked: absent from both the published type
 * declarations and the compiled bundle), so instead of trusting
 * `defaultOptIn` alone, every construction explicitly forces a known state:
 * optOut() right here, unconditionally, on every construction (clearing
 * whatever native marker survived) - the one caller allowed to opt back in
 * (lib/analytics-client.ts's getAnalytics(), only once device consent is
 * granted) does so explicitly afterward, never this constructor, so a
 * legacy-identity sweep (sweepLegacyAnalyticsIdentity, for a "Don't allow"
 * decision on a device with pre-existing PostHog history) can never cause
 * even a momentary opt-in that drains a native-buffered event. Revisit
 * dropping this once `persistOptOut` ships and the package is bumped.
 */
export function createPostHogNativeAdapter(config: PostHogNativeConfig): AnalyticsAdapter {
  const client = new PostHog(config.apiKey, {
    host: config.apiHost,
    captureAppLifecycleEvents: true,
    defaultOptIn: false,
  });
  void client.optOut();

  let superProperties: SuperProperties = {};

  return {
    identify(userId: string, properties?: PersonProperties): void {
      client.identify(userId, properties);
    },
    reset(): void {
      client.reset();
      void client.register(superProperties);
    },
    track(event: string, properties: Record<string, unknown>): void {
      client.capture(event, asEventProperties(properties));
    },
    screen(name: string, properties?: Record<string, unknown>): void {
      void client.screen(name, asEventProperties(properties));
    },
    registerSuperProperties(properties: SuperProperties): void {
      superProperties = { ...superProperties, ...properties };
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
