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

/** Why a subscription stopped being set to renew: see subscription_canceled. */
export type CancelReason = "voluntary" | "billing_failure" | "immediate" | "refund" | "other";
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
  // Two distinct moments, not one: subscription_canceled is "this
  // subscription just stopped being set to renew" (store CANCELLATION; Stripe
  // customer.subscription.updated newly scheduling an end, or
  // customer.subscription.deleted with no end scheduled beforehand, where it
  // shares the instant with subscription_ended). `reason` says why.
  // subscription_ended is "access is actually gone now" (store EXPIRATION;
  // Stripe customer.subscription.deleted). See docs/analytics.md.
  subscription_canceled: { plan: string; platform: Platform; reason: CancelReason };
  subscription_ended: { plan: string; platform: Platform };

  // Manuscript lifecycle
  project_created: { kind: string; isFirstProject: boolean };
  reminder_enabled: NoProperties;
  reminder_disabled: NoProperties;

  // Feature usage - one event per distinct feature, see docs/analytics.md
  chat_message_sent: NoProperties;
  quick_action_used: { action: string; kind: string };
  // The menu over highlighted text: `action` is the button pressed and `target`
  // whether one word or a passage was selected. Never the text itself.
  selection_action_used: {
    action: "comment" | "rewrite" | "describe" | "expand" | "fix";
    target: "word" | "passage";
  };
  // A synonym swapped in for the highlighted word; `more` when it came from the overflow list.
  synonym_used: { more: boolean };
  autowrite_used: NoProperties;
  suggestion_accepted: NoProperties;
  suggestion_rejected: NoProperties;
  continuity_check_run: NoProperties;
  repetition_report_viewed: NoProperties;
  weekly_review_viewed: NoProperties;
  search_performed: NoProperties;
  share_link_created: NoProperties;
  export_completed: { format: "epub" | "pdf" | "markdown" | "docx" | "fountain" | "fdx" };
  snapshot_restored: NoProperties;
  writing_sprint_completed: { durationMinutes?: number };
  // A manuscript's deadline (mobile). Counts only, never the title or any text: `daysAhead` is whole days from today to the due date.
  deadline_saved: { created: boolean; daysAhead: number };
  deadline_removed: NoProperties;
  deadline_met: NoProperties;
  // The guided Observe / React / Narrate exercise (mobile). No author text: the exercise id and a whole-minute length only.
  writing_exercise_started: { exercise: string };
  writing_exercise_completed: { exercise: string; durationMinutes: number };
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
  state_review_run: NoProperties;
  knowledge_fact_kept: NoProperties;
  knowledge_fact_added: NoProperties;
  knowledge_fact_retired: NoProperties;
  knowledge_fact_replaced: NoProperties;
  knowledge_scrubber_used: NoProperties;
  knowledge_fact_added_via_chat: NoProperties;
  canvas_card_created: NoProperties;
  canvas_generated: { mode: "fill" | "outline" | "options" };

  // Pre-signup onboarding quiz (mobile only for now - see AGENTS.md
  // "Pre-signup onboarding"). No author text in any property.
  onboarding_goal_selected: { kind: string };
  // Comma-separated obstacle ids in tap order (the question takes several).
  onboarding_obstacle_selected: { obstacles: string; count: number };
  onboarding_theme_selected: { theme: string };
  // Whether the person allowed notifications when they created the reminder.
  onboarding_reminder_created: { permission: "granted" | "denied" | "unavailable" };
  onboarding_demo_viewed: { path: string };
  onboarding_demo_completed: { path: string };
  onboarding_skipped: { step: "goal" | "obstacle" | "theme" | "demos" | "reminder" };

  // Account data. Deletion has no event: see AnalyticsAdapter.deleteUser
  // below - the person record is asked to be forgotten, not tracked once more.
  account_exported: NoProperties;

  // Notifications and server-confirmed AI runs
  push_notification_opened: { type: string };
  run_completed: { surface: string; status: string };

  // Screens (see trackScreenView below). One visit can emit several
  // screen_duration events (pause/resume splits it into non-overlapping
  // segments of visible time); all of them share one viewId.
  screen_duration: { screen: string; durationMs: number; viewId: string };
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
  /**
   * Record one typed event. `options.beacon` asks the transport to survive
   * the page or app being torn down right now (e.g. a browser's Beacon API),
   * for an event fired from a visibilitychange/pagehide or backgrounding
   * handler. A provider that has no such concern (server, native) ignores it.
   */
  track<E extends EventName>(event: E, properties: EventProperties<E>, options?: { beacon?: boolean }): void;
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
export type RecordedTrack = {
  event: EventName;
  properties: Record<string, unknown>;
  options?: { beacon?: boolean };
};
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
  track<E extends EventName>(
    event: E,
    properties: EventProperties<E>,
    options?: { beacon?: boolean }
  ): void {
    this.tracks.push({ event, properties: properties as Record<string, unknown>, options });
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
 * Point the adapter at whichever account is signed in now. Identifies a new
 * signed-in id, and resets only when an account actually signs out or
 * switches: an anonymous visitor is never reset, so their activity before
 * signing up stays joined to the account they create. Returns the id to
 * pass as `previous` next time.
 */
export function followIdentity(
  adapter: AnalyticsAdapter,
  previous: string | null,
  next: string | null
): string | null {
  if (previous === next) return next;
  if (previous) adapter.reset();
  if (next) adapter.identify(next);
  return next;
}

let fallbackSeq = 0;

// Hermes has no global crypto, hence the fallback.
function newViewId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const uuid = c?.randomUUID?.();
  if (uuid) return uuid;
  fallbackSeq += 1;
  return `${Date.now().toString(36)}${fallbackSeq.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** A screen view's controls: see trackScreenView. */
export type ScreenView = {
  /** The screen was left for good (route change, unmount). Ends the view. */
  leave: () => void;
  /**
   * The screen is no longer visible but may come back (tab hidden, app
   * backgrounded): commits the duration so far, with a beacon-safe send,
   * since this can fire right before the page or process goes away.
   */
  pause: () => void;
  /** The screen is visible again after a pause: restarts the clock. */
  resume: () => void;
};

/**
 * Track a screen view. Shared by web (route changes) and mobile (navigation
 * state changes) so "average time per screen" is queryable the same way on
 * both platforms.
 *
 * A screen_duration fired only on route change would lose the very last
 * screen of a session (closing a tab or the app never runs that cleanup) and
 * would inflate across any time spent backgrounded (a tab left open
 * overnight). The caller is expected to wire pause()/resume() to its
 * platform's visibility signal (web: visibilitychange/pagehide; mobile:
 * AppState) so each committed segment is actual visible time. Calling
 * leave(), pause(), or resume() out of turn (e.g. leave() twice) is safe and
 * a no-op past the first effective call. Pass startHidden when the screen is
 * already hidden as it starts (a background tab, a backgrounded app): the
 * clock then waits for the first resume().
 */
export function trackScreenView(
  adapter: AnalyticsAdapter,
  screen: string,
  properties?: Record<string, unknown>,
  now: () => number = Date.now,
  startHidden = false
): ScreenView {
  adapter.screen(screen, properties);
  const viewId = newViewId();
  let segmentStart = now();
  let ended = false;
  let paused = startHidden;

  function commit(beacon: boolean): void {
    adapter.track(
      "screen_duration",
      { screen, durationMs: Math.max(0, now() - segmentStart), viewId },
      beacon ? { beacon: true } : undefined
    );
  }

  return {
    leave(): void {
      if (ended) return;
      ended = true;
      if (!paused) commit(false);
    },
    pause(): void {
      if (ended || paused) return;
      paused = true;
      commit(true);
    },
    resume(): void {
      if (ended || !paused) return;
      paused = false;
      segmentStart = now();
    },
  };
}
