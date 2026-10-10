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
import { assistantReplacementSplitter, elementTagOfHtml } from "@/lib/manuscript-kind";
import { CICIRO_AUTHOR, suggestReplacements } from "@/lib/suggestions";

type Request = Anthropic.MessageCreateParamsNonStreaming;

const PLAN = JSON.stringify({
  beats: [
    { goal: "Mara answers", brief: "Mara answers the question.", wordTarget: 100 },
    { goal: "The door", brief: "Someone is at the door.", wordTarget: 100 },
  ],
  openQuestions: [],
});

// Beat one starts on a bare dialogue line: the chapter ends on a cue. Beat two
// opens on an ALL-CAPS action line that a plain classifier would call a cue.
const BEATS = [
  "Where is he?\n!BOOM.\n!The lamp swings.\n@JONAH\nHere.",
  "!SOMEONE KNOCKS.\n@MARA\n(whispering)\nDon't.\nSTOP.",
];

function reply(text: string) {
  return { content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
}

const isPlan = (req: Request) => Array.isArray(req.system) && String(req.messages[0].content).includes("Plan the drafting");
const isEdit = (req: Request) => Array.isArray(req.system) && String(req.messages[0].content).includes("editing one drafted beat");

describe("auto-draft writes a script as elements", () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
    mocks.create.mockReset();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function run(
    content = '<p data-sp="scene-heading">INT. LAB - DAY</p><p data-sp="character">MARA</p>'
  ) {
    const project = await prisma.project.create({ data: { title: "Heist", kind: "screenplay" } });
    const chapter = await prisma.chapter.create({
      data: {
        projectId: project.id,
        title: "Sequence 1",
        order: 0,
        content,
      },
    });
    let beat = 0;
    mocks.create.mockImplementation(async (req: Request) => {
      if (isPlan(req)) return reply(PLAN);
      if (isEdit(req)) return reply(/<draft>\n([\s\S]*?)\n<\/draft>/.exec(String(req.messages[0].content))?.[1] ?? "");
      if (String(req.system).startsWith("You check a passage")) return reply('{"findings":[]}');
      return reply(BEATS[beat++]);
    });
    const events: Record<string, unknown>[] = [];
    await runAutoWrite({
      projectId: project.id,
      chapterId: chapter.id,
      targetWords: 200,
      guidance: "",
      emit: (e) => events.push(e),
      shouldStop: () => false,
    });
    const saved = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    return { saved, events, calls: mocks.create.mock.calls.map((c) => c[0] as Request) };
  }

  const tagged = (html: string) =>
    (html.match(/<p\b[^>]*>.*?<\/p>/g) ?? []).map((b) => [elementTagOfHtml(b), b.replace(/<[^>]+>/g, "")]);

  it("reads each beat on from the element the script has reached", async () => {
    const { saved } = await run();
    expect(tagged(saved.content)).toEqual([
      ["scene-heading", "INT. LAB - DAY"],
      ["character", "MARA"],
      // The chapter ends on a cue, so the first bare line is her dialogue.
      ["dialogue", "Where is he?"],
      ["action", "BOOM."],
      ["action", "The lamp swings."],
      ["character", "JONAH"],
      ["dialogue", "Here."],
      ["action", "SOMEONE KNOCKS."],
      ["character", "MARA"],
      ["parenthetical", "whispering"],
      ["dialogue", "Don't."],
      ["dialogue", "STOP."],
    ]);
  });

  it("gives the drafter the last elements as marked lines, and asks for marked lines back", async () => {
    const { calls } = await run();
    const drafts = calls.filter((r) => !Array.isArray(r.system) && !String(r.system).startsWith("You check"));
    expect(drafts).toHaveLength(2);
    expect(String(drafts[0].system)).toContain("^CLOSE ON THE KNIFE");
    expect(String(drafts[0].messages[0].content)).toContain("<continuity>\n.INT. LAB - DAY\n\n@MARA\n</continuity>");
    // The second beat sees the first as it landed, ending on Jonah's line.
    expect(String(drafts[1].messages[0].content)).toContain("!The lamp swings.\n\n@JONAH\nHere.\n</continuity>");
    const edits = calls.filter(isEdit);
    expect(String(edits[0].messages[0].content)).toContain("<before>\n.INT. LAB - DAY\n\n@MARA\n</before>");
  });

  it("continues from the script as it stands, not from a pending suggestion", async () => {
    const { html } = suggestReplacements(
      '<p data-sp="scene-heading">INT. LAB - DAY</p><p data-sp="action">The lamp swings.</p>',
      [{ find: "The lamp swings.", replace: "!The lamp swings.\n@JONAH" }],
      { author: CICIRO_AUTHOR, splitReplacement: assistantReplacementSplitter("screenplay") }
    );
    const { calls, saved } = await run(html);
    const drafts = calls.filter((r) => !Array.isArray(r.system) && !String(r.system).startsWith("You check"));
    expect(String(drafts[0].messages[0].content)).toContain(
      "<continuity>\n.INT. LAB - DAY\n\n!The lamp swings.\n</continuity>"
    );
    // The pending cue is not the author's, so the first bare line is action, not its dialogue.
    expect(tagged(saved.content).find(([, text]) => text === "Where is he?")?.[0]).toBe("action");
  });

  it("shows the author the pages without the marks", async () => {
    const { events } = await run();
    const prose = events.filter((e) => e.type === "prose").map((e) => String(e.v));
    expect(prose).toEqual([
      "Where is he?\nBOOM.\nThe lamp swings.\nJONAH\nHere.",
      "SOMEONE KNOCKS.\nMARA\n(whispering)\nDon't.\nSTOP.",
    ]);
    const done = events.find((e) => e.type === "done");
    expect(done).toMatchObject({ beats: 2 });
  });
});
