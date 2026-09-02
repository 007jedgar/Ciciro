import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { appendCredit } from "@/lib/gamification/ledger";
import { getGoals, patchGoals, recordChapterSave, recordHeartbeat, settleDay } from "@/lib/gamification/store";
import { SIGNUP_CREDIT_GRANT } from "@/lib/gamification/constants";

async function wipe() {
  await prisma.creditTransaction.deleteMany();
  await prisma.writingDayStat.deleteMany();
  await prisma.streakState.deleteMany();
  await prisma.writingPrefs.deleteMany();
  await prisma.draftInsertion.deleteMany();
  await prisma.editorStep.deleteMany();
  await prisma.editorRun.deleteMany();
  await prisma.chapter.deleteMany();
  await prisma.project.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

function words(n: number, prefix = "w"): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(" ");
}

describe("credit ledger and day rollup", () => {
  beforeEach(wipe);
  afterAll(async () => {
    await wipe();
    await prisma.$disconnect();
  });

  it("appends ledger rows once per idempotency key", async () => {
    const user = await registerUser({
      email: "ledger@example.com",
      password: "long-enough-pw",
    });
    expect(user).toBeTruthy();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.creditBalance).toBe(SIGNUP_CREDIT_GRANT);

    const first = await appendCredit({
      userId: user.id,
      amount: 15,
      reason: "earn_prose_full",
      idempotencyKey: `earn_prose_full:${user.id}:2026-09-02`,
    });
    expect(first.applied).toBe(true);
    expect(first.balance).toBe(SIGNUP_CREDIT_GRANT + 15);

    const replay = await appendCredit({
      userId: user.id,
      amount: 15,
      reason: "earn_prose_full",
      idempotencyKey: `earn_prose_full:${user.id}:2026-09-02`,
    });
    expect(replay.applied).toBe(false);
    expect(replay.balance).toBe(SIGNUP_CREDIT_GRANT + 15);

    const count = await prisma.creditTransaction.count({ where: { userId: user.id } });
    expect(count).toBe(2); // signup + one prose earn
  });

  it("records chair time, closes Return, and grants the daily return stipend", async () => {
    const user = await registerUser({
      email: "chair@example.com",
      password: "long-enough-pw",
    });
    const today = await recordHeartbeat({
      userId: user.id,
      chairSeconds: 180,
      wrote: true,
      timezone: "UTC",
    });
    expect(today.rings.return.closed).toBe(true);
    expect(today.buckets.chairMinutes).toBe(3);
    expect(today.credits.balance).toBe(SIGNUP_CREDIT_GRANT + 2);
  });

  it("attributes chapter growth and pays a full human-typed bonus", async () => {
    const user = await registerUser({
      email: "prose@example.com",
      password: "long-enough-pw",
    });
    await recordHeartbeat({ userId: user.id, chairSeconds: 180 });
    await recordHeartbeat({ userId: user.id, chairSeconds: 180 });
    await recordHeartbeat({ userId: user.id, chairSeconds: 180 });

    await recordChapterSave({
      userId: user.id,
      chapterId: "ch-prose",
      prevContent: "<p></p>",
      nextContent: `<p>${words(520)}</p>`,
    });

    const today = await settleDay(user.id);
    expect(today.rings.prose.closed).toBe(true);
    expect(today.rings.return.closed).toBe(true);
    expect(today.buckets.humanTyped).toBeGreaterThanOrEqual(500);
    expect(today.credits.balance).toBe(SIGNUP_CREDIT_GRANT + 2 + 15);
  });

  it("does not treat autowrite growth as Prose", async () => {
    const user = await registerUser({
      email: "auto@example.com",
      password: "long-enough-pw",
    });
    await recordChapterSave({
      userId: user.id,
      chapterId: "ch-auto",
      prevContent: "",
      nextContent: `<p>${words(800)}</p>`,
      sourceHint: "autowrite",
    });
    const today = await settleDay(user.id);
    expect(today.buckets.aiInserted).toBe(800);
    expect(today.buckets.humanTyped).toBe(0);
    expect(today.rings.prose.closed).toBe(false);
    expect(today.credits.balance).toBe(SIGNUP_CREDIT_GRANT);
  });

  it("classifies a recent DraftInsertion as AI-inserted", async () => {
    const user = await registerUser({
      email: "draft@example.com",
      password: "long-enough-pw",
    });
    const project = await prisma.project.create({
      data: { title: "Ms", userId: user.id },
    });
    const chapter = await prisma.chapter.create({
      data: { projectId: project.id, title: "One", content: "" },
    });
    await prisma.draftInsertion.create({
      data: {
        projectId: project.id,
        chapterId: chapter.id,
        turnId: "turn-1",
        segmentIndex: 0,
      },
    });
    await recordChapterSave({
      userId: user.id,
      chapterId: chapter.id,
      prevContent: "",
      nextContent: `<p>${words(60)}</p>`,
    });
    const today = await settleDay(user.id);
    expect(today.buckets.aiInserted).toBe(60);
    expect(today.buckets.humanTyped).toBe(0);
  });

  it("patches goals after validating the merged prefs", async () => {
    const user = await registerUser({
      email: "goals@example.com",
      password: "long-enough-pw",
    });
    const ok = await patchGoals(user.id, {
      dailyProseTarget: 750,
      reminderCadence: "weekdays",
      timezone: "America/Los_Angeles",
    });
    expect("error" in ok).toBe(false);
    if ("error" in ok) return;
    expect(ok.dailyProseTarget).toBe(750);
    expect(ok.reminderCadence).toBe("weekdays");
    expect(ok.timezone).toBe("America/Los_Angeles");

    const bad = await patchGoals(user.id, { reminderCadence: "every_n" });
    expect(bad).toMatchObject({ status: 400 });

    const stored = await getGoals(user.id);
    expect(stored.reminderCadence).toBe("weekdays");
  });
});
