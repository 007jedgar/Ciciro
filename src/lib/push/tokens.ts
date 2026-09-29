import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth/session";

// The phones an account can reach with a push notification. The app registers
// its Expo push token once the author has allowed notifications, and removes
// it when they turn them off; signing out drops it with the session
// (src/lib/auth/session.ts). See docs/mobile-release.md#push-notifications.

export type PushPlatform = "ios" | "android";

/** The most phones one account keeps; registering past it drops the stalest. */
export const MAX_PUSH_TOKENS_PER_ACCOUNT = 20;

const EXPO_PUSH_TOKEN = /^(?:ExponentPushToken|ExpoPushToken)\[[^\]\s]{1,256}\]$/;

export function isExpoPushToken(value: unknown): value is string {
  return typeof value === "string" && EXPO_PUSH_TOKEN.test(value);
}

function platformFrom(value: unknown): PushPlatform {
  if (value === "ios" || value === "android") return value;
  throw new AuthError("platform must be ios or android.", 400);
}

/** Drop tokens and the receipts still waiting on them, children first. */
export async function deletePushTokens(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  await prisma.$transaction([
    prisma.pushTicket.deleteMany({ where: { pushTokenId: { in: [...ids] } } }),
    prisma.pushToken.deleteMany({ where: { id: { in: [...ids] } } }),
  ]);
}

/**
 * Point `token` at this account and sign-in. Registering again refreshes it,
 * and a token last registered by another account (the phone changed hands, or
 * someone signed out offline) moves here.
 */
export async function registerPushToken(
  owner: { userId: string; sessionId: string },
  body: { token?: unknown; platform?: unknown }
): Promise<void> {
  if (!isExpoPushToken(body.token)) throw new AuthError("Not an Expo push token.", 400);
  const platform = platformFrom(body.platform);
  await prisma.pushToken.upsert({
    where: { token: body.token },
    create: { token: body.token, platform, ...owner },
    update: { platform, ...owner },
  });
  const stale = await prisma.pushToken.findMany({
    where: { userId: owner.userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: MAX_PUSH_TOKENS_PER_ACCOUNT,
    select: { id: true },
  });
  await deletePushTokens(stale.map((row) => row.id));
}

/** Stop sending to `token`. Only this account's own registration is removed. */
export async function unregisterPushToken(userId: string, body: { token?: unknown }): Promise<void> {
  if (!isExpoPushToken(body.token)) throw new AuthError("Not an Expo push token.", 400);
  const rows = await prisma.pushToken.findMany({
    where: { userId, token: body.token },
    select: { id: true },
  });
  await deletePushTokens(rows.map((row) => row.id));
}
