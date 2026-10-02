import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { runWritingNudgeCron } from "@/lib/push/writing-nudge";

type Call = { url: string; body: unknown };

function fakeExpo() {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body });
    const data = url.endsWith("/getReceipts")
      ? {}
      : (body as { to: string }[]).map((m, i) => ({ status: "ok", id: `t-${i}-${m.to}` }));
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  (globalThis as { fetch: typeof fetch }).fetch = fetch as unknown as typeof globalThis.fetch;
  return calls;
}

async function accountWithToken(label: string) {
  const user = await prisma.user.create({ data: { email: `${label}@example.com`, passwordHash: "x" } });
  const session = await prisma.session.create({
    data: { userId: user.id, tokenHash: `${label}-hash`, expiresAt: new Date(Date.now() + 3600_000) },
  });
  await prisma.pushToken.create({
    data: { userId: user.id, sessionId: session.id, token: `ExponentPushToken[${label}]`, platform: "ios" },
  });
  return user.id;
}

async function writingDay(userId: string, date: string, words: number) {
  await prisma.writingDay.create({ data: { userId, date, words, activeMs: 1000 } });
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("runWritingNudgeCron", () => {
  beforeEach(async () => {
    await prisma.writingDay.deleteMany();
    await prisma.pushNotificationLog.deleteMany();
    await prisma.pushPreference.deleteMany();
    await prisma.pushTicket.deleteMany();
    await prisma.pushToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("nudges an account quiet for 7 days, and not one quiet for only 6", async () => {
    const now = new Date("2026-03-15T14:00:00Z");
    const quiet = await accountWithToken("quiet");
    await writingDay(quiet, "2026-03-08", 500); // exactly 7 days before "now"
    const recent = await accountWithToken("recent");
    await writingDay(recent, "2026-03-09", 500); // only 6 days before "now"

    const calls = fakeExpo();
    await runWritingNudgeCron(now);

    const sent = calls.filter((c) => c.url.endsWith("/send"));
    expect(sent).toHaveLength(1);
    expect((sent[0].body as { to: string }[])[0].to).toBe("ExponentPushToken[quiet]");
  });

  it("never nudges an account that has never written", async () => {
    await accountWithToken("fresh");
    const calls = fakeExpo();
    await runWritingNudgeCron(new Date("2026-03-15T14:00:00Z"));
    expect(calls.filter((c) => c.url.endsWith("/send"))).toHaveLength(0);
  });

  it("nudges at most once per lapse, and again after a fresh 7-day gap", async () => {
    const userId = await accountWithToken("once");
    await writingDay(userId, "2026-03-01", 500);
    const calls = fakeExpo();

    await runWritingNudgeCron(new Date("2026-03-08T14:00:00Z"));
    await runWritingNudgeCron(new Date(new Date("2026-03-08T14:00:00Z").getTime() + DAY_MS));
    expect(calls.filter((c) => c.url.endsWith("/send"))).toHaveLength(1);

    // Writing again moves the lapse anchor, so a fresh 7-day gap can nudge again.
    await writingDay(userId, "2026-03-10", 300);
    await runWritingNudgeCron(new Date("2026-03-17T14:00:00Z"));
    expect(calls.filter((c) => c.url.endsWith("/send"))).toHaveLength(2);
  });

  it("respects the writingNudge preference", async () => {
    const userId = await accountWithToken("off");
    await prisma.pushPreference.create({ data: { userId, writingNudge: false } });
    await writingDay(userId, "2026-03-01", 500);
    const calls = fakeExpo();
    await runWritingNudgeCron(new Date("2026-03-10T14:00:00Z"));
    expect(calls.filter((c) => c.url.endsWith("/send"))).toHaveLength(0);
  });
});
