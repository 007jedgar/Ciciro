import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth/session";
import {
  EMAIL_TOKEN_TTL_MS,
  checkEmailToken,
  consumeEmailToken,
  issueEmailToken,
  type EmailTokenCheck,
} from "@/lib/auth/email-tokens";
import type { VerifyOutcome } from "@/lib/auth/verify-email-copy";
import { sendVerifyEmail, sendWelcomeEmail } from "@/lib/email/account-emails";

// Proving an account's email address. A password signup gets a link; clicking
// it sets User.emailVerifiedAt and sends the welcome email. Nothing is gated
// on it: an unverified account signs in and writes exactly like a verified one.

export type VerificationStart =
  | { status: "sent" }
  | { status: "already_verified" }
  | { status: "cooldown"; retryAfterMs: number };

/** Email the account a verification link, unless it is verified or one just went out. */
export async function startEmailVerification(userId: string, origin: string): Promise<VerificationStart> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, emailVerifiedAt: true },
  });
  if (!user) throw new AuthError("Not found.", 404);
  if (user.emailVerifiedAt) return { status: "already_verified" };
  const issue = await issueEmailToken(user, "verify_email");
  if (!issue.ok) return { status: "cooldown", retryAfterMs: issue.retryAfterMs };
  await sendVerifyEmail(
    user,
    { tokenId: issue.issued.id, token: issue.issued.token, expiresInMs: EMAIL_TOKEN_TTL_MS.verify_email },
    origin
  );
  return { status: "sent" };
}

/**
 * Right after a password signup. Never throws: a missing EmailToken table or a
 * mail outage must not fail the signup, and the author can resend from settings.
 */
export async function afterPasswordSignup(userId: string, origin: string): Promise<void> {
  try {
    await startEmailVerification(userId, origin);
  } catch (error) {
    console.error("signup: could not start email verification", error);
  }
}

export type { VerifyOutcome };

/** Why a link cannot be spent, as the page reports it. */
async function failedOutcome(result: Extract<EmailTokenCheck, { ok: false }>): Promise<VerifyOutcome> {
  if (result.userId) {
    const user = await prisma.user.findUnique({
      where: { id: result.userId },
      select: { email: true, emailVerifiedAt: true },
    });
    if (user?.emailVerifiedAt) return "already_verified";
    // Spent on this same address: the click that spent it confirms it, and
    // may still be doing so (a double-click), so this one is not "invalid".
    if (result.problem === "used" && user?.email === result.email) return "already_verified";
  }
  return result.problem === "expired" ? "expired" : "invalid";
}

/**
 * Look a verification link up without spending it, for the page the email
 * opens. `pending` means it can still be confirmed.
 */
export async function peekVerification(token: unknown): Promise<VerifyOutcome | "pending"> {
  const check = await checkEmailToken(token, "verify_email");
  if (!check.ok) return failedOutcome(check);
  const user = await prisma.user.findUnique({
    where: { id: check.userId },
    select: { email: true, emailVerifiedAt: true },
  });
  if (!user || user.email !== check.email) return "invalid";
  return user.emailVerifiedAt ? "already_verified" : "pending";
}

/**
 * Spend a verification link, from the page's Confirm button (never on GET).
 * The first confirmation verifies the address and sends the welcome email;
 * any later one (or one on an older link) reports `already_verified` rather
 * than an error.
 */
export async function verifyEmail(token: unknown, origin: string): Promise<VerifyOutcome> {
  const result = await consumeEmailToken(token, "verify_email");
  if (!result.ok) return failedOutcome(result);

  const user = await prisma.user.findUnique({
    where: { id: result.userId },
    select: { id: true, email: true, name: true },
  });
  // A link only proves the address it was sent to.
  if (!user || user.email !== result.email) return "invalid";

  // Only the request that flips the flag sends the welcome email.
  const { count } = await prisma.user.updateMany({
    where: { id: user.id, email: result.email, emailVerifiedAt: null },
    data: { emailVerifiedAt: new Date() },
  });
  if (count === 0) return "already_verified";
  await sendWelcomeEmail(user, origin);
  return "verified";
}
