import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/malformed-manuscript.json";

const model = vi.hoisted(() => ({
  responses: [] as Anthropic.Message[],
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
    lane: "mechanical",
    reason: "fixture",
  })),
  formatEditorRoute: vi.fn(() => "<editor_route>fixture</editor_route>"),
  routeEditorWork: vi.fn(async () => ({
    version: 1,
    lane: "mechanical",
    reason: "fixture",
  })),
}));

import { prisma } from "@/lib/db";
import {
  claimEditorRun,
  executeClaimedEditorRun,
  prepareEditorRun,
} from "@/lib/editor-run";

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

async function createProject(withFixture = false) {
  return prisma.project.create({
    data: {
      title: "Lifecycle fixture",
      chapters: withFixture
        ? {
            create: fixture.chapters.map((chapter, order) => ({
              ...chapter,
              order,
            })),
          }
        : undefined,
    },
    include: { chapters: { orderBy: { order: "asc" } } },
  });
}

describe("durable editor lifecycle", () => {
  beforeEach(async () => {
    model.responses.length = 0;
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("uses client turn ids idempotently and excludes duplicate claims", async () => {
    const project = await createProject();
    const input = {
      projectId: project.id,
      message: "Give me a short status update.",
      clientTurnId: "idempotent-turn",
    };
    const first = await prepareEditorRun(input);
    const duplicate = await prepareEditorRun(input);
    expect(first?.run.id).toBe(duplicate?.run.id);
    expect(await prisma.editorRun.count()).toBe(1);
    expect(await prisma.chatMessage.count({ where: { role: "user" } })).toBe(1);

    const claim = await claimEditorRun(first!.run.id);
    expect(claim).not.toBeNull();
    expect(await claimEditorRun(first!.run.id)).toBeNull();
  });

  it("checkpoints slice exhaustion as continuing and retains prior tool results", async () => {
    const project = await createProject();
    const prepared = await prepareEditorRun({
      projectId: project.id,
      message: "Continue inspecting.",
      clientTurnId: "continuing-turn",
    });
    const retrievalText = "full retained chapter payload";
    const seededMessages: Anthropic.MessageParam[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "tool-read-1",
            name: "read_chapter",
            input: { number: 1 },
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-read-1",
            content: retrievalText,
          },
        ],
      },
    ];
    await prisma.editorRun.update({
      where: { id: prepared!.run.id },
      data: { messagesJson: JSON.stringify(seededMessages) },
    });
    model.responses.push(
      ...Array.from({ length: 6 }, () => response("max_tokens"))
    );

    const claim = await claimEditorRun(prepared!.run.id);
    const result = await executeClaimedEditorRun(claim!, () => {});
    const persisted = await prisma.editorRun.findUniqueOrThrow({
      where: { id: prepared!.run.id },
      include: { steps: true },
    });

    expect(result.status).toBe("continuing");
    expect(result.stopReason).toBe("max_tokens");
    expect(persisted.status).toBe("continuing");
    expect(persisted.iterationCount).toBe(6);
    expect(persisted.steps).toHaveLength(6);
    expect(persisted.messagesJson).toContain(retrievalText);
    expect(persisted.completedAt).toBeNull();
  });

  it("persists terminal refusal as failed instead of complete", async () => {
    const project = await createProject();
    const prepared = await prepareEditorRun({
      projectId: project.id,
      message: "Summarize the chapter.",
      clientTurnId: "failed-turn",
    });
    model.responses.push(
      response("refusal", [{ type: "text", text: "I cannot continue.", citations: null }])
    );

    const claim = await claimEditorRun(prepared!.run.id);
    const result = await executeClaimedEditorRun(claim!, () => {});
    const persisted = await prisma.editorRun.findUniqueOrThrow({
      where: { id: prepared!.run.id },
    });
    expect(result.status).toBe("failed");
    expect(persisted.status).toBe("failed");
    expect(persisted.error).toContain("refused");
    expect(persisted.lockToken).toBeNull();
  });

  it("keeps a stale-revision action continuing after verification", async () => {
    const project = await createProject(true);
    const prepared = await prepareEditorRun({
      projectId: project.id,
      activeChapterId: project.chapters[0].id,
      message: fixture.prompt,
      kind: "action",
      clientTurnId: "revision-conflict-turn",
    });
    model.responses.push(
      response("tool_use", [
        {
          type: "tool_use",
          id: "stale-delete",
          name: "delete_passages",
          input: {
            passageId: "ch1.p1",
            expectedRevision: fixture.chapters[0].revision - 1,
          },
        },
      ]),
      response("end_turn", [
        { type: "text", text: "The move is complete.", citations: null },
      ])
    );

    const claim = await claimEditorRun(prepared!.run.id);
    const result = await executeClaimedEditorRun(claim!, () => {});
    const persisted = await prisma.editorRun.findUniqueOrThrow({
      where: { id: prepared!.run.id },
    });

    expect(result.status).toBe("continuing");
    expect(persisted.status).toBe("continuing");
    expect(persisted.mutationCount).toBe(0);
    expect(persisted.messagesJson).toContain("STALE REVISION");
    expect(persisted.messagesJson).toContain("Completion verification failed");
  });
});
