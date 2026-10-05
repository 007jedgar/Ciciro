import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({
  responses: [] as Anthropic.Message[],
  calls: [] as Array<{ params: Record<string, unknown> }>,
}));

vi.mock("@/lib/anthropic", () => ({
  EDITOR_MODEL: "claude-opus-5-5",
  getAnthropic: () => ({
    messages: {
      stream: (params: Record<string, unknown>) => {
        model.calls.push({ params });
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

vi.mock("@/lib/bible", () => ({ ensureBible: vi.fn(async () => undefined) }));
vi.mock("@/lib/compact", () => ({
  maybeCompactChat: vi.fn(async () => ({ compacted: false, removed: 0 })),
}));
vi.mock("@/lib/context", () => ({
  buildEditorContext: vi.fn(async () => "deterministic fixture context"),
}));

import { prisma } from "@/lib/db";
import { loadChatSnapshot } from "@/lib/chat-history";
import { CHAT_ONLY_SYSTEM } from "@/lib/prompts";
import { MANUSCRIPT_WRITE_TOOLS } from "@/lib/edit-mode";
import {
  claimEditorRun,
  executeClaimedEditorRun,
  prepareEditorRun,
  type EditorRunInput,
} from "@/lib/editor-run";

const ORIGINAL = "<p>Mara crossed the bridge at dawn.</p>";

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
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Message;
}

const text = (value: string) => ({ type: "text", text: value });

async function createProject() {
  return prisma.project.create({
    data: {
      title: "Edit mode fixture",
      chapters: {
        create: [
          { title: "One", order: 0, content: ORIGINAL },
          { title: "Two", order: 1, content: "<p>Second chapter.</p>" },
        ],
      },
    },
    include: { chapters: { orderBy: { order: "asc" } } },
  });
}

async function run(input: EditorRunInput) {
  const prepared = await prepareEditorRun(input);
  const claim = await claimEditorRun(prepared!.run.id);
  const result = await executeClaimedEditorRun(claim!, () => {});
  return { runId: prepared!.run.id, result };
}

describe("chat edit mode (Allow edits / Chat only)", () => {
  beforeEach(async () => {
    model.responses.length = 0;
    model.calls.length = 0;
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("offers every tool, and no edit note, when edits are allowed (the default)", async () => {
    const project = await createProject();
    model.responses.push(response("end_turn", [text("Sure.")]));
    const { runId } = await run({
      projectId: project.id,
      message: "Say hi.",
      clientTurnId: "allowed-turn",
    });

    const stored = await prisma.editorRun.findUniqueOrThrow({ where: { id: runId } });
    expect(stored.editsAllowed).toBe(true);
    const params = model.calls[0].params as {
      tools: Array<{ name: string }>;
      system: Array<{ text: string }>;
    };
    const names = params.tools.map((tool) => tool.name);
    for (const name of MANUSCRIPT_WRITE_TOOLS) expect(names).toContain(name);
    expect(params.system[0].text).not.toContain(CHAT_ONLY_SYSTEM);
  });

  it("withholds every manuscript-writing tool and says so in the prompt on a Chat only turn", async () => {
    const project = await createProject();
    model.responses.push(response("end_turn", [text("Here is what I think.")]));
    const { runId, result } = await run({
      projectId: project.id,
      message: "What do you think of chapter one?",
      clientTurnId: "chat-only-turn",
      editsAllowed: false,
    });

    expect(result.status).toBe("completed");
    const stored = await prisma.editorRun.findUniqueOrThrow({ where: { id: runId } });
    expect(stored.editsAllowed).toBe(false);
    const params = model.calls[0].params as {
      tools: Array<{ name: string }>;
      system: Array<{ text: string }>;
    };
    const names = params.tools.map((tool) => tool.name);
    for (const name of MANUSCRIPT_WRITE_TOOLS) expect(names).not.toContain(name);
    // Reading and the story bible stay available.
    expect(names).toEqual(expect.arrayContaining(["read_chapter", "read_bible", "update_bible"]));
    expect(params.system[0].text).toContain(CHAT_ONLY_SYSTEM);
  });

  it("cannot write even when the model calls a writing tool anyway", async () => {
    const project = await createProject();
    const [one, two] = project.chapters;
    model.responses.push(
      response("tool_use", [
        {
          type: "tool_use",
          id: "t-insert",
          name: "insert_text",
          input: {
            chapterNumber: 1,
            expectedRevision: one.revision,
            text: "A sentence nobody asked for.",
            position: "end",
          },
        },
        {
          type: "tool_use",
          id: "t-create",
          name: "create_chapter",
          input: { title: "Unwanted" },
        },
        {
          type: "tool_use",
          id: "t-delete",
          name: "delete_passages",
          input: { passageId: "ch2.p1-p1", expectedRevision: two.revision },
        },
      ]),
      response("end_turn", [text("Edits are off, so I left the chapter alone.")])
    );

    const { runId, result } = await run({
      projectId: project.id,
      message: "Add a sentence to the end of chapter one and drop a chapter.",
      clientTurnId: "stale-write-turn",
      editsAllowed: false,
    });

    expect(result.status).toBe("completed");
    const chapters = await prisma.chapter.findMany({
      where: { projectId: project.id },
      orderBy: { order: "asc" },
    });
    expect(chapters).toHaveLength(2);
    expect(chapters[0].content).toBe(ORIGINAL);
    expect(chapters[0].revision).toBe(one.revision);
    expect(chapters[1].content).toBe(two.content);
    const stored = await prisma.editorRun.findUniqueOrThrow({ where: { id: runId } });
    expect(stored.mutationCount).toBe(0);
    expect(stored.messagesJson).toContain("Not run: the author has turned edits off");
  });

  it("completes an edit-shaped request without requiring the edit", async () => {
    const project = await createProject();
    model.responses.push(
      response("end_turn", [text("Edits are off. Switch to Allow edits and I will move it.")])
    );
    const { result } = await run({
      projectId: project.id,
      message: 'Move "Mara crossed the bridge at dawn." from chapter 1 to the end of chapter 2.',
      clientTurnId: "edit-shaped-turn",
      editsAllowed: false,
    });
    // With edits on, the intent gate would send this back for a mutation.
    expect(result.status).toBe("completed");
    expect(result.mutationCount).toBe(0);
  });

  it("keeps a turn's mode for its later slices, whatever a stale client sends", async () => {
    const project = await createProject();
    const first = await prepareEditorRun({
      projectId: project.id,
      message: "Talk it over.",
      clientTurnId: "sticky-turn",
      editsAllowed: false,
    });
    const resumed = await prepareEditorRun({
      projectId: project.id,
      resumeTurnId: "sticky-turn",
      editsAllowed: true,
    });
    expect(resumed?.run.id).toBe(first?.run.id);
    expect(resumed?.run.editsAllowed).toBe(false);

    model.responses.push(response("end_turn", [text("Still just talking.")]));
    const claim = await claimEditorRun(resumed!.run.id);
    await executeClaimedEditorRun(claim!, () => {});
    const names = (model.calls[0].params.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).not.toContain("insert_text");
  });

  it("reports each turn's mode in the chat snapshot so a reload restores the conversation's", async () => {
    const project = await createProject();
    model.responses.push(response("end_turn", [text("One.")]), response("end_turn", [text("Two.")]));
    await run({ projectId: project.id, message: "First.", clientTurnId: "snap-1" });
    await run({
      projectId: project.id,
      message: "Second.",
      clientTurnId: "snap-2",
      editsAllowed: false,
    });
    const { runs } = await loadChatSnapshot(project.id);
    expect(runs.map((r) => r.editsAllowed)).toEqual([true, false]);
  });
});
