import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/anthropic")>()),
  hasAnthropicKey: () => true,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { runAutoWrite } from "@/lib/autowrite";

type Request = Anthropic.MessageCreateParamsNonStreaming;

const DRAFT = "Mara ran for the harbor. The bell kept ringing behind her. She did not look back.";
const CUT_OFF_EDIT = "Mara ran for the harbor. The bell kept";
const PLAN = JSON.stringify({
  beats: [{ goal: "Mara runs", brief: "POV close third, past. Mara runs.", wordTarget: 380 }],
  openQuestions: [],
});

function reply(text: string, stop_reason = "end_turn") {
  return { content: [{ type: "text", text }], stop_reason, usage: { input_tokens: 1, output_tokens: 1 } };
}

function isEdit(req: Request) {
  return Array.isArray(req.system) && String(req.messages[0].content).includes("editing one drafted beat");
}

async function runOneBeat() {
  const project = await prisma.project.create({ data: { title: "Tides" } });
  const chapter = await prisma.chapter.create({
    data: { projectId: project.id, title: "One", order: 0, content: "" },
  });
  const events: Record<string, unknown>[] = [];
  await runAutoWrite({
    projectId: project.id,
    chapterId: chapter.id,
    targetWords: 380,
    guidance: "",
    emit: (e) => events.push(e),
    shouldStop: () => false,
  });
  const saved = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
  return { saved, events };
}

// Opus thinks before it writes, and thinking spends the same max_tokens budget.
// A beat edit capped at wordTarget*4 tokens came back cut off mid-sentence and
// was committed to the chapter as the beat's final prose.
describe("auto-draft length limits", () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
    mocks.create.mockReset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps the full draft when the beat edit is cut off at its token limit", async () => {
    mocks.create.mockImplementation(async (req: Request) => {
      if (Array.isArray(req.system)) {
        if (String(req.messages[0].content).includes("Plan the drafting")) return reply(PLAN);
        return reply(CUT_OFF_EDIT, "max_tokens");
      }
      if (String(req.system).startsWith("You check a passage")) return reply('{"findings":[]}');
      return reply(DRAFT);
    });
    const { saved, events } = await runOneBeat();
    expect(saved.content).toContain("She did not look back.");
    expect(saved.content).not.toContain(`${CUT_OFF_EDIT}<`);
    expect(events.some((e) => e.type === "note" && String(e.v).includes("edit skipped"))).toBe(true);
  });

  it("does not commit a draft that was itself cut off", async () => {
    mocks.create.mockImplementation(async (req: Request) => {
      if (Array.isArray(req.system)) return reply(PLAN);
      return reply("Mara ran for the", "max_tokens");
    });
    const { saved, events } = await runOneBeat();
    expect(saved.content).not.toContain("Mara ran for the");
    expect(events.some((e) => e.type === "note" && String(e.v).includes("draft failed"))).toBe(true);
  });

  it("leaves thinking room in every beat request", async () => {
    mocks.create.mockImplementation(async (req: Request) => {
      if (Array.isArray(req.system)) {
        if (String(req.messages[0].content).includes("Plan the drafting")) return reply(PLAN);
        return reply(DRAFT);
      }
      if (String(req.system).startsWith("You check a passage")) return reply('{"findings":[]}');
      return reply(DRAFT);
    });
    await runOneBeat();
    const calls = mocks.create.mock.calls.map((c) => c[0] as Request);
    const edit = calls.find(isEdit);
    const draft = calls.find((r) => !Array.isArray(r.system) && !String(r.system).startsWith("You check"));
    // 380 words is ~500 tokens of prose; the rest is room to think.
    expect(edit?.max_tokens).toBeGreaterThanOrEqual(16000);
    expect(draft?.max_tokens).toBeGreaterThanOrEqual(16000);
  });
});
