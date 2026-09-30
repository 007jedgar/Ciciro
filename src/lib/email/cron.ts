import { runWelcomeSequenceCron } from "@/lib/email/welcome-sequence";
import { runChangelogDigestCron } from "@/lib/email/changelog-digest";
import { publicOrigin } from "@/lib/public-origin";

// The Worker's scheduled handler (src/worker/index.ts) calls this once a day.
// Each job catches and logs its own failure so one broken job never blocks
// the other; neither job throws in ordinary operation (sendMarketingEmail
// never throws), but a bad Prisma query or D1 hiccup should not take out the
// whole tick.

export async function runScheduledEmailJobs(now: Date = new Date()): Promise<void> {
  const origin = publicOrigin("");
  const jobs: Array<[string, () => Promise<void>]> = [
    ["welcome-sequence", () => runWelcomeSequenceCron(now, origin)],
    ["changelog-digest", () => runChangelogDigestCron(now, origin)],
  ];
  for (const [name, run] of jobs) {
    try {
      await run();
    } catch (error) {
      console.error(`[email-cron] ${name} failed`, error);
    }
  }
}
