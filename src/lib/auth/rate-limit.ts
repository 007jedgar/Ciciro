import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth/session";

// Shared password-attempt rate limiter for /api/auth/login and the password
// check in DELETE /api/auth/account (verifyDeletionProof). Counts recent
// PasswordAttempt rows per key (D1-durable, so it works across Worker
// isolates) rather than holding counters in memory. Three windows apply:
//   - per account and address (`key` + IP): a handful of failures locks that
//     pair out, so one network's guesses never lock the owner out elsewhere.
//   - per account across all addresses: a much looser hourly ceiling that
//     still caps a distributed guess against one account.
//   - per IP: a looser cap catches one address spraying many keys.
// With no known address (see clientAddress) only the account-wide ceiling
// applies; the pair and IP windows are skipped rather than pooling every
// unknown caller into one bucket.
// A login key is the normalized email even when no account matches it, so an
// unregistered address locks out identically to a real one — the lockout
// itself never signals whether the account exists.

export type AttemptScope = "login" | "delete";

const PAIR_LIMIT = 5;
const PAIR_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_LIMIT = 50;
const ACCOUNT_WINDOW_MS = 60 * 60 * 1000;
const IP_LIMIT = 20;
const IP_WINDOW_MS = 15 * 60 * 1000;

const LOCKOUT_MESSAGE = "Too many attempts. Try again later.";

function ipHash(scope: AttemptScope, address: string | null): string {
  return createHash("sha256")
    .update(`${scope}\u0000${address ?? "\u0000no-address"}`)
    .digest("hex");
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
 * from `address`, `key` overall, or `address` overall already has too many
 * recent failures in `scope`. A null `address` skips the address-scoped
 * windows. Call this before checking the password, so a locked-out attempt
 * never touches the hash.
 */
export async function assertAttemptAllowed(
  scope: AttemptScope,
  key: string,
  address: string | null,
  now: Date = new Date()
): Promise<void> {
  const nowMs = now.getTime();
  const pairSince = { gt: new Date(nowMs - PAIR_WINDOW_MS) };
  const [account, pair, ip] = await Promise.all([
    windowState({ scope, key, createdAt: { gt: new Date(nowMs - ACCOUNT_WINDOW_MS) } }),
    address === null
      ? null
      : windowState({ scope, key, ipHash: ipHash(scope, address), createdAt: pairSince }),
    address === null
      ? null
      : windowState({ ipHash: ipHash(scope, address), createdAt: { gt: new Date(nowMs - IP_WINDOW_MS) } }),
  ]);
  if (pair && pair.count >= PAIR_LIMIT) {
    throw lockout(retryAfterSeconds(pair.oldest, PAIR_WINDOW_MS, nowMs));
  }
  if (account.count >= ACCOUNT_LIMIT) {
    throw lockout(retryAfterSeconds(account.oldest, ACCOUNT_WINDOW_MS, nowMs));
  }
  if (ip && ip.count >= IP_LIMIT) {
    throw lockout(retryAfterSeconds(ip.oldest, IP_WINDOW_MS, nowMs));
  }
}

/**
 * Record a failed attempt so it counts against the account, pair and IP
 * limits. Pass `userId` when the key resolves to a real account (always for
 * `delete`; `login` leaves it unset — see purgeAccountData, which purges a
 * login key by its email instead) so account deletion purges the row. Rows
 * older than the longest window can no longer affect a check, so each record
 * prunes them.
 */
export async function recordFailedAttempt(
  scope: AttemptScope,
  key: string,
  address: string | null,
  opts: { userId?: string; now?: Date } = {}
): Promise<void> {
  const { userId, now = new Date() } = opts;
  await prisma.passwordAttempt.deleteMany({
    where: { createdAt: { lt: new Date(now.getTime() - ACCOUNT_WINDOW_MS) } },
  });
  await prisma.passwordAttempt.create({
    data: { scope, key, userId, ipHash: ipHash(scope, address), createdAt: now },
  });
}

/** A successful attempt: forget this key's recent failures. */
export async function clearAttempts(scope: AttemptScope, key: string): Promise<void> {
  await prisma.passwordAttempt.deleteMany({ where: { scope, key } });
}
