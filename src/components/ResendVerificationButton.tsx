"use client";

import { useState } from "react";
import { resendVerificationEmail } from "@/lib/verify-email-client";

/** "Send a new link" for a signed-in author whose verification link failed. */
export default function ResendVerificationButton({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState("busy");
    setError(null);
    const result = await resendVerificationEmail();
    if (result.ok) {
      setState("sent");
      return;
    }
    setError(result.message);
    setState("idle");
  }

  if (state === "sent") {
    return (
      <p className="auth-lede" role="status">
        A new link is on its way to <strong>{email}</strong>.
      </p>
    );
  }
  return (
    <>
      <button className="btn primary" type="button" onClick={send} disabled={state === "busy"}>
        {state === "busy" ? "Sending..." : "Send a new link"}
      </button>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
