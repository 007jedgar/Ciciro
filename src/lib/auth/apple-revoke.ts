import { prisma } from "@/lib/db";
import { appleClientSecret } from "@/lib/auth/oidc";
import { appleConfig } from "@/lib/auth/social-config";

// Revoking Ciciro's Sign in with Apple tokens, for account deletion. App Store
// guideline 5.1.1(v) requires an app that offers Sign in with Apple to revoke
// the user's tokens when they delete their account.
//
// Account deletion should run `revokeAppleTokens(userId)` as a pre-delete hook,
// before the User row (and with it, by cascade, every Identity) is deleted: the
// refresh tokens live on those rows.

const REVOKE_URL = "https://appleid.apple.com/auth/revoke";

export class AppleRevokeError extends Error {
  /** Identity ids whose token Apple did not confirm revoked. */
  failed: string[];
  constructor(failed: string[], reason: string) {
    super(`Could not revoke ${failed.length} Sign in with Apple token(s): ${reason}`);
    this.name = "AppleRevokeError";
    this.failed = failed;
  }
}

/**
 * Revoke every Sign in with Apple refresh token this user holds, and clear each
 * one Apple confirms. Tries them all, then throws AppleRevokeError if any
 * failed, so deletion can stop and be retried rather than orphan a grant.
 * A user with no Apple tokens resolves immediately (0).
 *
 * @returns how many tokens were revoked.
 */
export async function revokeAppleTokens(
  userId: string,
  fetchImpl: typeof fetch = fetch
): Promise<number> {
  const identities = await prisma.identity.findMany({
    where: { userId, provider: "apple", refreshToken: { not: "" } },
    select: { id: true, refreshToken: true, refreshTokenClientId: true },
  });
  if (identities.length === 0) return 0;

  const config = appleConfig();
  if (!config.teamId || !config.keyId || !config.privateKey) {
    throw new AppleRevokeError(
      identities.map((identity) => identity.id),
      "APPLE_TEAM_ID, APPLE_KEY_ID and APPLE_PRIVATE_KEY are required"
    );
  }

  const failed: string[] = [];
  let lastReason = "";
  let revoked = 0;
  for (const identity of identities) {
    try {
      const res = await fetchImpl(REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          // The token can only be revoked by the client it was issued to.
          client_id: identity.refreshTokenClientId,
          client_secret: await appleClientSecret(config, identity.refreshTokenClientId),
          token: identity.refreshToken,
          token_type_hint: "refresh_token",
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await prisma.identity.update({
        where: { id: identity.id },
        data: { refreshToken: "", refreshTokenClientId: "" },
      });
      revoked += 1;
    } catch (error) {
      failed.push(identity.id);
      lastReason = error instanceof Error ? error.message : String(error);
    }
  }
  if (failed.length) throw new AppleRevokeError(failed, lastReason);
  return revoked;
}
