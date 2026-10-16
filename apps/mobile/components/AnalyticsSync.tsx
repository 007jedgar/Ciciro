import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { usePathname } from "expo-router";
import { getAnalytics, setAnalyticsConsent } from "../lib/analytics-client";
import { trackScreenView, type ScreenView } from "../lib/analytics-events";
import { deviceAnalyticsAllowed, effectiveAnalyticsAllowed, useConsent } from "../lib/consent";
import { refreshRegion, refreshRegionIfStale, useConsentMode } from "../lib/consent-region-store";
import type { AppActiveListener } from "../lib/sync-engine";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";

/**
 * Pauses the active screen view while backgrounded, resumes it in the
 * foreground - so hours backgrounded never inflate the next screen's
 * duration, and the screen open when the app is killed is not lost. Takes
 * the listener as a parameter (like listenWhenActive in sync-engine.ts) so
 * it is testable without mocking react-native's AppState module.
 */
export function pauseResumeOnAppState(
  appState: AppActiveListener,
  onBackground: () => void,
  onForeground: () => void
): () => void {
  const sub = appState.addEventListener("change", (status) => {
    if (status === "active") onForeground();
    else if (isBackgrounded(status)) onBackground();
  });
  return () => sub.remove();
}

/** Whether an AppState status counts as backgrounded for pauseResumeOnAppState. */
export function isBackgrounded(currentState: string): boolean {
  return currentState === "background" || currentState === "inactive";
}

/**
 * Canonical screen name for a route, for "time on screen" and feature-usage
 * breakdowns in PostHog. Mirrors src/components/AnalyticsProvider.tsx's web
 * mapping onto this app's own expo-router routes.
 */
function screenNameForPath(pathname: string): string {
  if (pathname === "/" || pathname === "/index") return "library";
  if (pathname === "/manuscripts") return "manuscripts";
  if (pathname === "/login") return "login";
  if (pathname === "/signup") return "signup";
  if (pathname === "/forgot-password") return "forgot_password";
  if (pathname === "/paywall") return "paywall";
  if (pathname === "/settings") return "settings";
  if (pathname === "/delete-account") return "delete_account";
  if (pathname === "/writing-reminder" || pathname === "/writing-reminders") return "writing_reminder";
  if (pathname === "/word-goal") return "word_goal";
  if (pathname === "/writing-history") return "writing_history";
  if (pathname.includes("/project/")) {
    if (pathname.endsWith("/ciciro")) return "chat";
    if (pathname.endsWith("/manuscript")) return "editor";
    if (pathname.endsWith("/chapters")) return "chapters";
    if (pathname.endsWith("/outline")) return "outline";
    if (pathname.endsWith("/search")) return "search";
    if (pathname.endsWith("/weekly-review")) return "weekly_review";
    if (pathname.endsWith("/sprint")) return "sprint";
    if (pathname.endsWith("/listen")) return "read_aloud";
    if (pathname.endsWith("/beta-readers")) return "beta_readers";
    if (pathname.endsWith("/share-links")) return "share_links";
    if (pathname.includes("/bible")) return "story_bible";
    if (pathname.includes("/scratch")) return "scratchpad";
    if (pathname.includes("/history/")) return "version_history";
    return "project_overview";
  }
  const trimmed = pathname.replace(/^\//, "");
  return trimmed || "home";
}

/**
 * Honors the device's analytics consent (lib/consent.ts, whose default for a
 * device with no decision depends on where it is: lib/consent-region.ts) and
 * the account's `analyticsEnabled` setting - effective analytics requires
 * both - and tracks a screen view with duration on every route change. Identify/reset
 * lives in lib/session.tsx, next to the matching RevenueCat wiring. See
 * docs/analytics.md.
 */
export function AnalyticsSync() {
  const pathname = usePathname();
  const { settings } = useAppTheme();
  const { user } = useSession();
  const consent = useConsent();
  const { mode } = useConsentMode();
  const activeScreen = useRef<ScreenView | null>(null);

  // Where the device is decides whether analytics defaults on (lib/consent-region.ts):
  // look it up at launch, and again on a foreground return when the last look is old.
  useEffect(() => {
    void refreshRegion();
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") void refreshRegionIfStale();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const allowed = effectiveAnalyticsAllowed({
      record: consent,
      mode,
      signedIn: !!user,
      accountEnabled: settings.analyticsEnabled,
    });
    // The device's own answer decides whether the real client exists (and so
    // keeps the signed-in identity); the account only opts it in or out, and
    // a client built while the account says off is never opted in even for a
    // moment (an opt-in can itself be an event).
    setAnalyticsConsent(deviceAnalyticsAllowed(consent, mode), allowed, user?.id ?? null);
    getAnalytics().setOptedOut(!allowed);
  }, [consent, mode, user, settings.analyticsEnabled]);

  useEffect(() => {
    const screen = screenNameForPath(pathname);
    const view = trackScreenView(
      getAnalytics(),
      screen,
      undefined,
      Date.now,
      isBackgrounded(AppState.currentState)
    );
    activeScreen.current = view;
    return () => {
      view.leave();
      if (activeScreen.current === view) activeScreen.current = null;
    };
  }, [pathname]);

  useEffect(
    () =>
      pauseResumeOnAppState(
        AppState,
        () => activeScreen.current?.pause(),
        () => activeScreen.current?.resume()
      ),
    []
  );

  return null;
}
