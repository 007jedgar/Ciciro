// The vendor-neutral analytics contract: the event catalog, person/screen
// property shapes, and the AnalyticsAdapter interface every provider (and the
// in-memory fake used in tests) implements. App and business code imports
// only this file and never a vendor SDK directly - swapping PostHog for
// another provider means writing one new adapter per platform, never
// touching a call site. See docs/analytics.md.
//
// Must stay byte-for-byte identical to apps/mobile/lib/analytics-events.ts.
// The Next app and the Expo app cannot share a build, so the parity test
// (test/analytics-events-parity.test.ts) compares the two files. If it
// fails, fix the file, not the test.
//
// No manuscript text, chat content, titles, or other author prose belongs in
// any event or property here, ever - see docs/analytics.md.

export type Platform = "web" | "ios" | "android";
export type SignupMethod = "email" | "apple" | "google";

/** Standard person properties, set (or refreshed) on identify(). */
export type PersonProperties = {
  platform?: Platform;
  appVersion?: string;
  plan?: string;
  signupDate?: string;
  signupMethod?: SignupMethod;
};

/** Properties stamped on every event from this process: see registerSuperProperties. */
export type SuperProperties = {
  platform?: Platform;
  appVersion?: string;
  release?: string;
};

type NoProperties = Record<string, never>;

/**
 * The event catalog: every distinct event this product emits, with its typed
 * properties. This is the single source of truth for "what can be tracked" -
 * add an event here before firing it anywhere. See docs/analytics.md for the
 * tracking plan (which metric each event answers) and the feature inventory.
 */
export type EventCatalog = {
  // Identity / lifecycle
  account_created: { method: SignupMethod; platform: Platform };
  signed_in: { method: SignupMethod; platform: Platform };
  signed_out: NoProperties;

  // Conversion / click-through
  cta_clicked: { cta: string; surface: string; source?: string };
  paywall_viewed: { surface: string; plan?: string };
  paywall_cta_clicked: { surface: string; plan?: string };
  checkout_started: { plan: string };
  purchase_cancelled: { surface: string };
  subscription_purchased: {
    plan: string;
    platform: Platform;
    interval?: "month" | "year";
    priceCents?: number;
    currency?: string;
  };
  subscription_renewed: { plan: string; platform: Platform; interval?: "month" | "year" };
  subscription_canceled: { plan: string; platform: Platform };

  // Manuscript lifecycle
  project_created: { kind: string; isFirstProject: boolean };
  reminder_enabled: NoProperties;
  reminder_disabled: NoProperties;

  // Feature usage - one event per distinct feature, see docs/analytics.md
  chat_message_sent: NoProperties;
  quick_action_used: { action: string; kind: string };
  autowrite_used: NoProperties;
  suggestion_accepted: NoProperties;
  suggestion_rejected: NoProperties;
  continuity_check_run: NoProperties;
  repetition_report_viewed: NoProperties;
  weekly_review_viewed: NoProperties;
  search_performed: NoProperties;
  share_link_created: NoProperties;
  export_completed: { format: "epub" | "pdf" | "markdown" | "docx" };
  snapshot_restored: NoProperties;
  writing_sprint_completed: { durationMinutes?: number };
  outline_reordered: NoProperties;
  story_bible_edited: { file: "canon" | "plot" | "style" | "timeline" };
  character_created: NoProperties;
  social_sign_in_used: { provider: "apple" | "google" };
  dictation_used: NoProperties;
  read_aloud_used: NoProperties;
  focus_mode_used: NoProperties;
  import_completed: { source: string };
  style_analysis_viewed: NoProperties;
  recap_viewed: NoProperties;
  scratchpad_used: NoProperties;

  // Account data. Deletion has no event: see AnalyticsAdapter.deleteUser
  // below - the person record is asked to be forgotten, not tracked once more.
  account_exported: NoProperties;

  // Notifications and server-confirmed AI runs
  push_notification_opened: { type: string };
  run_completed: { surface: string; status: string };

  // Screens (see trackScreenView below)
  screen_duration: { screen: string; durationMs: number };
};

export type EventName = keyof EventCatalog;
export type EventProperties<E extends EventName> = EventCatalog[E];

/**
 * The provider-agnostic analytics interface. App and business code imports
 * only this - never posthog-js, posthog-react-native, or any other vendor
 * SDK. A new provider is a new class implementing this interface plus
 * configuration; call sites never change.
 */
export interface AnalyticsAdapter {
  /** Identify the signed-in user by internal id only - never email or name. */
  identify(userId: string, properties?: PersonProperties): void;
  /** Forget the current identity. Call on sign-out, before any next identify(). */
  reset(): void;
  /** Record one typed event. */
  track<E extends EventName>(event: E, properties: EventProperties<E>): void;
  /** Record a screen or page view. */
  screen(name: string, properties?: Record<string, unknown>): void;
  /** Properties stamped on every subsequent event (platform, app version, release). */
  registerSuperProperties(properties: SuperProperties): void;
  /** Honor the user's analytics opt-out/in choice. */
  setOptedOut(optedOut: boolean): void;
  /**
   * Ask the provider to forget this person, for account deletion
   * (AGENTS.md "Account data"). Fire-and-forget and best-effort: a provider
   * with nothing to delete, or no deletion API configured, no-ops.
   */
  deleteUser(userId: string): void;
}

/** Does nothing. The default adapter when no provider is configured. */
export class NoopAnalyticsAdapter implements AnalyticsAdapter {
  identify(): void {}
  reset(): void {}
  track(): void {}
  screen(): void {}
  registerSuperProperties(): void {}
  setOptedOut(): void {}
  deleteUser(): void {}
}

export type RecordedIdentify = { userId: string; properties?: PersonProperties };
export type RecordedTrack = { event: EventName; properties: Record<string, unknown> };
export type RecordedScreen = { name: string; properties?: Record<string, unknown> };

/**
 * An in-memory adapter for tests: records every call instead of sending it
 * anywhere. Running the catalog through this (and nothing else) is how
 * test/analytics-events-parity.test.ts and the provider-swap test prove call
 * sites depend only on AnalyticsAdapter, never on PostHog.
 */
export class MemoryAnalyticsAdapter implements AnalyticsAdapter {
  identifies: RecordedIdentify[] = [];
  resetCount = 0;
  tracks: RecordedTrack[] = [];
  screens: RecordedScreen[] = [];
  superProperties: SuperProperties = {};
  optedOut = false;
  deletedUserIds: string[] = [];

  identify(userId: string, properties?: PersonProperties): void {
    this.identifies.push({ userId, properties });
  }
  reset(): void {
    this.resetCount += 1;
  }
  track<E extends EventName>(event: E, properties: EventProperties<E>): void {
    this.tracks.push({ event, properties: properties as Record<string, unknown> });
  }
  screen(name: string, properties?: Record<string, unknown>): void {
    this.screens.push({ name, properties });
  }
  registerSuperProperties(properties: SuperProperties): void {
    this.superProperties = { ...this.superProperties, ...properties };
  }
  setOptedOut(optedOut: boolean): void {
    this.optedOut = optedOut;
  }
  deleteUser(userId: string): void {
    this.deletedUserIds.push(userId);
  }
}

/**
 * Track a screen view and return a function to call when the screen is left,
 * which records its view duration (screen_duration). Shared by web (route
 * changes) and mobile (navigation state changes) so "average time per
 * screen" is queryable the same way on both platforms. Safe to call the
 * returned function more than once; only the first call records.
 */
export function trackScreenView(
  adapter: AnalyticsAdapter,
  screen: string,
  properties?: Record<string, unknown>,
  now: () => number = Date.now
): () => void {
  const startedAt = now();
  adapter.screen(screen, properties);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    adapter.track("screen_duration", { screen, durationMs: Math.max(0, now() - startedAt) });
  };
}
