import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { runWelcomeSequenceCron } from "@/lib/email/welcome-sequence";
import { runChangelogDigestCron } from "@/lib/email/changelog-digest";

const ORIGIN = "http://localhost";
const DAY_MS = 24 * 60 * 60 * 1000;

const fetchMock = vi.fn();

function categoriesSent(): string[] {
  return fetchMock.mock.calls.map(([, init]) => {
    const body = JSON.parse(init.body);
    return body.tags?.find((t: { name: string }) => t.name === "category")?.value;
  });
}

async function optedInUser(label: string, daysAgo: number, patch: Partial<{ productUpdates: boolean; weeklyEmail: boolean }> = {}) {
  const user = await prisma.user.create({
    data: { email: `${label}@example.com`, name: label, passwordHash: await hashPassword(`${label}-pw`) },
  });
  await prisma.emailPreference.create({
    data: {
      userId: user.id,
      unsubscribeToken: `${label}-token`,
      marketingOptIn: true,
      marketingOptInAt: new Date(Date.now() - daysAgo * DAY_MS),
      productUpdates: true,
      weeklyEmail: true,
      offers: true,
      ...patch,
    },
  });
  return user;
}

async function addManuscript(userId: string) {
  const project = await prisma.project.create({ data: { userId, title: "Draft", author: "Author" } });
  await prisma.chapter.create({ data: { projectId: project.id, title: "Ch1", order: 0, content: "<p>x</p>" } });
  return project;
}

describe("email cron selection logic", () => {
  const env = { ...process.env };

  beforeEach(async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Ciciro <hello@ciciro.test>";
    delete process.env.MARKETING_EMAIL_FROM;
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ id: `email_${fetchMock.mock.calls.length}` }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    await prisma.marketingEmailLog.deleteMany();
    await prisma.chapterOp.deleteMany();
    await prisma.chapter.deleteMany();
    await prisma.project.deleteMany();
    await prisma.emailPreference.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(() => {
    process.env = { ...env };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("welcome sequence", () => {
    it("sends welcome-2 at day 3 only when there is no chapter yet", async () => {
      await optedInUser("no-chapter", 3);
      await runWelcomeSequenceCron(new Date(), ORIGIN);
      expect(categoriesSent()).toEqual(["welcome_2"]);
    });

    it("skips welcome-2 at day 3 once a chapter exists", async () => {
      const user = await optedInUser("has-chapter", 3);
      await addManuscript(user.id);
      await runWelcomeSequenceCron(new Date(), ORIGIN);
      expect(categoriesSent()).toEqual([]);
    });

    it("skips welcome-2 before day 3", async () => {
      await optedInUser("too-soon", 1);
      await runWelcomeSequenceCron(new Date(), ORIGIN);
      expect(categoriesSent()).toEqual([]);
    });

    it("sends welcome-3 at day 7 only once a manuscript exists", async () => {
      const withManuscript = await optedInUser("day7-with", 7);
      await addManuscript(withManuscript.id);
      await optedInUser("day7-without", 7);
      await runWelcomeSequenceCron(new Date(), ORIGIN);
      // day7-with has a chapter, so welcome-2 does not fire for it, and it
      // gets welcome-3 instead; day7-without has no chapter yet, so it gets
      // welcome-2 (having no manuscript, it is not due for welcome-3).
      expect(categoriesSent().sort()).toEqual(["welcome_2", "welcome_3"]);
    });

    it("sends welcome-4 at day 14 unconditionally", async () => {
      const user = await optedInUser("day14", 14);
      await addManuscript(user.id);
      await runWelcomeSequenceCron(new Date(), ORIGIN);
      expect(categoriesSent().sort()).toEqual(["welcome_3", "welcome_4"]);
    });

    it("never sends when productUpdates is off, even after opting in", async () => {
      await optedInUser("no-topic", 14, { productUpdates: false });
      await runWelcomeSequenceCron(new Date(), ORIGIN);
      expect(categoriesSent()).toEqual([]);
    });

    it("is idempotent: a second run on the same day sends nothing new", async () => {
      await optedInUser("repeat", 3);
      await runWelcomeSequenceCron(new Date(), ORIGIN);
      await runWelcomeSequenceCron(new Date(), ORIGIN);
      expect(categoriesSent()).toEqual(["welcome_2"]);
    });
  });

  describe("changelog digest", () => {
    function monday(): Date {
      const now = new Date();
      const day = now.getUTCDay();
      const offset = day === 1 ? 0 : ((8 - day) % 7);
      return new Date(now.getTime() + offset * DAY_MS);
    }

    function notMonday(): Date {
      const now = new Date();
      const day = now.getUTCDay();
      const offset = day === 2 ? 1 : day === 1 ? -1 : 2 - day;
      return new Date(now.getTime() + offset * DAY_MS);
    }

    it("only sends on Monday", async () => {
      await optedInUser("weekday", 30);
      await runChangelogDigestCron(notMonday(), ORIGIN);
      expect(categoriesSent()).toEqual([]);
    });

    it("sends a batch of the most recent entries on Monday", async () => {
      await optedInUser("subscriber", 30);
      await runChangelogDigestCron(monday(), ORIGIN);
      expect(categoriesSent()).toEqual(["changelog_digest"]);
    });

    it("skips a user who has already seen everything in the batch", async () => {
      await optedInUser("caught-up", 30);
      await runChangelogDigestCron(monday(), ORIGIN);
      fetchMock.mockClear();
      await runChangelogDigestCron(new Date(monday().getTime() + 7 * DAY_MS), ORIGIN);
      expect(categoriesSent()).toEqual([]);
    });

    it("skips entirely when weeklyEmail is off", async () => {
      await optedInUser("off-topic", 30, { weeklyEmail: false });
      await runChangelogDigestCron(monday(), ORIGIN);
      expect(categoriesSent()).toEqual([]);
    });
  });
});
