import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { htmlToText } from "@/lib/text";

const model = vi.hoisted(() => ({
  responses: [] as Anthropic.Message[],
}));

const drafts = vi.hoisted(() => ({
  briefs: [] as string[],
}));

vi.mock("@/lib/anthropic", () => ({
  EDITOR_MODEL: "mock-editor",
  getAnthropic: () => ({
    messages: {
      stream: () => {
        const response = model.responses.shift();
        if (!response) throw new Error("No deterministic model response queued.");
        return {
          async *[Symbol.asyncIterator]() {
            for (const block of response.content) {
              if (block.type === "text" && block.text) {
                yield {
                  type: "content_block_delta",
                  delta: { type: "text_delta", text: block.text },
                };
              }
            }
          },
          finalMessage: async () => response,
        };
      },
    },
  }),
}));

vi.mock("@/lib/bible", () => ({
  ensureBible: vi.fn(async () => undefined),
}));

vi.mock("@/lib/compact", () => ({
  maybeCompactChat: vi.fn(async () => ({ compacted: false, removed: 0 })),
}));

vi.mock("@/lib/context", () => ({
  buildEditorContext: vi.fn(async () => "deterministic fixture context"),
}));

vi.mock("@/lib/fast-lane", () => ({
  editorRouteFromMessages: vi.fn(() => ({
    version: 1,
    lane: "editorial",
    reason: "autowrite",
  })),
  formatEditorRoute: vi.fn(() => "<editor_route>autowrite</editor_route>"),
  routeEditorWork: vi.fn(async () => ({
    version: 1,
    lane: "editorial",
    reason: "autowrite",
  })),
}));

vi.mock("@/lib/tools", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tools")>("@/lib/tools");
  return {
    ...actual,
    executeEditorTool: vi.fn(async (name, input, ctx) => {
      if (name === "dispatch_draft") {
        drafts.briefs.push(String(input.brief || ""));
        return {
          status: "ink on the page",
          content: "Rain stitched the alley shut. Mara kept walking.",
        };
      }
      return actual.executeEditorTool(name, input, ctx);
    }),
  };
});

import { prisma } from "@/lib/db";
import {
  buildAutoWriteMessage,
  clampTargetWords,
  prepareAutoWriteRun,
} from "@/lib/autowrite";
import {
  claimEditorRun,
  executeClaimedEditorRun,
} from "@/lib/editor-run";

const BEAT_PROSE = "Rain stitched the alley shut. Mara kept walking.";

function response(
  stopReason: Anthropic.Message["stop_reason"],
  content: unknown[] = []
): Anthropic.Message {
  return {
    id: crypto.randomUUID(),
    type: "message",
    role: "assistant",
    model: "mock-editor",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
    },
  } as unknown as Anthropic.Message;
}

async function createProject() {
  return prisma.project.create({
    data: {
      title: "Autowrite fixture",
      chapters: {
        create: {
          title: "Chapter 1",
          order: 0,
          content: "",
          wordCount: 0,
          revision: 0,
        },
      },
    },
    include: { chapters: { orderBy: { order: "asc" } } },
  });
}

describe("autowrite helpers", () => {
  it("clamps the chapter word target", () => {
    expect(clampTargetWords(undefined)).toBe(600);
    expect(clampTargetWords(50)).toBe(200);
    expect(clampTargetWords(9000)).toBe(4000);
    expect(clampTargetWords(800)).toBe(800);
  });

  it("asks the editor to dispatch, critique, and insert", () => {
    const message = buildAutoWriteMessage({
      targetWords: 700,
      guidance: "Open on the alley.",
    });
    expect(message).toContain("about 700 words");
    expect(message).toContain("Open on the alley.");
    expect(message).toContain("dispatch_draft");
    expect(message).toContain("insert_text");
    expect(message).toContain("two-dispatch cap does not apply");
  });
});

describe("autowrite durable loop", () => {
  beforeEach(async () => {
    model.responses.length = 0;
    drafts.briefs.length = 0;
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores kind autowrite and reuses the client turn id", async () => {
    const project = await createProject();
    const chapter = project.chapters[0];
    const input = {
      projectId: project.id,
      chapterId: chapter.id,
      targetWords: 600,
      clientTurnId: "autowrite-turn",
    };
    const first = await prepareAutoWriteRun(input);
    const duplicate = await prepareAutoWriteRun(input);
    expect(first?.run.id).toBe(duplicate?.run.id);
    expect(first?.run.kind).toBe("autowrite");
    expect(first?.run.scope).toBe("chapter");
    expect(first?.run.autoMode).toBe(true);
    expect(first?.run.activeChapterId).toBe(chapter.id);
    expect(await prisma.editorRun.count()).toBe(1);
    expect(
      await prisma.chatMessage.count({ where: { role: "user", kind: "autowrite" } })
    ).toBe(1);
  });

  it("dispatches, inserts, and completes a chapter in one slice", async () => {
    const project = await createProject();
    const chapter = project.chapters[0];
    const prepared = await prepareAutoWriteRun({
      projectId: project.id,
      chapterId: chapter.id,
      targetWords: 400,
      guidance: "Stay in the alley.",
      clientTurnId: "autowrite-complete",
    });
    model.responses.push(
      response("tool_use", [
        {
          type: "tool_use",
          id: "draft-1",
          name: "dispatch_draft",
          input: { brief: "Opening beat in the alley, past tense." },
        },
      ]),
      response("tool_use", [
        {
          type: "tool_use",
          id: "insert-1",
          name: "insert_text",
          input: {
            chapterNumber: 1,
            expectedRevision: 0,
            text: BEAT_PROSE,
            position: "end",
          },
        },
      ]),
      response("end_turn", [
        { type: "text", text: "The opening beat is in the chapter.", citations: null },
      ])
    );

    const events: Array<{ type: string } & Record<string, unknown>> = [];
    const claim = await claimEditorRun(prepared!.run.id);
    const result = await executeClaimedEditorRun(claim!, (event) => events.push(event));
    const persisted = await prisma.editorRun.findUniqueOrThrow({
      where: { id: prepared!.run.id },
      include: { steps: true },
    });
    const saved = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapter.id },
    });

    expect(drafts.briefs).toHaveLength(1);
    expect(result.status).toBe("completed");
    expect(persisted.status).toBe("completed");
    expect(persisted.kind).toBe("autowrite");
    expect(persisted.mutationCount).toBe(1);
    expect(persisted.steps).toHaveLength(3);
    expect(htmlToText(saved.content)).toContain("Rain stitched the alley shut");
    expect(saved.revision).toBe(1);
    expect(events.some((event) => event.type === "tool")).toBe(true);
    expect(
      events.some((event) => event.type === "phase" && event.status === "verifying")
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "chapter_updated" && event.chapterId === chapter.id
      )
    ).toBe(true);
  });

  it("checkpoints a dropped slice and resumes the dispatch/insert cycle", async () => {
    const project = await createProject();
    const chapter = project.chapters[0];
    const prepared = await prepareAutoWriteRun({
      projectId: project.id,
      chapterId: chapter.id,
      clientTurnId: "autowrite-resume",
    });
    model.responses.push(
      response("tool_use", [
        {
          type: "tool_use",
          id: "draft-resume",
          name: "dispatch_draft",
          input: { brief: "Continue the alley beat." },
        },
      ]),
      ...Array.from({ length: 5 }, () => response("max_tokens"))
    );

    const firstClaim = await claimEditorRun(prepared!.run.id);
    const first = await executeClaimedEditorRun(firstClaim!, () => {});
    const paused = await prisma.editorRun.findUniqueOrThrow({
      where: { id: prepared!.run.id },
      include: { steps: true },
    });

    expect(first.status).toBe("continuing");
    expect(paused.status).toBe("continuing");
    expect(paused.iterationCount).toBe(6);
    expect(paused.steps).toHaveLength(6);
    expect(paused.messagesJson).toContain("draft-resume");
    expect(paused.messagesJson).toContain("Rain stitched the alley shut");
    expect(paused.completedAt).toBeNull();
    expect(paused.lockToken).toBeNull();
    expect(drafts.briefs).toHaveLength(1);

    const midChapter = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapter.id },
    });
    expect(midChapter.content).toBe("");
    expect(midChapter.revision).toBe(0);

    model.responses.push(
      response("tool_use", [
        {
          type: "tool_use",
          id: "insert-resume",
          name: "insert_text",
          input: {
            chapterNumber: 1,
            expectedRevision: 0,
            text: BEAT_PROSE,
            position: "end",
          },
        },
      ]),
      response("end_turn", [
        { type: "text", text: "Inserted the beat and stopped.", citations: null },
      ])
    );

    const secondClaim = await claimEditorRun(prepared!.run.id);
    expect(secondClaim).not.toBeNull();
    const second = await executeClaimedEditorRun(secondClaim!, () => {});
    const finished = await prisma.editorRun.findUniqueOrThrow({
      where: { id: prepared!.run.id },
    });
    const saved = await prisma.chapter.findUniqueOrThrow({
      where: { id: chapter.id },
    });

    expect(second.status).toBe("completed");
    expect(finished.status).toBe("completed");
    expect(finished.mutationCount).toBe(1);
    expect(finished.messagesJson).toContain("draft-resume");
    expect(htmlToText(saved.content)).toContain("Mara kept walking");
    expect(saved.revision).toBe(1);
  });

  it("does not complete autowrite after a dispatch with no chapter write", async () => {
    const project = await createProject();
    const prepared = await prepareAutoWriteRun({
      projectId: project.id,
      chapterId: project.chapters[0].id,
      clientTurnId: "autowrite-no-insert",
    });
    model.responses.push(
      response("tool_use", [
        {
          type: "tool_use",
          id: "draft-only",
          name: "dispatch_draft",
          input: { brief: "Write a beat." },
        },
      ]),
      response("end_turn", [
        { type: "text", text: "Here is a draft in chat only.", citations: null },
      ])
    );

    const claim = await claimEditorRun(prepared!.run.id);
    const result = await executeClaimedEditorRun(claim!, () => {});
    const persisted = await prisma.editorRun.findUniqueOrThrow({
      where: { id: prepared!.run.id },
    });
    const chapter = await prisma.chapter.findUniqueOrThrow({
      where: { id: project.chapters[0].id },
    });

    expect(result.status).toBe("continuing");
    expect(persisted.status).toBe("continuing");
    expect(persisted.mutationCount).toBe(0);
    expect(persisted.messagesJson).toContain("Completion verification failed");
    expect(chapter.content).toBe("");
  });
});
