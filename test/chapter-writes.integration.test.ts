import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { writeChapterHtml } from "@/lib/chapter-writes";

type ChapterHead = {
  id: string;
  projectId: string;
  content: string;
  revision: number;
};

async function seedChapter(html: string): Promise<ChapterHead> {
  const ada = await registerUser({
    email: "ada@example.com",
    password: "long-enough-pw",
  });
  const project = await createProject(ada, { title: "Writes" });
  const opening = project.chapters[0];
  await writeChapterHtml(
    {
      id: opening.id,
      projectId: project.id,
      content: opening.content,
      revision: opening.revision,
    },
    html
  );
  return head(opening.id);
}

async function head(chapterId: string): Promise<ChapterHead> {
  const row = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
  return {
    id: row.id,
    projectId: row.projectId,
    content: row.content,
    revision: row.revision,
  };
}

function chapterOps(chapterId: string) {
  return prisma.chapterOp.findMany({
    where: { chapterId },
    orderBy: { seq: "asc" },
  });
}

describe("server-side chapter writes", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lands an AI write in the op log rather than only on the chapter", async () => {
    const chapter = await seedChapter("<p>The hall was cold.</p><p>She waited.</p>");
    const ops = await chapterOps(chapter.id);

    expect(ops).toHaveLength(2);
    expect(ops.map((op) => op.type)).toEqual(["insert_block", "insert_block"]);
    expect(ops.every((op) => op.actor === "ai")).toBe(true);
    expect(chapter.content).toContain("data-block-id");
    expect(chapter.content).toContain("She waited.");
    // The phone replays ops; a head with nothing behind it is what forces it to
    // throw the chapter away and refetch mid-keystroke.
    expect(ops.map((op) => op.seq)).toEqual([1, 2]);
    expect(ops[ops.length - 1].seq).toBe(chapter.revision);
  });

  it("commits one write as one group", async () => {
    const before = await seedChapter("<p>One.</p><p>Two.</p>");
    const written = await writeChapterHtml(
      before,
      "<p>One, revised.</p><p>Two.</p><p>Three.</p>"
    );
    const after = await head(before.id);
    const ops = await chapterOps(before.id);
    const group = ops.filter((op) => op.seq > before.revision);

    expect(written.ok).toBe(true);
    expect(written.revision).toBe(after.revision);
    expect(written.content).toBe(after.content);
    expect(group.length).toBeGreaterThan(1);
    // One authoring action, one verdict: a group cannot land its first op and
    // drop the rest.
    expect(group[0].groupId).toBeTruthy();
    expect(new Set(group.map((op) => op.groupId)).size).toBe(1);
    expect(after.revision).toBe(before.revision + group.length);
    expect(after.content).toContain("One, revised.");
    expect(after.content).toContain("Three.");
  });

  it("rejects a stale revision without touching the chapter", async () => {
    const chapter = await seedChapter("<p>Canon.</p>");
    const opsBefore = await chapterOps(chapter.id);

    const written = await writeChapterHtml(
      { ...chapter, revision: chapter.revision - 1 },
      "<p>Canon, rewritten by a run that started too early.</p>"
    );
    const after = await head(chapter.id);

    expect(written.ok).toBe(false);
    expect(written.revision).toBe(chapter.revision);
    expect(after.revision).toBe(chapter.revision);
    expect(after.content).toBe(chapter.content);
    expect(await chapterOps(chapter.id)).toHaveLength(opsBefore.length);
  });

  it("does not move the head when the HTML is unchanged", async () => {
    const chapter = await seedChapter("<p>Unchanged.</p>");
    const opsBefore = await chapterOps(chapter.id);

    const written = await writeChapterHtml(chapter, chapter.content);
    const after = await head(chapter.id);

    expect(written.ok).toBe(true);
    expect(written.revision).toBe(chapter.revision);
    expect(after.revision).toBe(chapter.revision);
    expect(await chapterOps(chapter.id)).toHaveLength(opsBefore.length);
  });

  it("appends a run's prose to a legacy chapter as inserts, keeping what is there", async () => {
    const chapter = await seedChapter("<p>The author wrote this.</p>");
    // The way autowrite and the passage tools used to write: raw paragraphs,
    // revision bumped, nothing in the log. The ids the diff mints for those
    // blocks are the same ones the server stamps them with on read, so an
    // append still lands after them instead of re-writing them.
    await prisma.chapter.update({
      where: { id: chapter.id },
      data: { content: "<p>The author wrote this.</p>", revision: 9 },
    });
    const legacy = await head(chapter.id);

    const written = await writeChapterHtml(
      legacy,
      `${legacy.content}<p>The drafter added this.</p>`,
      { actor: "ai" }
    );
    const after = await head(chapter.id);
    const group = (await chapterOps(chapter.id)).filter((op) => op.seq > 9);

    expect(written.ok).toBe(true);
    expect(group.map((op) => op.type)).toEqual(["insert_block"]);
    expect(group[0].actor).toBe("ai");
    expect(group[0].seq).toBe(after.revision);
    expect(after.revision).toBe(10);
    expect(after.content).toContain("The author wrote this.");
    expect(after.content).toContain("The drafter added this.");
  });

  it("falls back to a whole-document replacement that is still ops", async () => {
    const chapter = await seedChapter("<p>First.</p><p>Second.</p>");
    const opsBefore = await chapterOps(chapter.id);

    // The fallback only fires when the block diff emits an op it cannot apply,
    // which takes HTML no helper produces on purpose. Failing the diff on its
    // first op id stands in for that: a passed-in groupId keeps the write from
    // minting one first, so the throw lands inside the diff.
    const realUuid = globalThis.crypto.randomUUID.bind(globalThis.crypto);
    let diffFails = true;
    const uuid = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockImplementation(() => {
        if (diffFails) {
          diffFails = false;
          throw new Error("diff produced an unapplicable replace_block (missing_block)");
        }
        return realUuid();
      });
    let written;
    try {
      written = await writeChapterHtml(chapter, "<p>Rewritten whole.</p>", {
        groupId: "fallback-group",
      });
    } finally {
      uuid.mockRestore();
    }

    const after = await head(chapter.id);
    const group = (await chapterOps(chapter.id)).filter(
      (op) => op.seq > chapter.revision
    );

    expect(diffFails).toBe(false);
    expect(written.ok).toBe(true);
    // Never a raw snapshot write: the whole document is replaced as two
    // deletes and an insert, under one group.
    expect(group.map((op) => op.type)).toEqual([
      "delete_block",
      "delete_block",
      "insert_block",
    ]);
    expect(group.every((op) => op.groupId === "fallback-group")).toBe(true);
    expect(group.length).toBe(after.revision - chapter.revision);
    expect(opsBefore.length + group.length).toBe(after.revision);
    expect(after.content).toContain("Rewritten whole.");
    expect(after.content).not.toContain("First.");
  });
});
