import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/malformed-manuscript.json";

const model = vi.hoisted(() => ({
  responses: [] as Anthropic.Message[],
  calls: [] as Array<{ params: Record<string, unknown>; options?: unknown }>,
  rejectDisplayOnce: false,
  editorModel: "claude-opus-5-5",
}));

vi.mock("@/lib/anthropic", () => ({
  get EDITOR_MODEL() {
    return model.editorModel;
  },
  getAnthropic: () => ({
    messages: {
      stream: (params: Record<string, unknown>, options?: unknown) => {
        model.calls.push({ params, options });
        const thinking = params.thinking as { display?: string } | undefined;
        if (model.rejectDisplayOnce && thinking?.display) {
          model.rejectDisplayOnce = false;
          throw Object.assign(
            new Error("400 thinking.display: unsupported value"),
            { status: 400 }
          );
        }
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
              } else if (block.type === "thinking" && block.thinking) {
                yield {
                  type: "content_block_delta",
                  delta: { type: "thinking_delta", thinking: block.thinking },
                };
              }
            }
            // Fixture hook: simulate a Stop request landing in the gap right
            // after this model call finishes (and any of its tools run) but
            // before the next iteration's model call - the exact boundary
            // the durable run is supposed to notice cancellation at.
            const cancelRunId = (response as unknown as { __cancelRunId?: string })
              .__cancelRunId;
            if (cancelRunId) {
              const { prisma: db } = await import("@/lib/db");
              await db.editorRun.updateMany({
                where: { id: cancelRunId },
                data: { cancelledAt: new Date() },
              });
            }
          },
          finalMessage: async () => response,
        };
      },
    },
  }),
}));

vi.mock("@/lib/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tools")>();
  return { ...actual, executeEditorTool: vi.fn(actual.executeEditorTool) };
});

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
import { registerUser } from "@/lib/auth/session";
import { updateUserSettings } from "@/lib/user-settings";
import { editorSystemFor } from "@/lib/prompts";
import { executeEditorTool } from "@/lib/tools";
import {
  cancelEditorRun,
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
    model: "claude-opus-5-5",
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
    model.calls.length = 0;
    model.rejectDisplayOnce = false;
    model.editorModel = "claude-opus-5-5";
    await prisma.project.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
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

  it("marks the context block cacheable so tool-loop iterations don't re-bill it", async () => {
    const project = await createProject();
    const prepared = await prepareEditorRun({
      projectId: project.id,
      message: "What happened in chapter one?",
      clientTurnId: "cache-control-turn",
    });
    const messages = JSON.parse(prepared!.run.messagesJson) as Anthropic.MessageParam[];
    const last = messages[messages.length - 1];
    expect(last.role).toBe("user");
    const blocks = last.content;
    expect(Array.isArray(blocks)).toBe(true);
    const contextBlock = (blocks as Anthropic.TextBlockParam[]).find(
      (block) => block.type === "text" && block.text.startsWith("<context>")
    );
    expect(contextBlock).toBeDefined();
    expect(contextBlock?.text).toContain("deterministic fixture context");
    expect(contextBlock?.cache_control).toEqual({ type: "ephemeral" });
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

  it("forwards thinking-summary deltas as progress events, leaving text deltas unchanged", async () => {
    const project = await createProject();
    const prepared = await prepareEditorRun({
      projectId: project.id,
      message: "What happened in chapter one?",
      clientTurnId: "progress-turn",
    });
    model.responses.push(
      response("end_turn", [
        {
          type: "thinking",
          thinking: "Checking chapter one for continuity.",
          signature: "sig-1",
        },
        { type: "text", text: "Chapter one is consistent.", citations: null },
      ])
    );

    const events: Array<{ type: string; v?: unknown }> = [];
    const claim = await claimEditorRun(prepared!.run.id);
    await executeClaimedEditorRun(claim!, (event) => {
      events.push(event as { type: string; v?: unknown });
    });

    const progressText = events
      .filter((event) => event.type === "progress")
      .map((event) => event.v)
      .join("");
    const textDeltas = events
      .filter((event) => event.type === "text")
      .map((event) => event.v)
      .join("");
    expect(progressText).toBe("Checking chapter one for continuity.");
    expect(textDeltas).toBe("Chapter one is consistent.");
  });

  async function runOnce(clientTurnId: string) {
    const project = await createProject();
    const prepared = await prepareEditorRun({
      projectId: project.id,
      message: "What happened in chapter one?",
      clientTurnId,
    });
    model.responses.push(
      response("end_turn", [
        { type: "text", text: "Chapter one is consistent.", citations: null },
      ])
    );
    const claim = await claimEditorRun(prepared!.run.id);
    await executeClaimedEditorRun(claim!, () => {});
  }

  it.each([false, true])(
    "builds the editor prompt with craft defaults only when the owner's setting is on (%s)",
    async (craftDefaults) => {
      const owner = await registerUser({ email: `craft-${craftDefaults}@example.com`, password: "long-enough-pw" });
      if (craftDefaults) await updateUserSettings(owner.id, { craftDefaults });
      const project = await prisma.project.create({ data: { title: "Craft", userId: owner.id } });
      const prepared = await prepareEditorRun({
        projectId: project.id,
        message: "What happened in chapter one?",
        clientTurnId: `craft-${craftDefaults}`,
      });
      model.responses.push(response("end_turn", [{ type: "text", text: "Nothing yet.", citations: null }]));
      await executeClaimedEditorRun((await claimEditorRun(prepared!.run.id))!, () => {});

      expect(model.calls[0].params.system).toEqual(editorSystemFor("novel", "", { craft: craftDefaults }));
      expect(JSON.stringify(model.calls[0].params.system).includes("# Craft defaults")).toBe(craftDefaults);
    }
  );

  it("requests progress notes on a model documented to support them", async () => {
    await runOnce("display-supported");
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0].params.thinking).toEqual({
      type: "adaptive",
      display: "updates",
    });
    expect(model.calls[0].options).toEqual({
      headers: { "anthropic-beta": "thinking-display-updates-2026-08-18" },
    });
  });

  it("sends plain adaptive thinking and no beta header on other models", async () => {
    model.editorModel = "claude-opus-4-8";
    await runOnce("display-unsupported");
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0].params.thinking).toEqual({ type: "adaptive" });
    expect(model.calls[0].options).toBeUndefined();
  });

  it("retries once without progress notes when the API rejects thinking.display", async () => {
    model.rejectDisplayOnce = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await runOnce("display-rejected");
    warn.mockRestore();
    expect(model.calls).toHaveLength(2);
    expect(model.calls[0].params.thinking).toEqual({
      type: "adaptive",
      display: "updates",
    });
    expect(model.calls[1].params.thinking).toEqual({ type: "adaptive" });
    expect(model.calls[1].options).toBeUndefined();
  });

  describe("cancellation", () => {
    it("finalizes a not-yet-claimed run immediately and marks its message partial", async () => {
      const project = await createProject();
      const prepared = await prepareEditorRun({
        projectId: project.id,
        message: "Write two new paragraphs.",
        clientTurnId: "cancel-idle-turn",
      });
      const runId = prepared!.run.id;
      await prisma.editorRun.update({
        where: { id: runId },
        data: {
          status: "continuing",
          visibleOutput: "Already written.",
          assistantMessageId: (
            await prisma.chatMessage.create({
              data: {
                projectId: project.id,
                role: "assistant",
                content: "Already written.",
                status: "continuing",
                turnId: prepared!.run.turnId,
              },
            })
          ).id,
        },
      });

      const updated = await cancelEditorRun(runId, project.id);
      expect(updated?.status).toBe("cancelled");
      expect(updated?.stopReason).toBe("user_cancelled");
      expect(updated?.cancelledAt).not.toBeNull();

      const persisted = await prisma.editorRun.findUniqueOrThrow({ where: { id: runId } });
      expect(persisted.status).toBe("cancelled");
      expect(persisted.lockToken).toBeNull();
      const assistant = await prisma.chatMessage.findUniqueOrThrow({
        where: { id: persisted.assistantMessageId! },
      });
      expect(assistant.status).toBe("partial");

      // Idempotent: cancelling an already-cancelled run is a no-op, not an error.
      const again = await cancelEditorRun(runId, project.id);
      expect(again?.status).toBe("cancelled");
    });

    it("only flags a claimed run so the active executor finalizes it, instead of racing its lease", async () => {
      const project = await createProject();
      const prepared = await prepareEditorRun({
        projectId: project.id,
        message: "Write two new paragraphs.",
        clientTurnId: "cancel-locked-turn",
      });
      const claim = await claimEditorRun(prepared!.run.id);
      expect(claim).not.toBeNull();

      const updated = await cancelEditorRun(prepared!.run.id, project.id);
      expect(updated?.status).toBe("running");
      expect(updated?.cancelledAt).not.toBeNull();
      expect(updated?.lockToken).toBe(claim!.claimToken);
    });

    it("stops before a second iteration once a concurrent Stop request lands, keeping the first iteration's work", async () => {
      const project = await createProject();
      const prepared = await prepareEditorRun({
        projectId: project.id,
        message: "Write chapter one, then chapter two.",
        clientTurnId: "cancel-between-iterations",
      });
      const runId = prepared!.run.id;

      const iteration1 = response("tool_use", [
        { type: "text", text: "Drafting chapter one.", citations: null },
        { type: "tool_use", id: "tool-1", name: "list_open_questions", input: {} },
      ]);
      // The reported bug: a second, unwanted iteration (e.g. an accidental
      // second chapter) starts before the author's Stop request is noticed.
      // This fixture simulates that request landing right after the first
      // iteration's model call and tool execution finish.
      (iteration1 as unknown as { __cancelRunId?: string }).__cancelRunId = runId;
      const iteration2 = response("end_turn", [
        { type: "text", text: "Drafting chapter two.", citations: null },
      ]);
      model.responses.push(iteration1, iteration2);

      const claim = await claimEditorRun(runId);
      const result = await executeClaimedEditorRun(claim!, () => {});
      const persisted = await prisma.editorRun.findUniqueOrThrow({
        where: { id: runId },
        include: { steps: true },
      });

      // The second model call (which would have drafted chapter two) never
      // happened - the unconsumed fixture response proves it.
      expect(model.calls).toHaveLength(1);
      expect(result.status).toBe("cancelled");
      expect(persisted.status).toBe("cancelled");
      expect(persisted.stopReason).toBe("user_cancelled");
      expect(persisted.visibleOutput).toContain("Drafting chapter one.");
      expect(persisted.visibleOutput).not.toContain("Drafting chapter two.");
      expect(persisted.lockToken).toBeNull();
      expect(persisted.leaseExpiresAt).toBeNull();
      expect(persisted.completedAt).toBeNull();
    });

    it("skips the rest of a response's tool calls once a Stop lands between them", async () => {
      const project = await createProject();
      const prepared = await prepareEditorRun({
        projectId: project.id,
        message: "Write two paragraphs.",
        clientTurnId: "cancel-between-tools",
      });
      const runId = prepared!.run.id;
      model.responses.push(
        response("tool_use", [
          { type: "text", text: "Creating two chapters.", citations: null },
          { type: "tool_use", id: "chapter-1", name: "create_chapter", input: { title: "One" } },
          { type: "tool_use", id: "chapter-2", name: "create_chapter", input: { title: "Two" } },
        ]),
        response("end_turn", [{ type: "text", text: "Done.", citations: null }])
      );
      const tool = vi.mocked(executeEditorTool);
      const actual = (await vi.importActual<typeof import("@/lib/tools")>("@/lib/tools"))
        .executeEditorTool;
      tool.mockClear();
      tool.mockImplementationOnce(async (...args) => {
        const result = await actual(...args);
        await prisma.editorRun.update({
          where: { id: runId },
          data: { cancelledAt: new Date() },
        });
        return result;
      });

      const claim = await claimEditorRun(runId);
      const result = await executeClaimedEditorRun(claim!, () => {});

      expect(tool).toHaveBeenCalledTimes(1);
      expect(model.calls).toHaveLength(1);
      const chapters = await prisma.chapter.findMany({ where: { projectId: project.id } });
      expect(chapters.map((chapter) => chapter.title)).toEqual(["One"]);
      expect(result.status).toBe("cancelled");
      const persisted = await prisma.editorRun.findUniqueOrThrow({ where: { id: runId } });
      expect(persisted.status).toBe("cancelled");
      expect(persisted.stopReason).toBe("user_cancelled");
      expect(persisted.lockToken).toBeNull();
      const transcript = JSON.parse(persisted.messagesJson) as Anthropic.MessageParam[];
      const toolResults = transcript[transcript.length - 1].content as Anthropic.ToolResultBlockParam[];
      expect(toolResults.map((block) => block.tool_use_id)).toEqual(["chapter-1", "chapter-2"]);
      expect(toolResults[1].content).toMatch(/stopped/);
    });

    it("leaves a run another executor just reclaimed to that executor, flagging it instead", async () => {
      const project = await createProject();
      const prepared = await prepareEditorRun({
        projectId: project.id,
        message: "Write two paragraphs.",
        clientTurnId: "cancel-reclaimed",
      });
      const runId = prepared!.run.id;
      await prisma.editorRun.update({
        where: { id: runId },
        data: {
          status: "running",
          lockToken: "dead-process",
          leaseExpiresAt: new Date(Date.now() - 1000),
        },
      });
      const findUnique = prisma.editorRun.findUnique.bind(prisma.editorRun);
      let reclaimed: Awaited<ReturnType<typeof claimEditorRun>> = null;
      const spy = vi
        .spyOn(prisma.editorRun, "findUnique")
        .mockImplementationOnce(((args: Parameters<typeof findUnique>[0]) =>
          findUnique(args).then(async (row) => {
            spy.mockRestore();
            reclaimed = await claimEditorRun(runId);
            return row;
          })) as unknown as typeof prisma.editorRun.findUnique);

      const updated = await cancelEditorRun(runId, project.id);
      spy.mockRestore();

      expect(reclaimed).not.toBeNull();
      expect(updated?.status).toBe("running");
      expect(updated?.cancelledAt).not.toBeNull();
      expect(updated?.lockToken).toBe(reclaimed!.claimToken);
    });

    it("self-heals a run left continuing with cancelledAt set, so it can never be resumed", async () => {
      const project = await createProject();
      const prepared = await prepareEditorRun({
        projectId: project.id,
        message: "Write two new paragraphs.",
        clientTurnId: "cancel-self-heal-turn",
      });
      const runId = prepared!.run.id;
      // Simulate the narrow race the comment in claimEditorRun describes: a
      // slice finished (status continuing, lease cleared) in the same
      // instant a Stop request flagged cancelledAt, so neither side
      // finalized the terminal status.
      await prisma.editorRun.update({
        where: { id: runId },
        data: { status: "continuing", cancelledAt: new Date() },
      });

      const claim = await claimEditorRun(runId);
      expect(claim).toBeNull();

      const persisted = await prisma.editorRun.findUniqueOrThrow({ where: { id: runId } });
      expect(persisted.status).toBe("cancelled");
      expect(persisted.stopReason).toBe("user_cancelled");
      expect(persisted.lockToken).toBeNull();
    });
  });
});
