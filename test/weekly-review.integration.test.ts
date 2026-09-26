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

describe("weekly review", () => {
  beforeEach(async () => {
    mocks.hasKey = true;
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
    expect(review.stats.chaptersTouched.length).toBeGreaterThan(0);
    expect(review.content.nextSteps).toEqual(["Write the harbour scene."]);

    const prompt = mocks.create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain("Words written this week: 900 across 2 of 7 days");
    expect(prompt).toContain("Who sent the letter?");
    expect(prompt).toContain("The locked door");
    expect(prompt).toContain("The ferry sinks");

    expect((await listWeeklyReviews(project.id, user)).map((r) => r.id)).toEqual([review.id]);
    expect(await getWeeklyReview(project.id, review.id, user)).toEqual(review);
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
