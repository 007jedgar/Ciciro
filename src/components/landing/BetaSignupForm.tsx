"use client";

import { useRef, useState } from "react";
import { BETA } from "./copy";

type Status = "idle" | "sending" | "done";

// Same shape the server accepts (normalizeEmail in src/lib/auth/tokens.ts);
// the server stays the authority.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The landing page's iOS TestFlight beta signup: one email, no account. */
export default function BetaSignupForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const honeypot = useRef<HTMLInputElement>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;
    const value = email.trim();
    if (!LOOKS_LIKE_EMAIL.test(value)) {
      setError(BETA.invalid);
      input.current?.focus();
      return;
    }
    setError(null);
    setStatus("sending");
    try {
      const res = await fetch("/api/beta-signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value, source: "landing", website: honeypot.current?.value ?? "" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: unknown };
        setStatus("idle");
        setError(typeof body.error === "string" ? body.error : BETA.failure);
        return;
      }
      setStatus("done");
    } catch {
      setStatus("idle");
      setError(BETA.failure);
    }
  }

  if (status === "done") {
    return (
      <p className="landing-beta-form landing-beta-success" role="status">
        {BETA.success}
      </p>
    );
  }

  const errorId = "landing-beta-error";
  return (
    <form className="landing-beta-form" onSubmit={submit} noValidate>
      <label htmlFor="landing-beta-email" className="landing-beta-label">
        {BETA.label}
      </label>
      <div className="landing-beta-row">
        <input
          ref={input}
          id="landing-beta-email"
          className="landing-beta-input"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          placeholder={BETA.placeholder}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          required
        />
        <button type="submit" className="landing-btn" disabled={status === "sending"} aria-busy={status === "sending"}>
          {status === "sending" ? BETA.submitting : BETA.submit}
        </button>
      </div>
      {/* Honeypot: hidden from people and assistive tech; bots fill it in. */}
      <div className="landing-beta-trap" aria-hidden>
        <label>
          Website
          <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <p id={errorId} className="landing-beta-error" role="alert">
        {error}
      </p>
    </form>
  );
}
