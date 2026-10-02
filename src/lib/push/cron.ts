import { runWritingNudgeCron } from "@/lib/push/writing-nudge";

// The Worker's scheduled handler (src/worker/index.ts) calls this once a
// day, alongside the email cron jobs (src/lib/email/cron.ts). Each job
// catches and logs its own failure so one broken job never blocks another.
export async function runScheduledPushJobs(now: Date = new Date()): Promise<void> {
  const jobs: Array<[string, () => Promise<void>]> = [
    ["writing-nudge", () => runWritingNudgeCron(now)],
  ];
  for (const [name, run] of jobs) {
    try {
      await run();
    } catch (error) {
      console.error(`[push-cron] ${name} failed`, error);
    }
  }
}
