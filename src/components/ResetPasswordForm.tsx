"use client";

import { useState } from "react";
import Link from "next/link";
import AuthPanel from "@/components/AuthPanel";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/constants";

export default function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkDead, setLinkDead] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/password/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        setLinkDead(Boolean(data.problem));
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthPanel title="Password changed">
        <p className="auth-lede" role="status">
          Your new password is set. For safety, every device that was signed in has been signed
          out, so sign in again with the new password on each one.
        </p>
        <Link className="btn primary" href="/login">
          Sign in
        </Link>
      </AuthPanel>
    );
  }

  return (
    <AuthPanel title="Choose a new password" onSubmit={submit}>
      <p className="auth-lede">
        For <strong>{email}</strong>. Setting it signs you out on every device.
      </p>
      {/* Lets password managers file the new password under the right account. */}
      <input type="email" name="email" value={email} autoComplete="username" readOnly hidden />
      <input
        aria-label="New password"
        type="password"
        placeholder={`New password (${MIN_PASSWORD_LENGTH}+ characters)`}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        autoFocus
        required
      />
      <input
        aria-label="Confirm new password"
        type="password"
        placeholder="Confirm new password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
        required
      />
      {error && (
        <p className="auth-error" role="alert">
          {error}
          {linkDead ? (
            <>
              {" "}
              <Link href="/forgot-password">Get a new link</Link>
            </>
          ) : null}
        </p>
      )}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? "Saving..." : "Set new password"}
      </button>
    </AuthPanel>
  );
}
