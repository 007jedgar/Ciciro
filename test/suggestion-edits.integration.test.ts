import { afterAll, beforeEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { Packer } from "docx";
import { prisma } from "@/lib/db";
import { registerUser, type PublicUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { updateChapter } from "@/lib/chapters";
import { buildManuscriptDocx } from "@/lib/docx";
import { docHash } from "@/lib/manuscript";
import { pullSync, pushSync } from "@/lib/sync";
import { listSuggestions, resolveSuggestions } from "@/lib/suggestions";
import { executeEditorTool } from "@/lib/tools";
import { updateUserSettings } from "@/lib/user-settings";
import { applyRemoteOps } from "../apps/mobile/lib/sync-merge";
import type { ChapterSnapshot } from "../apps/mobile/lib/db";
import { diffHtmlToOps } from "../apps/mobile/lib/manuscript";
import { resolveSuggestions as phoneResolve } from "../apps/mobile/lib/suggestions";

const PROSE =
  '<p data-block-id="b1">She walked slowly to the door.</p>' +
  '<p data-block-id="b2">Mara waited by the window.</p>';

async function seed(): Promise<{ user: PublicUser; projectId: string; chapterId: string; revision: number }> {
  const user = await registerUser({ email: "ada@example.com", password: "long-enough-pw", name: "Ada" });
  const project = await createProject(user, { title: "Suggestions" });
  const chapter = project.chapters[0];
  const saved = await updateChapter(chapter.id, user, { content: PROSE, expectedRevision: chapter.revision });
  return { user, projectId: project.id, chapterId: chapter.id, revision: saved.chapter.revision };
}

async function suggestEdit(projectId: string, revision: number, find: string, replace: string) {
  return executeEditorTool(
    "edit_manuscript",
    { chapterNumber: 1, expectedRevision: revision, replacements: [{ find, replace }] },
    { projectId }
  );
}

describe("Ciciro's line edits as tracked suggestions", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lands an edit as a pending suggestion through the op log", async () => {
    const { projectId, chapterId, revision } = await seed();
    const result = await suggestEdit(projectId, revision, "She walked slowly to the door.", "She ambled to the door.");

    expect(result.status).toBe("suggesting edits in chapter 1");
    expect(result.mutationCount).toBe(1);
    expect(result.content).toContain("pending suggestions");

    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.revision).toBe(revision + 1);
    // Pending words do not count until accepted.
    expect(chapter.wordCount).toBe(11);
    const [suggestion] = listSuggestions(chapter.content);
    expect(suggestion).toMatchObject({ authorName: "Ciciro", deleted: "walked slowly", inserted: "ambled" });
    expect(resolveSuggestions(chapter.content, "accept")).toBe(
      '<p data-block-id="b1">She ambled to the door.</p><p data-block-id="b2">Mara waited by the window.</p>'
    );

    const op = await prisma.chapterOp.findFirstOrThrow({ where: { chapterId, seq: revision + 1 } });
    expect(op.actor).toBe("ai");
    expect(op.type).toBe("replace_block");
    // The diff view only records edits that were actually applied.
    expect(await prisma.manuscriptEdit.count()).toBe(0);
    expect(result.ui).toMatchObject({ type: "chapter_updated", chapterId, wordCount: 11 });
  });

  it("applies edits directly when the author turned suggestions off", async () => {
    const { user, projectId, chapterId, revision } = await seed();
    await updateUserSettings(user.id, { aiSuggestions: false });
    const result = await suggestEdit(projectId, revision, "walked slowly", "ambled");
    expect(result.status).toBe("correcting chapter 1");
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.content).toContain("She ambled to the door.");
    expect(chapter.content).not.toContain("data-suggestion-id");
  });

  it("refuses a stale revision without writing", async () => {
    const { projectId, chapterId, revision } = await seed();
    const result = await suggestEdit(projectId, revision - 1, "walked", "ran");
    expect(result.status).toBe("revision conflict");
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.content).toBe(PROSE);
  });

  it("reports text it cannot find without bumping the revision", async () => {
    const { projectId, chapterId, revision } = await seed();
    const result = await suggestEdit(projectId, revision, "not in the book", "x");
    expect(result.mutationCount).toBe(0);
    expect(result.content).toContain("NOT FOUND");
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.revision).toBe(revision);
  });

  it("shows the model pending suggestions inline and lets it rework its own", async () => {
    const { projectId, chapterId, revision } = await seed();
    await suggestEdit(projectId, revision, "walked slowly", "strolled");
    const read = await executeEditorTool("read_chapter", { number: 1 }, { projectId });
    expect(read.content).toContain("[-walked slowly-]{+strolled+}");
    expect(read.content).toContain("Never quote the markers");

    await suggestEdit(projectId, revision + 1, "strolled", "ambled");
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    const list = listSuggestions(chapter.content);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ deleted: "walked slowly", inserted: "ambled" });
  });

  it("rides the sync path to the phone, which can accept it", async () => {
    const { user, projectId, chapterId, revision } = await seed();
    await suggestEdit(projectId, revision, "Mara waited", "Marta waited");

    const pulled = await pullSync(projectId, user, { chapters: { [chapterId]: revision } });
    const now = new Date().toISOString();
    const replica: ChapterSnapshot = {
      id: chapterId,
      projectId,
      title: "Chapter 1",
      order: 0,
      content: PROSE,
      summary: "",
      status: "draft",
      wordCount: 11,
      revision,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const phone = applyRemoteOps(replica, pulled.ops);
    expect(phone.ok).toBe(true);
    if (!phone.ok) return;
    const server = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(phone.chapter.content).toBe(server.content);
    expect(docHash(phone.chapter.content)).toBe(docHash(server.content));
    expect(phone.chapter.wordCount).toBe(server.wordCount);

    // The phone accepts it and pushes the result back as ordinary ops.
    const accepted = phoneResolve(phone.chapter.content, "accept");
    const ops = diffHtmlToOps(phone.chapter.content, accepted, phone.chapter.revision);
    const pushed = await pushSync(projectId, user, {
      ops: ops.map((op) => ({ ...op, chapterId })),
    });
    expect(pushed.rejected).toHaveLength(0);
    const after = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(after.content).toContain("Marta waited by the window.");
    expect(after.content).not.toContain("data-suggestion-id");
  });

  it("exports the manuscript with suggestions still unapplied", async () => {
    const content = resolveSuggestions(
      '<p data-block-id="b1">She <del data-suggestion-id="s" data-author-id="ciciro" data-author-name="Ciciro" ' +
        'data-created-at="2026-09-25T10:00:00.000Z">walked</del><ins data-suggestion-id="s" data-author-id="ciciro" ' +
        'data-author-name="Ciciro" data-created-at="2026-09-25T10:00:00.000Z">sprinted</ins> home.</p>',
      "accept",
      ["nothing"]
    );
    const doc = buildManuscriptDocx({
      title: "Book",
      author: "Ada Quill",
      chapters: [{ title: "One", content, order: 0 }],
    });
    const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("She walked home.");
    expect(xml).not.toContain("sprinted");
  });
});
