import { useEffect } from "react";
import { usePathname } from "expo-router";
import { getAnalytics } from "../lib/analytics-client";
import { trackScreenView } from "../lib/analytics-events";
import { useAppTheme } from "../lib/settings";

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

  useEffect(() => {
    getAnalytics().setOptedOut(!settings.analyticsEnabled);
  }, [settings.analyticsEnabled]);

  useEffect(() => {
    const screen = screenNameForPath(pathname);
    return trackScreenView(getAnalytics(), screen);
  }, [pathname]);

  return null;
}
