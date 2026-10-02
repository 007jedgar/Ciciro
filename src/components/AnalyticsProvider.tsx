"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getAnalytics } from "@/lib/analytics-client";
import { followIdentity, trackScreenView } from "@/lib/analytics-events";
import { useSettings } from "@/components/SettingsProvider";
import { SETTINGS_SYNC_EVENT } from "@/lib/settings";

// Must match AUTH_EVENT_PARAM / AUTH_PROVIDER_PARAM in src/lib/auth/social-sign-in.ts
// (a server-only module this client component cannot import).
const AUTH_EVENT_PARAM = "auth_event";
const AUTH_PROVIDER_PARAM = "auth_provider";

// The last account identified in this browser, so a sign-out in another
// tab, or a session that lapsed between visits, still resets on the next
// load. An anonymous visitor is never reset (see followIdentity).
const IDENTITY_KEY = "ciciro.analytics.identity";

function storedIdentity(): string | null {
  try {
    return window.localStorage.getItem(IDENTITY_KEY);
  } catch {
    return null;
  }
}

function storeIdentity(userId: string | null): void {
  try {
    if (userId) window.localStorage.setItem(IDENTITY_KEY, userId);
    else window.localStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* storage unavailable */
  }
}

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
  // Screen tracking waits until /api/auth/me first answers, so "/" is not
  // counted as landing for a signed-in author before their identity is
  // known. Later sign-in changes only update the ref: a screen view is
  // keyed on the route, so signing in or out on the same page records none.
  const [identityResolved, setIdentityResolved] = useState(false);
  const signedIn = useRef(false);

  useEffect(() => {
    let active = true;
    async function syncIdentity() {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        const userId = typeof data.user?.id === "string" ? (data.user.id as string) : null;
        signedIn.current = userId !== null;
        setIdentityResolved(true);
        storeIdentity(followIdentity(getAnalytics(), storedIdentity(), userId));
      } catch {
        if (active) setIdentityResolved(true);
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
    if (!identityResolved) return;
    return trackScreenView(getAnalytics(), screenNameForPath(pathname, signedIn.current));
  }, [pathname, identityResolved]);

  return null;
}
