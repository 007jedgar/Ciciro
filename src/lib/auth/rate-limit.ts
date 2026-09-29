import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth/session";

// Shared password-attempt rate limiter for /api/auth/login and the password
// check in DELETE /api/auth/account (verifyDeletionProof). Counts recent
// PasswordAttempt rows per key (D1-durable, so it works across Worker
// isolates) rather than holding counters in memory. Two windows apply:
//   - per account (`key`): a handful of failures locks that key out.
//   - per IP: a looser cap catches one address spraying many keys.
// A login key is the normalized email even when no account matches it, so an
// unregistered address locks out identically to a real one — the lockout
// itself never signals whether the account exists.

export type AttemptScope = "login" | "delete";

const ACCOUNT_LIMIT = 5;
const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT = 20;
const IP_WINDOW_MS = 15 * 60 * 1000;

const LOCKOUT_MESSAGE = "Too many attempts. Try again later.";

function ipHash(scope: AttemptScope, address: string): string {
  return createHash("sha256").update(`${scope}\u0000${address}`).digest("hex");
}

async function windowState(
  where: Record<string, unknown>
): Promise<{ count: number; oldest: Date | null }> {
  const [count, oldest] = await Promise.all([
    prisma.passwordAttempt.count({ where }),
    prisma.passwordAttempt.findFirst({
      where,
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  return { count, oldest: oldest?.createdAt ?? null };
}

function retryAfterSeconds(oldest: Date | null, windowMs: number, now: number): number {
  if (!oldest) return Math.ceil(windowMs / 1000);
  return Math.max(1, Math.ceil((oldest.getTime() + windowMs - now) / 1000));
}

function lockout(retryAfter: number): AuthError {
  return new AuthError(LOCKOUT_MESSAGE, 429, { error: LOCKOUT_MESSAGE, retryAfter });
}

/**
 * Throws a 429 AuthError (with `retryAfter` seconds in its body) when `key`
 * or `address` already has too many recent failures in `scope`. Call this
 * before checking the password, so a locked-out attempt never touches the
 * hash.
 */
export async function assertAttemptAllowed(
  scope: AttemptScope,
  key: string,
  address: string,
  now: Date = new Date()
): Promise<void> {
  const nowMs = now.getTime();
  const [account, ip] = await Promise.all([
    windowState({
      scope,
      key,
      createdAt: { gt: new Date(nowMs - ACCOUNT_WINDOW_MS) },
    }),
    windowState({
      ipHash: ipHash(scope, address),
      createdAt: { gt: new Date(nowMs - IP_WINDOW_MS) },
    }),
  ]);
  if (account.count >= ACCOUNT_LIMIT) {
    throw lockout(retryAfterSeconds(account.oldest, ACCOUNT_WINDOW_MS, nowMs));
  }
  if (ip.count >= IP_LIMIT) {
    throw lockout(retryAfterSeconds(ip.oldest, IP_WINDOW_MS, nowMs));
  }
}

/**
 * Record a failed attempt so it counts against both the account and IP
 * limits. Pass `userId` when the key resolves to a real account (always for
 * `delete`; `login` leaves it unset — see purgeAccountData, which purges a
 * login key by its email instead) so account deletion purges the row.
 */
export async function recordFailedAttempt(
  scope: AttemptScope,
  key: string,
  address: string,
  opts: { userId?: string; now?: Date } = {}
): Promise<void> {
  const { userId, now = new Date() } = opts;
  await prisma.passwordAttempt.create({
    data: { scope, key, userId, ipHash: ipHash(scope, address), createdAt: now },
  });
}

/** A successful attempt: forget this key's recent failures. */
export async function clearAttempts(scope: AttemptScope, key: string): Promise<void> {
  await prisma.passwordAttempt.deleteMany({ where: { scope, key } });
}
