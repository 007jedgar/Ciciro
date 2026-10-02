import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { notifyAutowriteFinished, notifyChatFinished } from "@/lib/push/run-finished";

type Call = { url: string; body: unknown };

function fakeExpo() {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body });
    const data = url.endsWith("/getReceipts") ? {} : (body as unknown[]).map(() => ({ status: "ok", id: "t1" }));
    return new Response(JSON.stringify({ data }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
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

describe("run-finished push notifications", () => {
  beforeEach(async () => {
    await prisma.pushNotificationLog.deleteMany();
    await prisma.pushPreference.deleteMany();
    await prisma.pushTicket.deleteMany();
    await prisma.pushToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    vi.unstubAllGlobals();
  });

  it("notifyChatFinished pushes with the project title and a chat deep link", async () => {
    const userId = await accountWithToken("ada");
    const project = await prisma.project.create({ data: { userId, title: "Tides" } });
    const calls = fakeExpo();

    await notifyChatFinished(userId, project.id, "turn-1");

    const sent = calls.filter((c) => c.url.endsWith("/send"));
    expect(sent).toHaveLength(1);
    expect((sent[0].body as { title: string; body: string; data: unknown }[])[0]).toMatchObject({
      title: "Ciciro finished writing",
      body: 'Your reply in "Tides" is ready.',
      data: { kind: "chat-finished", href: `/project/${project.id}/ciciro`, turnId: "turn-1" },
    });
  });

  it("notifyChatFinished sends the same turn at most once", async () => {
    const userId = await accountWithToken("ada");
    const project = await prisma.project.create({ data: { userId, title: "Tides" } });
    const calls = fakeExpo();

    await notifyChatFinished(userId, project.id, "turn-1");
    await notifyChatFinished(userId, project.id, "turn-1");

    expect(calls.filter((c) => c.url.endsWith("/send"))).toHaveLength(1);
  });

  it("notifyAutowriteFinished pushes with a manuscript deep link", async () => {
    const userId = await accountWithToken("ada");
    const project = await prisma.project.create({ data: { userId, title: "Tides" } });
    const chapter = await prisma.chapter.create({
      data: { projectId: project.id, title: "One", order: 0, content: "" },
    });
    const calls = fakeExpo();

    await notifyAutowriteFinished(userId, project.id, chapter.id);

    const sent = calls.filter((c) => c.url.endsWith("/send"));
    expect(sent).toHaveLength(1);
    expect((sent[0].body as { title: string; body: string; data: unknown }[])[0]).toMatchObject({
      title: "Ciciro finished writing",
      body: 'A new draft in "Tides" is ready.',
      data: { kind: "autowrite-finished", href: `/project/${project.id}/manuscript?chapterId=${chapter.id}` },
    });
  });

  it("respects the chatFinished preference for both engines", async () => {
    const userId = await accountWithToken("ada");
    await prisma.pushPreference.create({ data: { userId, chatFinished: false } });
    const project = await prisma.project.create({ data: { userId, title: "Tides" } });
    const calls = fakeExpo();

    await notifyChatFinished(userId, project.id, "turn-1");
    await notifyAutowriteFinished(userId, project.id, "chapter-1");

    expect(calls.filter((c) => c.url.endsWith("/send"))).toHaveLength(0);
  });
});
