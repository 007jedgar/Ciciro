"use client";

import { useState } from "react";
import Link from "next/link";
import AuthPanel from "@/components/AuthPanel";
import ResendVerificationButton from "@/components/ResendVerificationButton";
import { VERIFY_COPY, type VerifyOutcome } from "@/lib/auth/verify-email-copy";

type Props = {
  token: string;
  initial: VerifyOutcome | "pending";
  user: { email: string; emailVerified: boolean } | null;
};

export default function VerifyEmailConfirm({ token, initial, user }: Props) {
  const [state, setState] = useState<VerifyOutcome | "pending">(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.outcome) {
        setError(data.error || "Something went wrong.");
        return;
      }
      setState(data.outcome);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "pending") {
    return (
      <AuthPanel title="Confirm your email">
        <p className="auth-lede">One tap and this address is confirmed for your Ciciro account.</p>
        <button className="btn primary" type="button" onClick={confirm} disabled={busy}>
          {busy ? "Confirming..." : "Confirm my email"}
        </button>
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
      </AuthPanel>
    );
  }

  // A dead link is moot for someone signed in whose address is already confirmed.
  const outcome = state !== "verified" && user?.emailVerified ? "already_verified" : state;
  const copy = VERIFY_COPY[outcome];
  const ok = outcome === "verified" || outcome === "already_verified";

  return (
    <AuthPanel title={copy.title}>
      <p className="auth-lede" role={ok ? "status" : "alert"}>
        {copy.body}
      </p>
      {ok ? (
        <>
          <Link className="btn primary" href="/">
            {user ? "Back to your manuscripts" : "Open Ciciro"}
          </Link>
          <p className="auth-alt">On your phone? You can go back to the Ciciro app.</p>
        </>
      ) : user && !user.emailVerified ? (
        <ResendVerificationButton email={user.email} />
      ) : (
        <>
          <Link className="btn primary" href="/login">
            Sign in to send a new link
          </Link>
          <p className="auth-alt">Then choose Resend under Account in settings.</p>
        </>
      )}
    </AuthPanel>
  );
}
