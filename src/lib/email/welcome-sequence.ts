import { prisma } from "@/lib/db";
import { sendMarketingEmail } from "@/lib/email/marketing-send";
import {
  welcomeStep1Template,
  welcomeStep2Template,
  welcomeStep3Template,
  welcomeStep4Template,
} from "@/lib/email/templates";

// The 4-email marketing welcome sequence (distinct from the mandatory,
// always-sent welcomeTemplate in account-emails.ts): step 1 fires the moment
// someone opts into marketing (called from the signup paths themselves, not
// cron, so "immediately" is literal), steps 2-4 are day-N, condition-gated,
// and evaluated once a day by src/lib/email/cron.ts. All four are gated on
// the `productUpdates` topic — the welcome sequence is the first thing that
// topic ever sends, so turning it off before day 14 quietly ends the
// sequence early, which is the right behavior for an unsubscribe.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Step 1: called right where marketingOptIn turns on, never by cron. */
export async function sendWelcomeStep1(
  user: { id: string; email: string },
  origin: string
): Promise<void> {
  await sendMarketingEmail({
    userId: user.id,
    email: user.email,
    topic: "productUpdates",
    key: "welcome-1",
    origin,
    buildContent: (unsubscribe) => ({
      ...welcomeStep1Template({ changelogUrl: `${origin}/changelog` }),
      unsubscribe,
    }),
  });
}

type Candidate = { id: string; email: string; marketingOptInAt: Date };

async function eligibleCandidates(): Promise<Candidate[]> {
  const rows = await prisma.emailPreference.findMany({
    where: { marketingOptIn: true, productUpdates: true, marketingOptInAt: { not: null } },
    select: { userId: true, marketingOptInAt: true, user: { select: { email: true } } },
  });
  return rows
    .filter((row) => row.marketingOptInAt)
    .map((row) => ({ id: row.userId, email: row.user.email, marketingOptInAt: row.marketingOptInAt as Date }));
}

async function hasChapter(userId: string): Promise<boolean> {
  return (await prisma.chapter.count({ where: { project: { userId } }, take: 1 })) > 0;
}

async function hasManuscript(userId: string): Promise<boolean> {
  return (await prisma.project.count({ where: { userId }, take: 1 })) > 0;
}

const STEP_KEYS = ["welcome-2", "welcome-3", "welcome-4"];

/** Run daily: sends whichever of steps 2-4 a candidate has newly become due for. */
export async function runWelcomeSequenceCron(now: Date, origin: string): Promise<void> {
  const candidates = await eligibleCandidates();
  if (!candidates.length) return;
  const logged = await prisma.marketingEmailLog.findMany({
    where: { userId: { in: candidates.map((c) => c.id) }, key: { in: STEP_KEYS } },
    select: { userId: true, key: true },
  });
  const sentByUser = new Map<string, Set<string>>();
  for (const row of logged) {
    const set = sentByUser.get(row.userId) ?? new Set<string>();
    set.add(row.key);
    sentByUser.set(row.userId, set);
  }

  for (const candidate of candidates) {
    try {
      await runCandidate(candidate, now, origin, sentByUser.get(candidate.id) ?? new Set());
    } catch (error) {
      console.error("welcome sequence failed for a user", error);
    }
  }
}

async function runCandidate(
  candidate: Candidate,
  now: Date,
  origin: string,
  sent: Set<string>
): Promise<void> {
  const days = Math.floor((now.getTime() - candidate.marketingOptInAt.getTime()) / DAY_MS);
  if (days >= 3 && !sent.has("welcome-2") && !(await hasChapter(candidate.id))) {
    await sendMarketingEmail({
      userId: candidate.id,
      email: candidate.email,
      topic: "productUpdates",
      key: "welcome-2",
      origin,
      buildContent: (unsubscribe) => ({ ...welcomeStep2Template({ appUrl: `${origin}/` }), unsubscribe }),
    });
  }
  if (days >= 7 && !sent.has("welcome-3") && (await hasManuscript(candidate.id))) {
    await sendMarketingEmail({
      userId: candidate.id,
      email: candidate.email,
      topic: "productUpdates",
      key: "welcome-3",
      origin,
      buildContent: (unsubscribe) => ({ ...welcomeStep3Template({ appUrl: `${origin}/` }), unsubscribe }),
    });
  }
  if (days >= 14 && !sent.has("welcome-4")) {
    await sendMarketingEmail({
      userId: candidate.id,
      email: candidate.email,
      topic: "productUpdates",
      key: "welcome-4",
      origin,
      buildContent: (unsubscribe) => ({ ...welcomeStep4Template({ appUrl: `${origin}/` }), unsubscribe }),
    });
  }
}
