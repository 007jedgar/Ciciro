import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), delayMs: 0, plan: "" }));

vi.mock("@/lib/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/anthropic")>()),
  hasAnthropicKey: () => true,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import type Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { hashSessionToken } from "@/lib/auth/tokens";
import { POST as autowrite } from "@/app/api/autowrite/route";

// Mirrors test/autowrite-truncation.integration.test.ts's proven `.create()`
// mock (autowrite drafts with plain, non-streaming calls, unlike chat's
// `.messages.stream()` tool loop). The plan has exactly one beat, so the
// run's only `shouldStop()` check (src/lib/autowrite.ts's beat loop) has
// already passed by the time the draft call is in flight — delaying that one
// reply gives a window to cancel the stream after it without the run
// stopping early, so it genuinely finishes while "disconnected".

type Request = Anthropic.MessageCreateParamsNonStreaming;

const PLAN = JSON.stringify({
  beats: [{ goal: "Mara runs", brief: "POV close third, past. Mara runs.", wordTarget: 200 }],
  openQuestions: [],
});
const TWO_BEAT_PLAN = JSON.stringify({
  beats: [
    { goal: "Mara runs", brief: "POV close third, past. Mara runs.", wordTarget: 200 },
    { goal: "Mara hides", brief: "POV close third, past. Mara hides.", wordTarget: 200 },
  ],
  openQuestions: [],
});
const DRAFT = "Mara ran for the harbor. The bell kept ringing behind her.";
const EDITED = "Mara ran for the harbor, the bell still ringing behind her.";

function reply(text: string) {
  return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
}

function isPlan(req: Request) {
  return Array.isArray(req.system) && String(req.messages[0].content).includes("Plan the drafting");
}

function dispatcher(req: Request) {
  if (Array.isArray(req.system)) {
    if (isPlan(req)) return reply(mocks.plan);
    return reply(EDITED); // editBeatToFinal, unconditional
  }
  if (mocks.delayMs) {
    return new Promise((resolve) => setTimeout(() => resolve(reply(DRAFT)), mocks.delayMs));
  }
  return reply(DRAFT);
}

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

async function author(label: string) {
  const user = await prisma.user.create({ data: { email: `${label}@example.com`, passwordHash: "x" } });
  const token = `${label}-token`;
  const session = await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  await prisma.pushToken.create({
    data: { userId: user.id, sessionId: session.id, token: `ExponentPushToken[${label}]`, platform: "ios" },
  });
  const project = await prisma.project.create({ data: { userId: user.id, title: "Tides" } });
  const chapter = await prisma.chapter.create({ data: { projectId: project.id, title: "One", order: 0, content: "" } });
  return { userId: user.id, token, projectId: project.id, chapterId: chapter.id };
}

function request(body: unknown, token: string) {
  return new NextRequest("http://localhost/api/autowrite", {
    method: "POST",
    headers: { "content-type": "application/json", [SESSION_HEADER]: token },
    body: JSON.stringify(body),
  });
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (event: Record<string, unknown>) => boolean
) {
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return null;
    for (const line of new TextDecoder().decode(value).split("\n").filter(Boolean)) {
      const event = JSON.parse(line);
      if (predicate(event)) return event;
    }
  }
}

describe("autowrite finished while disconnected", () => {
  beforeEach(async () => {
    mocks.create.mockReset();
    mocks.create.mockImplementation(dispatcher);
    mocks.delayMs = 0;
    mocks.plan = PLAN;
    await prisma.pushTicket.deleteMany();
    await prisma.pushToken.deleteMany();
    await prisma.pushNotificationLog.deleteMany();
    await prisma.pushPreference.deleteMany();
    await prisma.chapter.deleteMany();
    await prisma.project.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    vi.unstubAllGlobals();
  });

  it("pushes the author once the draft finishes after they disconnected", async () => {
    const a = await author("ada");
    mocks.delayMs = 80;
    const calls = fakeExpo();

    const res = await autowrite(request({ projectId: a.projectId, chapterId: a.chapterId }, a.token));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    // Past this event, the run's only shouldStop() check already happened.
    const drafting = await readUntil(reader, (e) => e.type === "beat" && e.status === "drafting");
    expect(drafting).not.toBeNull();
    await reader.cancel(); // stand-in for a disconnect / the app backgrounding

    // The push goes out after the chapter is saved, behind several queries and
    // a fetch, so wait for it rather than for a fixed time a slow runner can miss.
    const sendCalls = () => calls.filter((c) => c.url.endsWith("/send"));
    await vi.waitFor(() => expect(sendCalls()).toHaveLength(1), { timeout: 5000 });

    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: a.chapterId } });
    expect(chapter.content).toContain(EDITED);
    const sent = sendCalls();
    expect(sent).toHaveLength(1);
    expect((sent[0].body as { to: string; title: string; data: unknown }[])[0]).toMatchObject({
      to: "ExponentPushToken[ada]",
      title: "Ciciro finished writing",
      data: { kind: "autowrite-finished", href: `/project/${a.projectId}/manuscript?chapterId=${a.chapterId}` },
    });
  });

  it("does not push for a multi-beat draft the disconnect cut short", async () => {
    const a = await author("cal");
    mocks.plan = TWO_BEAT_PLAN;
    mocks.delayMs = 80;
    const calls = fakeExpo();

    const res = await autowrite(request({ projectId: a.projectId, chapterId: a.chapterId }, a.token));
    const reader = res.body!.getReader();
    await readUntil(reader, (e) => e.type === "beat" && e.status === "drafting" && e.i === 1);
    await reader.cancel(); // the second beat's shouldStop() check now sees the stop

    await new Promise((resolve) => setTimeout(resolve, 300));

    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: a.chapterId } });
    expect(chapter.content).toContain(EDITED); // the first beat was still saved
    expect(mocks.create.mock.calls.filter(([req]) => !Array.isArray(req.system))).toHaveLength(1);
    expect(calls.filter((c) => c.url.endsWith("/send"))).toHaveLength(0);
  });

  it("does not push for a finished run that wrote nothing", async () => {
    const a = await author("dee");
    mocks.create.mockImplementation((req: Request) =>
      Array.isArray(req.system)
        ? dispatcher(req)
        : new Promise((_, reject) => setTimeout(() => reject(new Error("overloaded")), 80))
    );
    const calls = fakeExpo();

    const res = await autowrite(request({ projectId: a.projectId, chapterId: a.chapterId }, a.token));
    const reader = res.body!.getReader();
    await readUntil(reader, (e) => e.type === "beat" && e.status === "drafting");
    await reader.cancel();

    await new Promise((resolve) => setTimeout(resolve, 300));

    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: a.chapterId } });
    expect(chapter.content).not.toContain(EDITED);
    expect(calls.filter((c) => c.url.endsWith("/send"))).toHaveLength(0);
  });

  it("does not push when the reader kept reading to the end", async () => {
    const a = await author("ben");
    const calls = fakeExpo();

    const res = await autowrite(request({ projectId: a.projectId, chapterId: a.chapterId }, a.token));
    await res.text();

    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: a.chapterId } });
    expect(chapter.content).toContain(EDITED);
    expect(calls.filter((c) => c.url.endsWith("/send"))).toHaveLength(0);
  });
});
