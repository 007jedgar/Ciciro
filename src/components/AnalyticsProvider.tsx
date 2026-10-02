"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getAnalytics } from "@/lib/analytics-client";
import { trackScreenView } from "@/lib/analytics-events";
import { useSettings } from "@/components/SettingsProvider";
import { SETTINGS_SYNC_EVENT } from "@/lib/settings";

// Must match AUTH_EVENT_PARAM / AUTH_PROVIDER_PARAM in src/lib/auth/social-sign-in.ts
// (a server-only module this client component cannot import).
const AUTH_EVENT_PARAM = "auth_event";
const AUTH_PROVIDER_PARAM = "auth_provider";

type Me = { id: string } | null;

/**
 * Canonical screen name for a route, for "time on screen" and feature-usage
 * breakdowns in PostHog. "/" renders Landing or Library depending on
 * whether the visitor is signed in (src/lib/home.ts), so the two need the
 * caller's own signed-in state to tell apart.
 */
function screenNameForPath(pathname: string, signedIn: boolean): string {
  if (pathname === "/") return signedIn ? "library" : "landing";
  if (pathname.startsWith("/project/")) return "editor";
  if (pathname === "/pricing") return "paywall";
  if (pathname === "/login") return "login";
  if (pathname === "/signup") return "signup";
  if (pathname === "/forgot-password") return "forgot_password";
  if (pathname === "/reset-password") return "reset_password";
  if (pathname === "/verify-email") return "verify_email";
  if (pathname === "/account/delete") return "delete_account";
  if (pathname === "/changelog") return "changelog";
  if (pathname.startsWith("/read/")) return "shared_manuscript";
  if (pathname.startsWith("/email/preferences")) return "email_preferences";
  const trimmed = pathname.replace(/^\//, "");
  return trimmed || "home";
}

/**
 * Mounts analytics identity (identify on sign-in, reset on sign-out), honors
 * the analytics opt-out setting, and tracks a screen view with duration on
 * every route change. See docs/analytics.md.
 */
export default function AnalyticsProvider() {
  const { settings } = useSettings();
  const pathname = usePathname();
  const [me, setMe] = useState<Me>(null);

  useEffect(() => {
    let active = true;
    async function syncIdentity() {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        const user = (data.user ?? null) as Me;
        setMe(user);
        if (user) getAnalytics().identify(user.id);
        else getAnalytics().reset();
      } catch {
        /* offline */
      }
    }
    void syncIdentity();
    window.addEventListener(SETTINGS_SYNC_EVENT, syncIdentity);
    return () => {
      active = false;
      window.removeEventListener(SETTINGS_SYNC_EVENT, syncIdentity);
    };
  }, []);

  useEffect(() => {
    getAnalytics().setOptedOut(!settings.analyticsEnabled);
  }, [settings.analyticsEnabled]);

  // The one-time ?auth_event=&auth_provider= pair a social sign-in redirect
  // leaves on the landing URL, since that flow finishes server-side with no
  // client fetch() to fire from (see social-sign-in.ts). account_created
  // itself fires server-side only (finishBrowserSignIn), so the client here
  // just identifies the session as started, for both a new and a returning
  // account.
  useEffect(() => {
    const url = new URL(window.location.href);
    const event = url.searchParams.get(AUTH_EVENT_PARAM);
    const providerParam = url.searchParams.get(AUTH_PROVIDER_PARAM);
    if (event !== "account_created" && event !== "signed_in") return;
    url.searchParams.delete(AUTH_EVENT_PARAM);
    url.searchParams.delete(AUTH_PROVIDER_PARAM);
    window.history.replaceState(window.history.state, "", url);
    const provider = providerParam === "apple" || providerParam === "google" ? providerParam : "google";
    getAnalytics().track("signed_in", { method: provider, platform: "web" });
    getAnalytics().track("social_sign_in_used", { provider });
  }, []);

  useEffect(() => {
    const screen = screenNameForPath(pathname, me !== null);
    return trackScreenView(getAnalytics(), screen);
  }, [pathname, me]);

  return null;
}
