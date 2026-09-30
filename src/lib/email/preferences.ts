import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { EMAIL_TOPICS, TOPIC_LABELS, type EmailTopic } from "@/lib/email/topics";

// Marketing-email consent: the single opt-in checkbox (signup, or Settings)
// plus the topics it unlocks. See prisma/schema.prisma's EmailPreference for
// why this is its own table, and docs/hosting.md#email for the send-side
// setup. No row for a user means "never opted in" — every marketing send is
// gated off, so a missing row is exactly as safe as an explicit false.

export { EMAIL_TOPICS, TOPIC_LABELS, type EmailTopic };

export type EmailPreferenceRow = {
  userId: string;
  marketingOptIn: boolean;
  marketingOptInAt: Date | null;
  productUpdates: boolean;
  weeklyEmail: boolean;
  offers: boolean;
  unsubscribeToken: string;
};

const DEFAULT_TOPICS = { productUpdates: true, weeklyEmail: true, offers: true };

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Get a user's row, or the defaults a missing row implies (marketing off). */
export async function getEmailPreference(userId: string): Promise<EmailPreferenceRow | null> {
  return prisma.emailPreference.findUnique({ where: { userId } });
}

/** Get or create the row, so a caller that needs an unsubscribeToken always has one. */
async function ensureEmailPreference(userId: string): Promise<EmailPreferenceRow> {
  const existing = await prisma.emailPreference.findUnique({ where: { userId } });
  if (existing) return existing;
  try {
    return await prisma.emailPreference.create({
      data: { userId, unsubscribeToken: newToken(), ...DEFAULT_TOPICS },
    });
  } catch (error) {
    // A concurrent request created it first.
    if ((error as { code?: unknown } | null)?.code !== "P2002") throw error;
    return prisma.emailPreference.findUniqueOrThrow({ where: { userId } });
  }
}

/**
 * Turn the combined marketing checkbox on or off, for signup (password,
 * Apple, or Google — all three call this the same way) and Settings alike.
 * Turning it on stamps `marketingOptInAt`, the anchor the welcome sequence
 * counts its days from (src/lib/email/cron.ts); turning it off again does
 * not clear that stamp, so a later re-opt-in date is what welcome-sequence
 * eligibility uses instead.
 */
export async function setMarketingOptIn(userId: string, optedIn: boolean): Promise<EmailPreferenceRow> {
  const now = new Date();
  const existing = await prisma.emailPreference.findUnique({ where: { userId } });
  if (!existing) {
    return prisma.emailPreference.create({
      data: {
        userId,
        unsubscribeToken: newToken(),
        marketingOptIn: optedIn,
        marketingOptInAt: optedIn ? now : null,
        ...DEFAULT_TOPICS,
      },
    });
  }
  return prisma.emailPreference.update({
    where: { userId },
    data: {
      marketingOptIn: optedIn,
      // Only a false -> true transition restarts the welcome sequence's clock.
      ...(optedIn && !existing.marketingOptIn ? { marketingOptInAt: now } : {}),
    },
  });
}

/** Settings: change one or more topics. Implicitly creates a (opted-out) row. */
export async function updateTopics(
  userId: string,
  patch: Partial<Record<EmailTopic, boolean>>
): Promise<EmailPreferenceRow> {
  await ensureEmailPreference(userId);
  return prisma.emailPreference.update({ where: { userId }, data: patch });
}

/** Whether a specific topic may be sent to this user right now. */
export async function marketingEnabled(userId: string, topic: EmailTopic): Promise<boolean> {
  const pref = await getEmailPreference(userId);
  return Boolean(pref?.marketingOptIn && pref[topic]);
}

export async function preferenceByToken(token: string): Promise<EmailPreferenceRow | null> {
  if (!token) return null;
  return prisma.emailPreference.findUnique({ where: { unsubscribeToken: token } });
}

/** The public preferences page's link, for every marketing email's footer. */
export function preferencesUrl(origin: string, token: string): string {
  return `${origin}/email/preferences?t=${encodeURIComponent(token)}`;
}

/**
 * The one-click unsubscribe link (RFC 8058's List-Unsubscribe target) for one
 * topic, and the "unsubscribe from everything" link the preferences page and
 * the plain-text fallback use. `topic` is the specific list this email
 * belongs to — a one-click unsubscribe only ever leaves that one.
 */
export function unsubscribeUrl(origin: string, token: string, topic: EmailTopic): string {
  return `${origin}/api/email/unsubscribe?t=${encodeURIComponent(token)}&topic=${topic}`;
}

/** Turn one topic off (or everything, for the preferences page's "Unsubscribe from all" button). */
export async function unsubscribeByToken(
  token: string,
  topic: EmailTopic | "all"
): Promise<EmailPreferenceRow | null> {
  const pref = await preferenceByToken(token);
  if (!pref) return null;
  const data = topic === "all" ? { marketingOptIn: false } : { [topic]: false };
  return prisma.emailPreference.update({ where: { unsubscribeToken: token }, data });
}

export async function updateTopicsByToken(
  token: string,
  patch: Partial<Record<EmailTopic, boolean>>
): Promise<EmailPreferenceRow | null> {
  const pref = await preferenceByToken(token);
  if (!pref) return null;
  return prisma.emailPreference.update({ where: { unsubscribeToken: token }, data: patch });
}
