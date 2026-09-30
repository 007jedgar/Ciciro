import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { AuthError, toPublicUser, type PublicUser } from "@/lib/auth/session";
import { pkceChallenge, randomToken, sha256Hex, type VerifiedIdentity } from "@/lib/auth/oidc";
import type { SocialProvider } from "@/lib/auth/social-config";
import { sendWelcomeEmail } from "@/lib/email/account-emails";
import { setMarketingOptIn } from "@/lib/email/preferences";
import { sendWelcomeStep1 } from "@/lib/email/welcome-sequence";
import { publicOrigin } from "@/lib/public-origin";

// Turning a verified Apple / Google identity into a Ciciro account, and the
// one-time hand-off that carries a browser sign-in back to the phone.

/**
 * `User.passwordHash` for an account with no password. It never verifies (it
 * is not a scrypt hash), so password sign-in fails uniformly for it.
 */
export const NO_PASSWORD = "";

/** Why a verified identity could not sign in. Also the `?error=` code. */
export type SocialErrorCode = "no_email" | "unverified_email";

export class SocialAuthError extends AuthError {
  code: SocialErrorCode;
  constructor(code: SocialErrorCode, message: string) {
    super(message, 403);
    this.code = code;
  }
}

/**
 * A finished social sign-in. `takeover` names the provider when this sign-in
 * claimed a password account nobody had verified: its password is gone and
 * its old sessions are revoked, so the person is told once.
 */
export type SocialSignInResult = { user: PublicUser; takeover: SocialProvider | null };

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

type UserRow = { id: string; email: string; name: string; passwordHash: string; emailVerifiedAt: Date | null };

async function fillEmptyName(user: UserRow, name: string): Promise<UserRow> {
  if (user.name || !name) return user;
  return prisma.user.update({ where: { id: user.id }, data: { name } });
}

/**
 * Sign in with a verified provider identity, creating or linking the account.
 *
 * 1. A known provider subject signs into its user, whatever email it now has.
 * 2. Otherwise a verified email that matches a user links to that user. Apple
 *    private-relay addresses are ordinary emails here. If that user is a
 *    password account whose email was never verified, someone may have
 *    registered another person's address, so the provider-verified owner takes
 *    the account over: the password is cleared and every session revoked.
 * 3. Otherwise a verified email creates a password-less account, and emails
 *    it the welcome. Linking an existing account never does: a password
 *    account got its welcome when it confirmed its address.
 *
 * An unverified email never links or creates anything.
 *
 * `name` is Apple's name, which arrives from the client and only on the first
 * authorization; it is unsigned, so it only ever fills an empty name.
 * `origin` is the public origin for the welcome email's links (see
 * publicOrigin).
 */
export async function signInWithIdentity(
  identity: VerifiedIdentity,
  extras: {
    name?: string;
    refreshToken?: { token: string; clientId: string };
    origin?: string;
    /** The signup form's marketing checkbox. Only ever applied to a new account. */
    marketingOptIn?: boolean;
  } = {}
): Promise<SocialSignInResult> {
  const name = (extras.name?.trim() || identity.name).slice(0, 200);
  const where = {
    provider_subject: { provider: identity.provider, subject: identity.subject },
  };

  const known = await prisma.identity.findUnique({ where, include: { user: true } });
  if (known) {
    const changes: { email?: string; refreshToken?: string; refreshTokenClientId?: string } = {};
    if (identity.email && identity.email !== known.email) changes.email = identity.email;
    if (extras.refreshToken) {
      changes.refreshToken = extras.refreshToken.token;
      changes.refreshTokenClientId = extras.refreshToken.clientId;
    }
    if (Object.keys(changes).length) {
      await prisma.identity.update({ where: { id: known.id }, data: changes });
    }
    return { user: toPublicUser(await fillEmptyName(known.user, name)), takeover: null };
  }

  if (!identity.email) {
    throw new SocialAuthError(
      "no_email",
      "Your account did not share an email address, so Ciciro cannot create an account."
    );
  }
  if (!identity.emailVerified) {
    throw new SocialAuthError(
      "unverified_email",
      "Verify your email address with the provider, then try again."
    );
  }
  const email = identity.email;

  let user = await prisma.user.findUnique({ where: { email } });
  let created = false;
  if (!user) {
    try {
      user = await prisma.user.create({
        data: { email, passwordHash: NO_PASSWORD, name, emailVerifiedAt: new Date() },
      });
      created = true;
    } catch (error) {
      // A concurrent sign-in or signup took the email first; link to it.
      if (!isUniqueViolation(error)) throw error;
      user = await prisma.user.findUniqueOrThrow({ where: { email } });
    }
  }

  let takeover: SocialProvider | null = null;
  if (!created && !user.emailVerifiedAt) {
    // Revoke before linking, so a failure part-way never leaves the old
    // password or a session alive next to the new identity.
    takeover = user.passwordHash ? identity.provider : null;
    if (takeover) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: NO_PASSWORD, emailVerifiedAt: new Date() },
      });
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.authHandoff.deleteMany({ where: { userId: user.id } });
    } else {
      await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    }
  }

  try {
    await prisma.identity.create({
      data: {
        userId: user.id,
        provider: identity.provider,
        subject: identity.subject,
        email,
        refreshToken: extras.refreshToken?.token ?? "",
        refreshTokenClientId: extras.refreshToken?.clientId ?? "",
      },
    });
  } catch (error) {
    // D1 has no interactive transactions, so undo the account by hand rather
    // than leave one nobody can sign into.
    if (created) await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    if (!isUniqueViolation(error)) throw error;
    // The same identity signed in twice at once; the other request linked it.
    const winner = await prisma.identity.findUniqueOrThrow({ where, include: { user: true } });
    return { user: toPublicUser(winner.user), takeover: null };
  }
  const signedIn = await fillEmptyName(user, name);
  if (created) {
    const origin = publicOrigin(extras.origin ?? "");
    await sendWelcomeEmail(signedIn, origin);
    if (extras.marketingOptIn === true) {
      try {
        await setMarketingOptIn(signedIn.id, true);
        await sendWelcomeStep1(signedIn, origin);
      } catch (error) {
        console.error("marketing opt-in failed", error);
      }
    }
  }
  return { user: toPublicUser(signedIn), takeover };
}

/** How long the app has to redeem a browser sign-in. */
export const HANDOFF_TTL_MS = 5 * 60 * 1000;

/**
 * Record a finished browser sign-in for the phone. Returns the one-time code
 * the callback redirects to the app with; only its hash is stored.
 */
export async function createHandoff(userId: string, challenge: string): Promise<string> {
  const now = Date.now();
  await prisma.authHandoff.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }).catch(() => {});
  const code = randomToken();
  await prisma.authHandoff.create({
    data: {
      userId,
      codeHash: sha256Hex(code),
      challenge,
      expiresAt: new Date(now + HANDOFF_TTL_MS),
    },
  });
  return code;
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Redeem a hand-off code with the PKCE verifier the app started with. Codes are
 * single-use: a wrong verifier burns the code too, so a stolen one is worthless
 * after its first try.
 */
export async function redeemHandoff(code: unknown, verifier: unknown): Promise<PublicUser> {
  const expired = new AuthError("This sign-in expired. Try again.", 401);
  if (typeof code !== "string" || !code || typeof verifier !== "string" || !verifier) {
    throw expired;
  }
  const row = await prisma.authHandoff.findUnique({
    where: { codeHash: sha256Hex(code) },
    include: { user: true },
  });
  if (!row) throw expired;
  const { count } = await prisma.authHandoff.deleteMany({ where: { id: row.id } });
  if (count === 0) throw expired;
  if (row.expiresAt.getTime() < Date.now()) throw expired;
  if (!sameString(pkceChallenge(verifier), row.challenge)) throw expired;
  return toPublicUser(row.user);
}
