import { prisma } from "@/lib/db";
import { sendMarketingEmail } from "@/lib/email/marketing-send";
import { changelogDigestTemplate } from "@/lib/email/templates";
import { CHANGELOG_ENTRIES } from "@/lib/changelog-data.generated";

// The weekly product-update email: skipped entirely when nothing is new, and
// per-user when a given user has already seen every entry in the batch (a
// user who opts in mid-week still gets caught up, capped to the most recent
// few rather than every entry ever written). Only fires on Mondays so a
// mid-week merge doesn't itself trigger a send; changelog-entry:<id> rows in
// MarketingEmailLog are the "has this user seen this entry" bookkeeping,
// kept separate from the per-batch key sendMarketingEmail uses to dedup the
// send itself.

const RECENT_ENTRIES = CHANGELOG_ENTRIES.slice(0, 4);

async function unsentEntriesFor(userId: string): Promise<typeof RECENT_ENTRIES> {
  if (RECENT_ENTRIES.length === 0) return [];
  const seen = await prisma.marketingEmailLog.findMany({
    where: { userId, key: { in: RECENT_ENTRIES.map((entry) => `changelog-entry:${entry.id}`) } },
    select: { key: true },
  });
  const seenIds = new Set(seen.map((row) => row.key.slice("changelog-entry:".length)));
  return RECENT_ENTRIES.filter((entry) => !seenIds.has(entry.id));
}

/** Run daily; only Monday (UTC) actually attempts a send. */
export async function runChangelogDigestCron(now: Date, origin: string): Promise<void> {
  if (now.getUTCDay() !== 1 || RECENT_ENTRIES.length === 0) return;

  const candidates = await prisma.emailPreference.findMany({
    where: { marketingOptIn: true, weeklyEmail: true },
    select: { userId: true, user: { select: { email: true } } },
  });

  for (const candidate of candidates) {
    const unsent = await unsentEntriesFor(candidate.userId);
    if (unsent.length === 0) continue;

    const key = `changelog:${unsent
      .map((entry) => entry.id)
      .sort()
      .join(",")}`;
    const result = await sendMarketingEmail({
      userId: candidate.userId,
      email: candidate.user.email,
      topic: "weeklyEmail",
      key,
      origin,
      buildContent: (unsubscribe) => ({
        ...changelogDigestTemplate({ entries: unsent, changelogUrl: `${origin}/changelog` }),
        unsubscribe,
      }),
    });

    if (result.sent) {
      // SQLite (D1) has no createMany skipDuplicates; these keys were just
      // read as absent, so a per-row create only ever collides with a
      // concurrent cron tick for the same user, which the unique constraint
      // on (userId, key) then safely no-ops.
      for (const entry of unsent) {
        await prisma.marketingEmailLog
          .create({ data: { userId: candidate.userId, key: `changelog-entry:${entry.id}` } })
          .catch((error) => {
            if ((error as { code?: unknown } | null)?.code !== "P2002") throw error;
          });
      }
    }
  }
}
