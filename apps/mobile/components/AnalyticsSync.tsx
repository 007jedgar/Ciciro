import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { usePathname } from "expo-router";
import { getAnalytics } from "../lib/analytics-client";
import { trackScreenView, type ScreenView } from "../lib/analytics-events";
import type { AppActiveListener } from "../lib/sync-engine";
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
    else if (status === "background" || status === "inactive") onBackground();
  });
  return () => sub.remove();
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
 * Honors the analytics opt-out setting and tracks a screen view with
 * duration on every route change. Identify/reset lives in lib/session.tsx,
 * next to the matching RevenueCat wiring. See docs/analytics.md.
 */
export function AnalyticsSync() {
  const pathname = usePathname();
  const { settings } = useAppTheme();
  const activeScreen = useRef<ScreenView | null>(null);

  useEffect(() => {
    getAnalytics().setOptedOut(!settings.analyticsEnabled);
  }, [settings.analyticsEnabled]);

  useEffect(() => {
    const screen = screenNameForPath(pathname);
    const view = trackScreenView(getAnalytics(), screen);
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
