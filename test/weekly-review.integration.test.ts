import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), hasKey: true }));

vi.mock("@/lib/anthropic", () => ({
  DRAFTER_MODEL: "claude-sonnet-5",
  hasAnthropicKey: () => mocks.hasKey,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { writeBibleFile } from "@/lib/bible";
import {
  deleteWeeklyReview,
  generateWeeklyReview,
  getWeeklyReview,
  listWeeklyReviews,
} from "@/lib/weekly-review";

const REPLY = JSON.stringify({
  summary: "You wrote 900 words over two days.",
  looseEnds: ["Who sent the letter?"],
  nextSteps: ["Write the harbour scene."],
});

function reply(text: string) {
  mocks.create.mockResolvedValue({ content: [{ type: "text", text }] });
}

async function seed(email = "ada@example.com") {
  const user = await registerUser({ email, password: "long-enough-pw" });
  const project = await createProject(user, { title: "Tides" });
  return { user, project };
}

async function chapterOf(projectId: string, title = "The Ferry") {
  return prisma.chapter.create({ data: { projectId, title, order: 99, wordCount: 1200 } });
}

let opSeq = 0;
async function editAt(chapter: { id: string; projectId: string }, at: Date, actor = "user") {
  opSeq += 1;
  await prisma.chapterOp.create({
    data: {
      chapterId: chapter.id,
      projectId: chapter.projectId,
      opId: `op-${opSeq}`,
      seq: opSeq,
      baseRevision: opSeq - 1,
      actor,
      type: "replace_block",
      payload: "{}",
      createdAt: at,
    },
  });
}

function prompt(call = 0): string {
  return mocks.create.mock.calls[call][0].messages[0].content as string;
}

describe("weekly review", () => {
  beforeEach(async () => {
    mocks.hasKey = true;
    mocks.create.mockReset();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores a review built from writing days, touched chapters and the story bible", async () => {
    const { user, project } = await seed();
    await prisma.writingDay.createMany({
      data: [
        { userId: user.id, date: "2026-09-21", words: 500, activeMs: 60_000 },
        { userId: user.id, date: "2026-09-24", words: 400, activeMs: 30_000 },
        { userId: user.id, date: "2026-09-01", words: 9999, activeMs: 1 },
      ],
    });
    await prisma.openQuestion.create({ data: { projectId: project.id, question: "Who sent the letter?" } });
    await prisma.plotPoint.create({ data: { projectId: project.id, title: "The locked door" } });
    await writeBibleFile(project.id, "plot.md", "# Plot\nThe ferry sinks in act two.");
    const ferry = await chapterOf(project.id);
    await editAt(ferry, new Date(2026, 8, 24, 12));
    reply(REPLY);

    const review = await generateWeeklyReview(project.id, user, { to: "2026-09-26" });
    expect(review).toMatchObject({ weekStart: "2026-09-20", weekEnd: "2026-09-26" });
    expect(review.stats).toMatchObject({
      words: 900,
      daysWritten: 2,
      activeMs: 90_000,
      openQuestions: 1,
      openThreads: 1,
    });
    expect(review.stats.days).toHaveLength(7);
    expect(review.stats.chaptersTouched).toEqual([
      { id: ferry.id, title: "The Ferry", wordCount: 1200 },
    ]);
    expect(review.content.nextSteps).toEqual(["Write the harbour scene."]);

    const text = prompt();
    expect(text).toContain("Account-wide words written this week: 900 across 2 of 7 days");
    expect(text).toContain("Chapters edited in this manuscript this week: The Ferry (1200 words)");
    expect(text).toContain("Who sent the letter?");
    expect(text).toContain("The locked door");
    expect(text).toContain("The ferry sinks");

    expect((await listWeeklyReviews(project.id, user)).map((r) => r.id)).toEqual([review.id]);
    expect(await getWeeklyReview(project.id, review.id, user)).toEqual(review);
  });

  it("does not credit one manuscript with words written in another", async () => {
    const { user, project: a } = await seed();
    const b = await createProject(user, { title: "Embers" });
    await prisma.writingDay.create({
      data: { userId: user.id, date: "2026-09-23", words: 3000, activeMs: 600_000 },
    });
    await editAt(await chapterOf(a.id), new Date(2026, 8, 23, 9));
    reply(REPLY);

    const reviewB = await generateWeeklyReview(b.id, user, { to: "2026-09-26" });
    expect(reviewB.stats.chaptersTouched).toEqual([]);
    const text = prompt();
    expect(text).toContain("Chapters edited in this manuscript this week: none");
    expect(text).toContain("Account-wide words written this week: 3000 across 1 of 7 days");
    expect(text).not.toMatch(/^Words written this week/m);

    reply(REPLY);
    const reviewA = await generateWeeklyReview(a.id, user, { to: "2026-09-26" });
    expect(reviewA.stats.chaptersTouched.map((c) => c.title)).toEqual(["The Ferry"]);
  });

  it("lists only chapters with content edits inside the requested week", async () => {
    const { user, project } = await seed();
    const inside = await chapterOf(project.id, "Inside");
    const before = await chapterOf(project.id, "Before");
    const after = await chapterOf(project.id, "After");
    const reordered = await chapterOf(project.id, "Reordered");
    await editAt(inside, new Date(2026, 8, 14, 23, 30));
    await editAt(before, new Date(2026, 8, 12, 23, 59));
    await editAt(after, new Date(2026, 8, 20, 0, 1));
    await prisma.chapter.update({ where: { id: reordered.id }, data: { order: 0 } });
    reply(REPLY);

    const review = await generateWeeklyReview(project.id, user, { to: "2026-09-19" });
    expect(review.stats.chaptersTouched.map((c) => c.title)).toEqual(["Inside"]);
  });

  it("bounds the week by the author's timezone, not the server's", async () => {
    const { user, project } = await seed();
    const evening = await chapterOf(project.id, "Evening");
    const early = await chapterOf(project.id, "Too early");
    await editAt(evening, new Date("2026-09-27T03:00:00.000Z"));
    await editAt(early, new Date("2026-09-20T05:00:00.000Z"));
    reply(REPLY);

    const review = await generateWeeklyReview(project.id, user, { to: "2026-09-26", tzOffset: 420 });
    expect(review.stats.chaptersTouched.map((c) => c.title)).toEqual(["Evening"]);
    await expect(
      generateWeeklyReview(project.id, user, { to: "2026-09-26", tzOffset: "-7" })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      generateWeeklyReview(project.id, user, { to: "2026-09-26", tzOffset: 5000 })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("lists only chapters the author edited, not ones only Ciciro changed", async () => {
    const { user, project } = await seed();
    const mine = await chapterOf(project.id, "Mine");
    const aiOnly = await chapterOf(project.id, "AI only");
    const corrected = await chapterOf(project.id, "Corrected");
    await editAt(mine, new Date(2026, 8, 22, 10));
    await editAt(aiOnly, new Date(2026, 8, 23, 10), "ai");
    await editAt(corrected, new Date(2026, 8, 24, 10), "correction");
    reply(REPLY);

    const review = await generateWeeklyReview(project.id, user, { to: "2026-09-26" });
    expect(review.stats.chaptersTouched.map((c) => c.title)).toEqual(["Mine"]);
    expect(prompt()).toContain("Chapters edited in this manuscript this week: Mine (1200 words)");
  });

  it("maps editor outages to a retryable error without storing a review", async () => {
    const { user, project } = await seed();
    mocks.create.mockRejectedValueOnce(Object.assign(new Error("overloaded"), { status: 529 }));
    await expect(generateWeeklyReview(project.id, user, {})).rejects.toMatchObject({ status: 503 });
    mocks.create.mockRejectedValueOnce(Object.assign(new Error("rate limited"), { status: 429 }));
    await expect(generateWeeklyReview(project.id, user, {})).rejects.toMatchObject({ status: 503 });
    mocks.create.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(generateWeeklyReview(project.id, user, {})).rejects.toMatchObject({ status: 502 });
    expect(await listWeeklyReviews(project.id, user)).toEqual([]);
  });

  it("refuses without an API key, on a bad model reply and on a bad date", async () => {
    const { user, project } = await seed();
    mocks.hasKey = false;
    await expect(generateWeeklyReview(project.id, user, {})).rejects.toMatchObject({ status: 503 });
    mocks.hasKey = true;
    reply("not json");
    await expect(generateWeeklyReview(project.id, user, {})).rejects.toMatchObject({ status: 502 });
    await expect(generateWeeklyReview(project.id, user, { to: "yesterday" })).rejects.toMatchObject({
      status: 400,
    });
    expect(await listWeeklyReviews(project.id, user)).toEqual([]);
  });

  it("keeps reviews private, deletable, and gone with the manuscript", async () => {
    const { user, project } = await seed();
    const other = await registerUser({ email: "bob@example.com", password: "long-enough-pw" });
    reply(REPLY);
    const review = await generateWeeklyReview(project.id, user, {});
    await expect(listWeeklyReviews(project.id, other)).rejects.toMatchObject({ status: 403 });
    await expect(getWeeklyReview(project.id, review.id, other)).rejects.toMatchObject({ status: 403 });
    await expect(generateWeeklyReview(project.id, other, {})).rejects.toMatchObject({ status: 403 });
    await expect(getWeeklyReview(project.id, "nope", user)).rejects.toMatchObject({ status: 404 });

    await deleteWeeklyReview(project.id, review.id, user);
    expect(await listWeeklyReviews(project.id, user)).toEqual([]);
    reply(REPLY);
    await generateWeeklyReview(project.id, user, {});
    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.weeklyReview.count()).toBe(0);
  });
});
