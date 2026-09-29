import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { AuthError } from "@/lib/auth/session";
import { normalizeEmail, validatePassword } from "@/lib/auth/tokens";
import {
  EMAIL_TOKEN_TTL_MS,
  checkEmailToken,
  consumeEmailToken,
  issueEmailToken,
  type EmailTokenProblem,
} from "@/lib/auth/email-tokens";
import { sendPasswordResetEmail } from "@/lib/email/account-emails";

// Forgotten passwords: email a one-hour, single-use link; following it sets a
// new password and signs the account out everywhere.

export const RESET_LINK_PROBLEMS: Record<EmailTokenProblem, string> = {
  invalid: "This reset link isn't valid. Request a new one below.",
  expired: "This reset link has expired. Request a new one below.",
  used: "This reset link has already been used. Request a new one if you still need it.",
};

/**
 * Email a reset link to the account at `rawEmail`, if there is one. The
 * caller answers the same way either way, so the form never says whether an
 * address has an account. A second request within the cooldown sends nothing.
 */
export async function requestPasswordReset(rawEmail: unknown, origin: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new AuthError("Enter a valid email address.");
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  if (!user) return;
  const issue = await issueEmailToken(user, "reset_password");
  if (!issue.ok) return;
  await sendPasswordResetEmail(
    user,
    { tokenId: issue.issued.id, token: issue.issued.token, expiresInMs: EMAIL_TOKEN_TTL_MS.reset_password },
    origin
  );
}

function linkProblem(problem: EmailTokenProblem): AuthError {
  return new AuthError(RESET_LINK_PROBLEMS[problem], 400, { error: RESET_LINK_PROBLEMS[problem], problem });
}

/**
 * Set a new password from a reset link. Spends the link, retires any other
 * outstanding reset link, and deletes every session, so a device signed in by
 * whoever knew the old password is signed out, and forgets failed password
 * attempts so an earlier lockout does not hold the new password back.
 * Following the link also proves the address, so it counts as verifying it.
 */
export async function resetPassword(token: unknown, password: unknown): Promise<void> {
  const passwordError = validatePassword(password);
  if (passwordError) throw new AuthError(passwordError);

  // Check before the slow hash, spend after it, so a weak password or a dead
  // link never costs the author their link.
  const check = await checkEmailToken(token, "reset_password");
  if (!check.ok) throw linkProblem(check.problem);
  const passwordHash = await hashPassword(password as string);
  const spent = await consumeEmailToken(token, "reset_password");
  if (!spent.ok) throw linkProblem(spent.problem);

  const user = await prisma.user.findUnique({
    where: { id: spent.userId },
    select: { id: true, email: true, emailVerifiedAt: true },
  });
  if (!user || user.email !== spent.email) throw linkProblem("invalid");

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
    }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.emailToken.deleteMany({ where: { userId: user.id, purpose: "reset_password", usedAt: null } }),
    // Failed guesses at the old password no longer lock the owner out of the new one.
    prisma.passwordAttempt.deleteMany({
      where: { OR: [{ scope: "login", key: user.email }, { scope: "delete", key: user.id }] },
    }),
  ]);
}
