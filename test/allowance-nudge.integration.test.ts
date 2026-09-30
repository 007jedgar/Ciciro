import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { meterAiRun, usagePeriod } from "@/lib/entitlements";
import type { PublicUser } from "@/lib/auth/session";

const fetchMock = vi.fn();

function nudgeSends() {
  return fetchMock.mock.calls.filter(([, init]) =>
    JSON.parse(init.body).tags?.some((t: { value: string }) => t.value === "allowance_nudge")
  );
}

describe("80% allowance nudge in meterAiRun", () => {
  const env = { ...process.env };
  let user: PublicUser;

  async function seedUser(opts: { optIn: boolean; runs: number }) {
    const row = await prisma.user.create({
      data: { email: "nudge@example.com", name: "Nudge", passwordHash: await hashPassword("pw-long-enough") },
    });
    await prisma.emailPreference.create({
      data: { userId: row.id, unsubscribeToken: "nudge-token", marketingOptIn: opts.optIn, offers: opts.optIn },
    });
    await prisma.usageCounter.create({ data: { userId: row.id, period: usagePeriod(), aiRuns: opts.runs } });
    user = { id: row.id, email: row.email, name: row.name } as PublicUser;
  }

  beforeEach(async () => {
    process.env.CICIRO_REQUIRE_AUTH = "true";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Ciciro <hello@ciciro.test>";
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await prisma.marketingEmailLog.deleteMany();
    await prisma.usageCounter.deleteMany();
    await prisma.emailPreference.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stays quiet below 80%", async () => {
    await seedUser({ optIn: true, runs: 10 });
    await meterAiRun(user);
    expect(nudgeSends()).toHaveLength(0);
  });

  it("sends once when a run crosses 80%, and not again the same period", async () => {
    await seedUser({ optIn: true, runs: 23 });
    await meterAiRun(user); // 24 of 30 = 80%
    await meterAiRun(user);
    await meterAiRun(user);
    expect(nudgeSends()).toHaveLength(1);
    const [, init] = nudgeSends()[0];
    expect(JSON.parse(init.body).headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("sends nothing to an account that has not opted in", async () => {
    await seedUser({ optIn: false, runs: 25 });
    await meterAiRun(user);
    expect(nudgeSends()).toHaveLength(0);
  });

  it("never fails the metered run when the nudge throws", async () => {
    await seedUser({ optIn: true, runs: 25 });
    fetchMock.mockImplementation(async () => {
      throw new Error("network down");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(meterAiRun(user)).resolves.toBeUndefined();
    const counter = await prisma.usageCounter.findFirstOrThrow({ where: { userId: user.id } });
    expect(counter.aiRuns).toBe(26);
    // A failed send releases its log row so a later run can retry.
    expect(await prisma.marketingEmailLog.count()).toBe(0);
  });
});
