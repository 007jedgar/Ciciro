import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The author asks Ciciro in chat to record who knows what. This runs the real
// editor-run tool loop, the real editor context and the real tool, with only
// the model scripted: the open chapter the client sent has to reach the tool,
// and the fact has to land against it, mirror block and all.

const model = vi.hoisted(() => ({
  responses: [] as Anthropic.Message[],
  calls: [] as Array<{ params: Record<string, unknown> }>,
}));

vi.mock("@/lib/anthropic", () => ({
  EDITOR_MODEL: "claude-opus-5-5",
  getAnthropic: () => ({
    messages: {
      stream: (params: Record<string, unknown>) => {
        model.calls.push({ params: structuredClone(params) });
        const response = model.responses.shift();
        if (!response) throw new Error("No deterministic model response queued.");
        return {
          async *[Symbol.asyncIterator]() {
            for (const block of response.content) {
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

vi.mock("@/lib/compact", () => ({
  maybeCompactChat: vi.fn(async () => ({ compacted: false, removed: 0 })),
}));

import { prisma } from "@/lib/db";
import { readBibleFile, writeBibleFile } from "@/lib/bible";
import { claimEditorRun, executeClaimedEditorRun, prepareEditorRun, type EditorRunInput } from "@/lib/editor-run";

function response(stopReason: Anthropic.Message["stop_reason"], content: unknown[]): Anthropic.Message {
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

async function seed() {
  const project = await prisma.project.create({
    data: {
      title: "The Pen",
      chapters: {
        create: [
          { title: "The Shop", order: 0, content: "<p>Joe locked the shop at dusk.</p>" },
          { title: "The Attic", order: 1, content: "<p>Joe found ink on Suzy's sleeve.</p>" },
          { title: "The Accusation", order: 2, content: "<p>Joe accused Suzy.</p>" },
        ],
      },
    },
    include: { chapters: { orderBy: { order: "asc" } } },
  });
  await writeBibleFile(project.id, "characters/joe.md", "# Joe\n\nA locksmith.\n");
  await writeBibleFile(project.id, "characters/suzy.md", "# Suzy\n\nA courier.\n");
  return project;
}

async function run(input: EditorRunInput) {
  const events: Array<Record<string, unknown>> = [];
  const prepared = await prepareEditorRun(input);
  const claim = await claimEditorRun(prepared!.run.id);
  const result = await executeClaimedEditorRun(claim!, (event) => events.push(event as Record<string, unknown>));
  return { result, events };
}

function toolResultText(call: { params: Record<string, unknown> }): string {
  const messages = call.params.messages as Array<{ role: string; content: unknown }>;
  const last = messages[messages.length - 1];
  const blocks = Array.isArray(last.content) ? (last.content as Array<Record<string, unknown>>) : [];
  return blocks
    .filter((block) => block.type === "tool_result")
    .map((block) => String(block.content))
    .join("\n");
}

describe("asking Ciciro to record who knows what", () => {
  beforeEach(async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    model.responses.length = 0;
    model.calls.length = 0;
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records the fact against the chapter the author has open, even on a Chat only turn", async () => {
    const project = await seed();
    const open = project.chapters[1];
    model.responses.push(
      response("tool_use", [
        { type: "text", text: "Recording that." },
        {
          type: "tool_use",
          id: "toolu_record",
          name: "record_knowledge",
          input: { character: "Joe", stance: "suspects", fact: "Suzy has the pen", topic: "who has the pen" },
        },
      ]),
      response("end_turn", [
        {
          type: "text",
          text: 'Recorded: Joe suspects "Suzy has the pen", from chapter 2 ("The Attic"). Want me to change or remove it?',
        },
      ])
    );

    const { result, events } = await run({
      projectId: project.id,
      message: "Joe suspects Suzy has the pen. Record that.",
      activeChapterId: open.id,
      clientTurnId: "record-turn",
      editsAllowed: false,
    });

    expect(result.status).toBe("completed");

    // The model was told which chapter is open and offered the tool on a Chat only turn.
    const first = model.calls[0].params as { tools: Array<{ name: string }> };
    expect(first.tools.map((tool) => tool.name)).toContain("record_knowledge");
    expect(JSON.stringify(first)).toMatch(/2\. The Attic[^"]*<-- OPEN/);

    const [fact] = await prisma.knowledgeFact.findMany({ where: { projectId: project.id } });
    expect(fact).toMatchObject({
      characterPath: "characters/joe.md",
      stance: "suspects",
      fact: "Suzy has the pen",
      topic: "who has the pen",
      chapterId: open.id,
      status: "active",
    });
    expect(await readBibleFile(project.id, "characters/joe.md")).toContain(
      '<!-- knows:start -->\n## Who knows what\n- suspects (from "The Attic"): Suzy has the pen\n<!-- knows:end -->'
    );

    // The tool's report, which the reply repeats, names character, stance, fact and chapter.
    expect(toolResultText(model.calls[1])).toContain(
      `Recorded in who knows what: joe suspects "Suzy has the pen", from chapter 2 ("The Attic")`
    );
    expect(events).toContainEqual({ type: "knowledge_changed", characterPath: "characters/joe.md" });
  });

  it("answers what a character knows from the ledger as of the open chapter", async () => {
    const project = await seed();
    await prisma.knowledgeFact.create({
      data: {
        projectId: project.id,
        characterPath: "characters/joe.md",
        fact: "Suzy has the pen",
        stance: "believes_wrong",
        chapterId: project.chapters[2].id,
        status: "active",
      },
    });
    model.responses.push(
      response("tool_use", [
        { type: "tool_use", id: "toolu_read", name: "read_knowledge", input: { character: "Joe" } },
      ]),
      response("end_turn", [{ type: "text", text: "Nothing is recorded for Joe yet at this point." }])
    );

    await run({
      projectId: project.id,
      message: "What does Joe know at this point?",
      activeChapterId: project.chapters[0].id,
      clientTurnId: "read-turn",
    });

    const read = toolResultText(model.calls[1]);
    expect(read).toContain('Who knows what by the end of chapter 1 ("The Shop") for joe:');
    expect(read).toContain("(nothing recorded)");
    expect(read).not.toContain("Suzy has the pen");
  });
});
