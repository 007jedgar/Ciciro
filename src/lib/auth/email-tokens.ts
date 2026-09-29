import { prisma } from "@/lib/db";
import { generateSessionToken, hashSessionToken } from "@/lib/auth/tokens";

// One-time links emailed to an account (EmailToken). The raw token only ever
// exists in the email; the database keeps its SHA-256, like a session token.

export type EmailTokenPurpose = "verify_email" | "reset_password";

/** How long each kind of link works. */
export const EMAIL_TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  verify_email: 48 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
};

/**
 * Minimum gap between two links of the same kind for one account, so the
 * request endpoints cannot be used to flood an inbox. Not a general rate limit.
 */
export const EMAIL_TOKEN_COOLDOWN_MS = 60 * 1000;

/** Reset emails one account can be sent in a rolling EMAIL_TOKEN_CAP_WINDOW_MS. */
export const RESET_EMAIL_CAP = 5;
export const EMAIL_TOKEN_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

export type IssuedEmailToken = { id: string; token: string; expiresAt: Date };

export type EmailTokenIssue =
  | { ok: true; issued: IssuedEmailToken }
  | { ok: false; retryAfterMs: number };

/**
 * Create a link for `purpose`, unless the account got one less than
 * EMAIL_TOKEN_COOLDOWN_MS ago, or (for reset links) the account already got
 * RESET_EMAIL_CAP in the last day. Earlier unused links stay valid side by
 * side, so a stranger requesting resets cannot kill the one the owner holds.
 */
export async function issueEmailToken(
  user: { id: string; email: string },
  purpose: EmailTokenPurpose,
  now = Date.now()
): Promise<EmailTokenIssue> {
  const latest = await prisma.emailToken.findFirst({
    where: { userId: user.id, purpose },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (latest) {
    const wait = latest.createdAt.getTime() + EMAIL_TOKEN_COOLDOWN_MS - now;
    if (wait > 0) return { ok: false, retryAfterMs: wait };
  }

  if (purpose === "reset_password") {
    const recent = await prisma.emailToken.findMany({
      where: { userId: user.id, purpose, createdAt: { gt: new Date(now - EMAIL_TOKEN_CAP_WINDOW_MS) } },
      orderBy: { createdAt: "desc" },
      take: RESET_EMAIL_CAP,
      select: { createdAt: true },
    });
    if (recent.length >= RESET_EMAIL_CAP) {
      const oldest = recent[recent.length - 1].createdAt.getTime();
      return { ok: false, retryAfterMs: oldest + EMAIL_TOKEN_CAP_WINDOW_MS - now };
    }
  }

  // Best effort: a failed sweep only leaves dead rows behind. Rows are kept a
  // day past expiry so the reset cap still sees every email sent in its window.
  await prisma.emailToken
    .deleteMany({ where: { expiresAt: { lt: new Date(now - EMAIL_TOKEN_CAP_WINDOW_MS) } } })
    .catch(() => {});

  const token = generateSessionToken();
  const expiresAt = new Date(now + EMAIL_TOKEN_TTL_MS[purpose]);
  const row = await prisma.emailToken.create({
    data: {
      userId: user.id,
      purpose,
      tokenHash: hashSessionToken(token),
      email: user.email,
      expiresAt,
      createdAt: new Date(now),
    },
  });
  return { ok: true, issued: { id: row.id, token, expiresAt } };
}

/** Why a link cannot be used. */
export type EmailTokenProblem = "invalid" | "expired" | "used";

export type EmailTokenCheck =
  | { ok: true; id: string; userId: string; email: string }
  | { ok: false; problem: EmailTokenProblem; userId?: string; email?: string };

async function findToken(token: unknown, purpose: EmailTokenPurpose) {
  if (typeof token !== "string" || !token || token.length > 200) return null;
  const row = await prisma.emailToken.findUnique({ where: { tokenHash: hashSessionToken(token) } });
  return row && row.purpose === purpose ? row : null;
}

/** Look a link up without spending it (to show the reset form, say). */
export async function checkEmailToken(
  token: unknown,
  purpose: EmailTokenPurpose,
  now = Date.now()
): Promise<EmailTokenCheck> {
  const row = await findToken(token, purpose);
  if (!row) return { ok: false, problem: "invalid" };
  if (row.usedAt) return { ok: false, problem: "used", userId: row.userId, email: row.email };
  if (row.expiresAt.getTime() <= now) {
    return { ok: false, problem: "expired", userId: row.userId, email: row.email };
  }
  return { ok: true, id: row.id, userId: row.userId, email: row.email };
}

/**
 * Spend a link. Exactly one caller wins even when two requests race: the
 * update only matches while the row is still unused and unexpired.
 */
export async function consumeEmailToken(
  token: unknown,
  purpose: EmailTokenPurpose,
  now = Date.now()
): Promise<EmailTokenCheck> {
  const check = await checkEmailToken(token, purpose, now);
  if (!check.ok) return check;
  const { count } = await prisma.emailToken.updateMany({
    where: { id: check.id, usedAt: null, expiresAt: { gt: new Date(now) } },
    data: { usedAt: new Date(now) },
  });
  if (count === 0) return { ok: false, problem: "used", userId: check.userId, email: check.email };
  return check;
}
