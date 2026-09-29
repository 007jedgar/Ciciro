// Browser side of POST /api/auth/verify-email/resend.

export type ResendOutcome = { ok: true; alreadyVerified: boolean } | { ok: false; message: string };

export async function resendVerificationEmail(): Promise<ResendOutcome> {
  try {
    const res = await fetch("/api/auth/verify-email/resend", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
    if (!res.ok) return { ok: false, message: data.error || "Could not send the email. Try again." };
    return { ok: true, alreadyVerified: data.status === "already_verified" };
  } catch {
    return { ok: false, message: "Network error. Try again." };
  }
}
