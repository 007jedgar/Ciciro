import { prisma } from "@/lib/db";
import { sendPushToUser } from "@/lib/push/send";
import { shiftWritingDayKey, writingDayKey } from "@/lib/writing-day";

const LAPSE_DAYS = 7;

/**
 * Daily cron: nudge an account that has written before but has gone quiet.
 * "Written" is a WritingDay row with words > 0 — the same server-side,
 * cross-platform signal web and mobile both already sync through PUT
 * /api/writing/day (src/lib/writing-day-store.ts), so a lapse is measured
 * correctly no matter which platform the writing (or the gap) happened on.
 * A purely local, on-device schedule cannot see this: it would only know
 * about activity on the one phone it runs on, so it could nag right after a
 * web-only writing day, or stay silent through a real week-long gap. Server
 * cron is both the more reliable choice and the simpler one — one daily scan
 * reusing data that already exists, instead of a second on-device scheduling
 * path to keep in sync across devices.
 *
 * At most one nudge per lapse: `sendPushToUser`'s dedupeKey names the lapse
 * by its anchor (the last day they actually wrote), so a lapse already
 * nudged skips silently (PushNotificationLog's unique constraint), while
 * writing again moves the anchor and makes the *next* lapse nudgeable again.
 *
 * Deliberately separate from the existing on-device writing-reminder
 * schedule (apps/mobile/lib/writing-reminder-notifications.ts): reminders
 * are a chosen schedule ("every weekday at 8pm"), this is a fallback for
 * when the author has gone quiet regardless of whether they set reminders.
 * `data.kind: "writing-nudge"` is intentionally its own kind — not tied to a
 * project — so a later step can attach a writing exercise to it without
 * touching the reminder path at all.
 */
export async function runWritingNudgeCron(now: Date = new Date()): Promise<void> {
  const today = writingDayKey(now);
  const cutoff = shiftWritingDayKey(today, -LAPSE_DAYS);
  const lastWritingDays = await prisma.writingDay.groupBy({
    by: ["userId"],
    where: { words: { gt: 0 } },
    _max: { date: true },
  });
  for (const row of lastWritingDays) {
    const lastDate = row._max.date;
    if (!lastDate || lastDate > cutoff) continue;
    try {
      await sendPushToUser(row.userId, {
        title: "Ready to write?",
        body: "It's been a week since your last writing session.",
        category: "writingNudge",
        dedupeKey: `writing-nudge:${lastDate}`,
        data: { kind: "writing-nudge", href: "/manuscripts" },
      });
    } catch (error) {
      console.error("writing nudge failed for a user", error);
    }
  }
}
