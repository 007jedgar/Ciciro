import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth/session";
import { normalizeEmail } from "@/lib/auth/tokens";

// Landing-page signups for the iOS TestFlight beta. No account, no email is
// sent: a row is just a name on a list the captain exports (docs/hosting.md).

/** Form field bots fill and people never see; a filled one is dropped quietly. */
export const BETA_HONEYPOT_FIELD = "website";

const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

export const BETA_INVALID_EMAIL = "Enter a valid email address.";
const TOO_MANY = "Too many signups from here. Try again later.";

function addressHash(address: string): string {
  return createHash("sha256").update(`beta-signup\u0000${address}`).digest("hex");
}

/**
 * Add `rawEmail` to the beta list. A repeat of an address already on it
 * succeeds without a second row. Throws AuthError 400 for a bad address and
 * 429 when `address` has already added `SIGNUP_LIMIT` new addresses in the
 * last hour (repeats never count, they write nothing). A null address skips
 * the limit, as in src/lib/auth/rate-limit.ts.
 */
export async function joinBeta(
  rawEmail: unknown,
  opts: { address: string | null; source?: string; honeypot?: unknown; now?: Date }
): Promise<void> {
  // A bot that filled the hidden field gets the same answer a person does.
  if (typeof opts.honeypot === "string" && opts.honeypot.trim() !== "") return;

  const email = normalizeEmail(rawEmail);
  if (!email) throw new AuthError(BETA_INVALID_EMAIL, 400);

  const now = opts.now ?? new Date();
  const existing = await prisma.betaSignup.findUnique({ where: { email }, select: { id: true } });
  if (existing) return;

  const ipHash = opts.address ? addressHash(opts.address) : "";
  if (ipHash) {
    const recent = await prisma.betaSignup.count({
      where: { ipHash, createdAt: { gt: new Date(now.getTime() - SIGNUP_WINDOW_MS) } },
    });
    if (recent >= SIGNUP_LIMIT) throw new AuthError(TOO_MANY, 429, { error: TOO_MANY, retryAfter: 600 });
  }

  const source = (opts.source ?? "landing").slice(0, 40) || "landing";
  try {
    await prisma.betaSignup.create({ data: { email, source, ipHash, createdAt: now } });
  } catch (error) {
    // Two submits of the same address raced past the check above.
    if ((error as { code?: unknown })?.code === "P2002") return;
    throw error;
  }
}
