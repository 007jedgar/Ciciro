import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Confirms the gap this scope found: nothing told the author their chat
// reply finished once they looked away. Mocking a model reply that takes a
// moment to arrive gives a window to cancel the stream reader (standing in
// for a disconnect or the app backgrounding) before the run's own "done"
// event would have reached the client, then checks that event's failed
// delivery triggers exactly the push notifyChatFinished
// (src/lib/push/run-finished.ts) describes. The Anthropic streaming mock
// mirrors test/editor-run.integration.test.ts's proven shape (a bare
// `.create` mock does not match the SDK's `.messages.stream()` call and
// silently fails every run).

const model = vi.hoisted(() => ({
  responses: [] as Anthropic.Message[],
  delayMs: 0,
}));

vi.mock("@/lib/anthropic", () => ({
  EDITOR_MODEL: "claude-opus-5-5",
  getAnthropic: () => ({
    messages: {
      stream: () => {
        const response = model.responses.shift();
        if (!response) throw new Error("No deterministic model response queued.");
        return {
          async *[Symbol.asyncIterator]() {
            if (model.delayMs) await new Promise((resolve) => setTimeout(resolve, model.delayMs));
            for (const block of response.content as { type: string; text?: string }[]) {
              if (block.type === "text" && block.text) {
                yield { type: "content_block_delta", delta: { type: "text_delta", text: block.text } };
              }
            }
          },
          finalMessage: async () => response,
        };
      },
    },
  }),
}));

vi.mock("@/lib/bible", () => ({ ensureBible: vi.fn(async () => undefined) }));
vi.mock("@/lib/compact", () => ({ maybeCompactChat: vi.fn(async () => ({ compacted: false, removed: 0 })) }));
vi.mock("@/lib/context", () => ({ buildEditorContext: vi.fn(async () => "fixture context") }));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { hashSessionToken } from "@/lib/auth/tokens";
import { POST as chat } from "@/app/api/chat/route";

function textResponse(text: string): Anthropic.Message {
  return {
    id: crypto.randomUUID(),
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Message;
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
  return { userId: user.id, token, projectId: project.id };
}

function request(body: unknown, token: string) {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", [SESSION_HEADER]: token },
    body: JSON.stringify(body),
  });
}

async function readOneLine(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const { value } = await reader.read();
  return JSON.parse(new TextDecoder().decode(value));
}

describe("chat finished while disconnected", () => {
  beforeEach(async () => {
    model.responses.length = 0;
    model.delayMs = 0;
    await prisma.pushTicket.deleteMany();
    await prisma.pushToken.deleteMany();
    await prisma.pushNotificationLog.deleteMany();
    await prisma.pushPreference.deleteMany();
    await prisma.editorRun.deleteMany();
    await prisma.chatMessage.deleteMany();
    await prisma.project.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    vi.unstubAllGlobals();
  });

  it("pushes the author once the reply finishes after they disconnected", async () => {
    const a = await author("ada");
    model.delayMs = 80;
    model.responses.push(textResponse("Hi there."));
    const calls = fakeExpo();

    const res = await chat(request({ projectId: a.projectId, message: "Hello" }, a.token));
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const first = await readOneLine(reader); // {type:"turn",...} — proves the stream was live
    expect(first.type).toBe("turn");
    await reader.cancel(); // stand-in for a disconnect / the app backgrounding

    // The delayed reply resolves at ~80ms, the run then emits "done" against
    // a now-cancelled stream; give it room to finish and push.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await prisma.editorRun.findFirstOrThrow({ where: { projectId: a.projectId } })).toMatchObject({
      status: "completed",
    });
    const sent = calls.filter((c) => c.url.endsWith("/send"));
    expect(sent).toHaveLength(1);
    expect((sent[0].body as { to: string; title: string; data: unknown }[])[0]).toMatchObject({
      to: "ExponentPushToken[ada]",
      title: "Ciciro finished writing",
      data: { kind: "chat-finished", href: `/project/${a.projectId}/ciciro` },
    });
  });

  it("does not push for a run that finished without a reply", async () => {
    const a = await author("cal");
    model.delayMs = 80;
    model.responses.push(textResponse(" "));
    const calls = fakeExpo();

    const res = await chat(request({ projectId: a.projectId, message: "Hello" }, a.token));
    const reader = res.body!.getReader();
    expect((await readOneLine(reader)).type).toBe("turn");
    await reader.cancel();

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await prisma.editorRun.findFirstOrThrow({ where: { projectId: a.projectId } })).toMatchObject({
      status: "completed",
    });
    expect(calls.filter((c) => c.url.endsWith("/send"))).toHaveLength(0);
  });

  it("does not push when the reader kept reading to the end", async () => {
    const a = await author("ben");
    model.responses.push(textResponse("Hi there."));
    const calls = fakeExpo();

    const res = await chat(request({ projectId: a.projectId, message: "Hello" }, a.token));
    await res.text(); // drain the whole stream, like a client that stayed watching

    expect(await prisma.editorRun.findFirstOrThrow({ where: { projectId: a.projectId } })).toMatchObject({
      status: "completed",
    });
    expect(calls.filter((c) => c.url.endsWith("/send"))).toHaveLength(0);
  });
});
