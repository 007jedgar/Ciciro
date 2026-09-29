"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AuthPanel from "@/components/AuthPanel";

export default function ForgotPasswordForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      setSentTo(email.trim());
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <AuthPanel title="Check your email">
        <p className="auth-lede" role="status">
          If <strong>{sentTo}</strong> has a Ciciro account, a link to choose a new password is on
          its way. It works for 1 hour.
        </p>
        <p className="auth-lede">Nothing there after a few minutes? Check spam, or try again.</p>
        <Link className="btn primary" href="/login">
          Back to sign in
        </Link>
        <p className="auth-alt">
          <button type="button" className="auth-link-button" onClick={() => setSentTo(null)}>
            Use a different email
          </button>
        </p>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title="Reset your password" onSubmit={submit}>
      <p className="auth-lede">
        Enter the email you signed up with and we&apos;ll send you a link to choose a new password.
      </p>
      <input
        aria-label="Email"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        autoFocus
        required
      />
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? "Sending..." : "Send reset link"}
      </button>
      <p className="auth-alt">
        Remembered it? <Link href="/login">Sign in</Link>
      </p>
    </AuthPanel>
  );
}
