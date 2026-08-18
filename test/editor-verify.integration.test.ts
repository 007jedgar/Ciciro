import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fixture from "./fixtures/malformed-manuscript.json";
import {
  buildEditorIntent,
  formatEditorIntent,
  type EditorIntentContract,
} from "@/lib/editor-intent";
import { verifyEditorCompletion } from "@/lib/editor-verify";
import { prisma } from "@/lib/db";
import { executeEditorTool } from "@/lib/tools";

async function seed(contents = fixture.chapters.map((chapter) => chapter.content)) {
  return prisma.project.create({
    data: {
      title: "Verification fixture",
      chapters: {
        create: fixture.chapters.map((chapter, order) => ({
          ...chapter,
          content: contents[order],
          order,
        })),
      },
    },
    include: { chapters: { orderBy: { order: "asc" } } },
  });
}

function messages(contract: EditorIntentContract): Anthropic.MessageParam[] {
  return [
    {
      role: "user",
      content: `${formatEditorIntent(contract)}\n\n${fixture.prompt}`,
    },
  ];
}

function verifiedContract(alreadyHeld: boolean): EditorIntentContract {
  return {
    version: 1,
    category: "reorganization",
    actionRequired: true,
    sourceChapters: [1],
    destinationChapters: [2],
    phases: ["inspect", "compare", "mutate", "verify"],
    desiredOperations: [
      { kind: "move_passage", sourceChapter: 1, destinationChapter: 2 },
      {
        kind: "split_inline_chapter_boundary",
        sourceChapter: 1,
        destinationChapter: 2,
      },
    ],
    postconditions: {
      inlineMarkersAbsent: [
        { chapter: 1, marker: fixture.boundary, destinationChapter: 2 },
      ],
      passages: [
        {
          sourceChapter: 1,
          destinationChapter: 2,
          normalizedText: fixture.duplicatePassage.toLocaleLowerCase(),
          origin: "inline_marker",
        },
      ],
    },
    initialEvidence: {
      inlineMarkers: alreadyHeld
        ? []
        : [{ chapter: 1, marker: fixture.boundary, destinationChapter: 2 }],
      selectionProvided: false,
      desiredStateAlreadyHeld: alreadyHeld,
    },
  };
}

describe("intent-aware completion verification", () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("builds deterministic postconditions for the malformed fixture", async () => {
    const project = await seed();
    const intent = await buildEditorIntent({
      projectId: project.id,
      activeChapterId: project.chapters[0].id,
      message: fixture.prompt,
      kind: "action",
    });

    expect(intent.sourceChapters).toEqual([1]);
    expect(intent.destinationChapters).toEqual([2]);
    expect(intent.postconditions.inlineMarkersAbsent).toContainEqual({
      chapter: 1,
      marker: "CHAPTER 2",
      destinationChapter: 2,
    });
    expect(intent.postconditions.passages[0]).toMatchObject({
      sourceChapter: 1,
      destinationChapter: 2,
      origin: "inline_marker",
    });
    expect(intent.initialEvidence.desiredStateAlreadyHeld).toBe(false);
  });

  it("prevents false success when no mutation or prior no-op evidence exists", async () => {
    const project = await seed();
    const result = await verifyEditorCompletion({
      projectId: project.id,
      messages: messages(verifiedContract(false)),
      mutationCount: 0,
    });

    expect(result.passed).toBe(false);
    expect(result.noOp).toBe(false);
    expect(result.failedReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Inline marker"),
        expect.stringContaining("No relevant successful mutation"),
      ])
    );
  });

  it("accepts a fully evidenced correct no-op", async () => {
    const correctedSource =
      "<p>The hospital improvised a hastily assembled press conference featuring the Surgeon</p>";
    const project = await seed([correctedSource, fixture.chapters[1].content]);
    const result = await verifyEditorCompletion({
      projectId: project.id,
      messages: messages(verifiedContract(true)),
      mutationCount: 0,
    });

    expect(result.passed).toBe(true);
    expect(result.noOp).toBe(true);
    expect(result.failedReasons).toEqual([]);
  });

  it("rejects unmatched tool calls even when manuscript postconditions pass", async () => {
    const correctedSource =
      "<p>The hospital improvised a hastily assembled press conference featuring the Surgeon</p>";
    const project = await seed([correctedSource, fixture.chapters[1].content]);
    const transcript = messages(verifiedContract(true));
    transcript.push({
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "missing-result",
          name: "passage_exists",
          input: { chapterNumber: 2, passage: fixture.duplicatePassage },
        },
      ],
    });
    const result = await verifyEditorCompletion({
      projectId: project.id,
      messages: transcript,
      mutationCount: 0,
    });

    expect(result.passed).toBe(false);
    expect(result.unmatchedToolUseIds).toEqual(["missing-result"]);
  });

  it("completes an unpinnable cross-chapter move on revision-safe mutation evidence", async () => {
    // A reorg with a known source and destination but no selection and no fused
    // inline chapter marker: the exact passage is only identifiable by the model
    // at runtime, so intent parsing cannot derive a deterministic passage
    // postcondition. Completion must still be reachable once a revision-safe
    // mutation is recorded - otherwise the run loops as `continuing` forever.
    const project = await prisma.project.create({
      data: {
        title: "Unpinnable move",
        chapters: {
          create: [
            {
              title: "One",
              order: 0,
              revision: 2,
              content:
                "<p>A calm opening about the harbor.</p><p>A misplaced paragraph about spaceships that belongs elsewhere.</p>",
            },
            {
              title: "Two",
              order: 1,
              revision: 1,
              content: "<p>The second chapter proceeds normally.</p>",
            },
          ],
        },
      },
      include: { chapters: { orderBy: { order: "asc" } } },
    });

    const intent = await buildEditorIntent({
      projectId: project.id,
      activeChapterId: project.chapters[0].id,
      message: "move the misplaced paragraph from chapter 1 to chapter 2",
      kind: "chat",
    });

    // Precondition for the bug: a move op exists with no deterministic postcondition.
    expect(intent.desiredOperations).toContainEqual({
      kind: "move_passage",
      sourceChapter: 1,
      destinationChapter: 2,
    });
    expect(intent.postconditions.passages).toEqual([]);
    expect(intent.postconditions.inlineMarkersAbsent).toEqual([]);

    const transcript: Anthropic.MessageParam[] = [
      { role: "user", content: `${formatEditorIntent(intent)}\n\n${"move it"}` },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "mv",
            name: "move_text",
            input: {
              from: "ch1.p2",
              toChapter: 2,
              position: "end",
              expectedSourceRevision: 2,
              expectedDestinationRevision: 1,
            },
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "mv", content: "Moved." }],
      },
    ];

    const completed = await verifyEditorCompletion({
      projectId: project.id,
      messages: transcript,
      mutationCount: 1,
    });
    expect(completed.passed).toBe(true);
    expect(completed.noOp).toBe(false);
    expect(
      completed.checks.find(
        (check) => check.name === "intent_has_verifiable_postconditions"
      )?.passed
    ).toBe(true);

    // Guard against false completion: with no mutation and no deterministic
    // no-op evidence, the same intent must still fail rather than complete.
    const noWork = await verifyEditorCompletion({
      projectId: project.id,
      messages: [transcript[0]],
      mutationCount: 0,
    });
    expect(noWork.passed).toBe(false);
    expect(noWork.failedReasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("No relevant successful mutation"),
      ])
    );
  });

  it("resolves the exact malformed fixture without duplicating chapter 2", async () => {
    const project = await seed();
    const intent = await buildEditorIntent({
      projectId: project.id,
      activeChapterId: project.chapters[0].id,
      message: fixture.prompt,
      kind: "action",
    });
    const toolInput = {
      sourceChapter: 1,
      destinationChapter: 2,
      boundary: fixture.boundary,
      expectedSourceRevision: fixture.chapters[0].revision,
      expectedDestinationRevision: fixture.chapters[1].revision,
    };
    const toolResult = await executeEditorTool(
      "split_chapter_at",
      toolInput,
      { projectId: project.id }
    );
    const transcript = messages(intent);
    transcript.push(
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "fixture-split",
            name: "split_chapter_at",
            input: toolInput,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "fixture-split",
            content: toolResult.content,
          },
        ],
      }
    );
    const verification = await verifyEditorCompletion({
      projectId: project.id,
      messages: transcript,
      mutationCount: toolResult.mutationCount || 0,
    });
    const chapters = await prisma.chapter.findMany({
      where: { projectId: project.id },
      orderBy: { order: "asc" },
    });

    expect(toolResult.mutationCount).toBe(1);
    expect(verification.passed).toBe(true);
    expect(verification.noOp).toBe(false);
    expect(chapters[0].revision).toBe(fixture.chapters[0].revision + 1);
    expect(chapters[1].revision).toBe(fixture.chapters[1].revision);
    expect(chapters[1].content).toBe(fixture.chapters[1].content);
  });
});
