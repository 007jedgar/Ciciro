import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, registerUser, type PublicUser } from "@/lib/auth/session";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { AuthError } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { updateChapter, recordAiInvolvement, MAX_AI_INVOLVEMENT_DELTA } from "@/lib/chapters";
import { ciciroAcceptedWordCount } from "@/lib/suggestions";
import { executeEditorTool } from "@/lib/tools";
import { aiInvolvement } from "@/lib/text";
import { POST as postAiInvolvement } from "@/app/api/chapters/[id]/ai-involvement/route";
import { POST as postInsertion } from "@/app/api/chat/insertions/route";
import { resolveSuggestions } from "@/lib/suggestions";
import { saveManualSnapshot } from "@/lib/snapshots";
import { restoreSnapshot } from "@/lib/snapshot-restore";

const PROSE = '<p data-block-id="b1">She walked slowly to the door.</p>';

async function seed(): Promise<{ user: PublicUser; projectId: string; chapterId: string; revision: number }> {
  const user = await registerUser({ email: "ada@example.com", password: "long-enough-pw", name: "Ada" });
  const project = await createProject(user, { title: "Involvement" });
  const chapter = project.chapters[0];
  const saved = await updateChapter(chapter.id, user, { content: PROSE, expectedRevision: chapter.revision });
  return { user, projectId: project.id, chapterId: chapter.id, revision: saved.chapter.revision };
}

describe("AI-involvement tally", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("starts every new chapter at zero, tracked from creation", async () => {
    const { chapterId } = await seed();
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.aiAcceptedWords).toBe(0);
    expect(chapter.aiDraftedWords).toBe(0);
    expect(aiInvolvement(chapter).ciciroWords).toBe(0);
    // A brand-new chapter's tracking starts at (essentially) its own creation.
    expect(Math.abs(chapter.aiInvolvementSince.getTime() - chapter.createdAt.getTime())).toBeLessThan(1000);
  });

  it("credits an accepted Ciciro suggestion's word count, taken before the marks are stripped", async () => {
    const { user, projectId, chapterId, revision } = await seed();
    await executeEditorTool(
      "edit_manuscript",
      { chapterNumber: 1, expectedRevision: revision, replacements: [{ find: "walked slowly", replace: "ambled" }] },
      { projectId }
    );
    const pending = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    const words = ciciroAcceptedWordCount(pending.content);
    expect(words).toBe(1);

    await recordAiInvolvement(chapterId, user, { acceptedWords: words });
    const after = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(after.aiAcceptedWords).toBe(1);
    expect(after.aiDraftedWords).toBe(0);
  });

  it("accumulates across repeated accept actions instead of overwriting", async () => {
    const { user, chapterId } = await seed();
    await recordAiInvolvement(chapterId, user, { acceptedWords: 3 });
    await recordAiInvolvement(chapterId, user, { acceptedWords: 4 });
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.aiAcceptedWords).toBe(7);
  });

  it("credits insert_text's word count as drafted, with no suggestion to accept", async () => {
    const { projectId, chapterId, revision } = await seed();
    await executeEditorTool(
      "insert_text",
      { chapterNumber: 1, expectedRevision: revision, text: "A brand new final line.", position: "end" },
      { projectId }
    );
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.aiDraftedWords).toBe(5);
    expect(chapter.aiAcceptedWords).toBe(0);
    expect(chapter.content).not.toContain("data-suggestion-id");
  });

  it("carries insert_text's new drafted tally in its chapter_updated event", async () => {
    const { projectId, chapterId, revision } = await seed();
    const result = await executeEditorTool(
      "insert_text",
      { chapterNumber: 1, expectedRevision: revision, text: "A brand new final line.", position: "end" },
      { projectId }
    );
    expect(result.ui).toMatchObject({ type: "chapter_updated", chapterId, aiDraftedWords: 5, wordsAdded: 11 });
  });

  it("counts every word the author adds, cumulatively, as the percentage's denominator", async () => {
    const { user, chapterId, revision } = await seed();
    const seeded = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(seeded.wordsAdded).toBe(6);

    const shorter = '<p data-block-id="b1">She walked to the door.</p>';
    const cut = await updateChapter(chapterId, user, { content: shorter, expectedRevision: revision });
    expect(cut.chapter.wordsAdded).toBe(6);

    const longer = '<p data-block-id="b1">She walked to the door. She knocked twice.</p>';
    const grown = await updateChapter(chapterId, user, { content: longer, expectedRevision: cut.chapter.revision });
    expect(grown.chapter.wordsAdded).toBe(9);
  });

  it("puts an accepted Ciciro suggestion on both sides, so the percentage is Ciciro's share of words added", async () => {
    const { user, projectId, chapterId, revision } = await seed();
    await executeEditorTool(
      "edit_manuscript",
      { chapterNumber: 1, expectedRevision: revision, replacements: [{ find: "walked slowly", replace: "ambled" }] },
      { projectId }
    );
    const pending = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(pending.wordsAdded).toBe(6);

    const acceptedWords = ciciroAcceptedWordCount(pending.content);
    await updateChapter(chapterId, user, {
      content: resolveSuggestions(pending.content, "accept", null),
      expectedRevision: pending.revision,
    });
    await recordAiInvolvement(chapterId, user, { acceptedWords });

    const after = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(after.wordsAdded).toBe(7);
    expect(aiInvolvement(after)).toMatchObject({ ciciroWords: 1, wordsAdded: 7, authorWords: 6, percent: 14 });
  });

  it("does not count restoring a snapshot as adding words", async () => {
    const { user, chapterId, revision } = await seed();
    const snap = await saveManualSnapshot(chapterId, user, { label: "before" });
    const cut = await updateChapter(chapterId, user, {
      content: '<p data-block-id="b1">She left.</p>',
      expectedRevision: revision,
    });
    expect(cut.chapter.wordsAdded).toBe(7);
    const restored = await restoreSnapshot(chapterId, snap.id, user);
    expect(restored.chapter.wordsAdded).toBe(7);
  });

  it("tallies a chat draft paste once, even when the same segment is posted concurrently", async () => {
    const { user, projectId, chapterId } = await seed();
    const session = await createSession(user.id);
    const post = () =>
      postInsertion(
        new NextRequest("http://localhost/api/chat/insertions", {
          method: "POST",
          headers: { [SESSION_HEADER]: session, "content-type": "application/json" },
          body: JSON.stringify({ projectId, turnId: "turn-1", segmentIndex: 0, chapterId, wordCount: 7 }),
        })
      );
    const responses = await Promise.all([post(), post(), post()]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(bodies.filter((b) => b.aiDraftedWords === 7)).toHaveLength(1);
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.aiDraftedWords).toBe(7);
    expect(await prisma.draftInsertion.count({ where: { turnId: "turn-1" } })).toBe(1);
  });

  it("ignores a zero or negative delta and never decrements", async () => {
    const { user, chapterId } = await seed();
    await recordAiInvolvement(chapterId, user, { acceptedWords: 5 });
    await recordAiInvolvement(chapterId, user, { acceptedWords: -100, draftedWords: 0 });
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.aiAcceptedWords).toBe(5);
  });

  it("clamps one action's word count so a malformed value cannot inflate the tally", async () => {
    const { user, chapterId } = await seed();
    await recordAiInvolvement(chapterId, user, { draftedWords: MAX_AI_INVOLVEMENT_DELTA * 10 });
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.aiDraftedWords).toBe(MAX_AI_INVOLVEMENT_DELTA);
  });

  it("refuses to credit a chapter the caller does not own", async () => {
    const { chapterId } = await seed();
    const stranger = await registerUser({ email: "eve@example.com", password: "long-enough-pw", name: "Eve" });
    await expect(recordAiInvolvement(chapterId, stranger, { acceptedWords: 1 })).rejects.toThrow(AuthError);
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.aiAcceptedWords).toBe(0);
  });

  it("POST /api/chapters/:id/ai-involvement authenticates and increments both counters in one call", async () => {
    const { user, chapterId } = await seed();
    const session = await createSession(user.id);
    const res = await postAiInvolvement(
      new NextRequest(`http://localhost/api/chapters/${chapterId}/ai-involvement`, {
        method: "POST",
        headers: { [SESSION_HEADER]: session, "content-type": "application/json" },
        body: JSON.stringify({ acceptedWords: 2, draftedWords: 3 }),
      }),
      { params: Promise.resolve({ id: chapterId }) }
    );
    expect(res.status).toBe(200);
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.aiAcceptedWords).toBe(2);
    expect(chapter.aiDraftedWords).toBe(3);
  });

  it("POST /api/chapters/:id/ai-involvement 404s for a chapter that does not exist", async () => {
    const res = await postAiInvolvement(
      new NextRequest("http://localhost/api/chapters/missing/ai-involvement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acceptedWords: 2 }),
      }),
      { params: Promise.resolve({ id: "missing" }) }
    );
    expect(res.status).toBe(404);
  });
});
