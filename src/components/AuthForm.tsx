"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import BrandMark from "@/components/BrandMark";
import SocialButtons from "@/components/SocialButtons";
import ThemeToggle from "@/components/ThemeToggle";
import { safeNext } from "@/lib/auth/constants";
import type { SocialProvider } from "@/lib/auth/social-config";
import { SETTINGS_SYNC_EVENT } from "@/lib/settings";
import { getAnalytics } from "@/lib/analytics-client";

type Mode = "login" | "signup";

const COPY: Record<
  Mode,
  { title: string; action: string; endpoint: string; alt: string; altHref: string; altLabel: string }
> = {
  login: {
    title: "Sign in to Ciciro",
    action: "Sign in",
    endpoint: "/api/auth/login",
    alt: "New here?",
    altHref: "/signup",
    altLabel: "Create an account",
  },
  signup: {
    title: "Create your Ciciro account",
    action: "Create account",
    endpoint: "/api/auth/signup",
    alt: "Already have an account?",
    altHref: "/login",
    altLabel: "Sign in",
  },
};

// `?error=` from a failed Apple / Google sign-in (SocialFailure on the server).
const SOCIAL_ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in expired or started in another window. Try again.",
  unavailable: "That sign-in option is not set up yet.",
  failed: "Could not sign you in. Try again.",
  no_email: "Your account did not share an email address, so Ciciro cannot create an account.",
  unverified_email: "Verify your email address with the provider, then try again.",
};

export default function AuthForm({
  mode,
  providers,
}: {
  mode: Mode;
  providers: Record<SocialProvider, boolean>;
}) {
  const params = useSearchParams();
  const copy = COPY[mode];
  const socialError = params.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [error, setError] = useState<string | null>(
    socialError ? (SOCIAL_ERRORS[socialError] ?? SOCIAL_ERRORS.failed) : null
  );
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get("next"));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(copy.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify(
          mode === "signup" ? { email, password, name, marketingOptIn } : { email, password }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setBusy(false);
        return;
      }
      const userId = data?.user?.id as string | undefined;
      if (userId) {
        // account_created fires server-side (see /api/auth/signup), where it
        // cannot be lost to an ad blocker or a closed tab. The client only
        // identifies and marks the session as started.
        const analytics = getAnalytics();
        analytics.identify(userId);
        analytics.track("signed_in", { method: "email", platform: "web" });
      }
      window.dispatchEvent(new Event(SETTINGS_SYNC_EVENT));
      window.location.assign(next);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <ThemeToggle className="auth-theme-toggle" />
      <form className="auth-card" onSubmit={submit}>
        <BrandMark size={56} />
        <h1>{copy.title}</h1>
        <SocialButtons providers={providers} next={next} marketingOptIn={mode === "signup" ? marketingOptIn : false} />
        {mode === "signup" && (
          <input
            aria-label="Name"
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        )}
        <input
          aria-label="Email"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <input
          aria-label="Password"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
        />
        {mode === "login" && (
          <Link
            className="auth-forgot"
            href={email.trim() ? `/forgot-password?email=${encodeURIComponent(email.trim())}` : "/forgot-password"}
          >
            Forgot password?
          </Link>
        )}
        {mode === "signup" && (
          <label className="auth-checkbox">
            <input
              type="checkbox"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.target.checked)}
            />
            <span>Send me writing tips and product news. You can turn this off anytime in Settings.</span>
          </label>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Working..." : copy.action}
        </button>
        <p className="auth-alt">
          {copy.alt} <Link href={copy.altHref}>{copy.altLabel}</Link>
        </p>
      </form>
    </div>
  );
}
