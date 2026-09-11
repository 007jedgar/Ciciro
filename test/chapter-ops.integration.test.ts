import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { updateChapter } from "@/lib/chapters";
import { appendOps, listChapterOps } from "@/lib/chapter-ops";
import type { ManuscriptOp } from "@/lib/manuscript";

describe("chapter ops", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("turns a content PATCH into block ops and keeps expectedRevision working", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const project = await createProject(ada, { title: "Ops" });
    const opening = project.chapters[0];

    const saved = await updateChapter(opening.id, ada, {
      title: "Prologue",
      content: "<p>Once upon a time.</p>",
      expectedRevision: opening.revision,
    });
    expect(saved.chapter.title).toBe("Prologue");
    expect(saved.chapter.wordCount).toBe(4);
    expect(saved.chapter.revision).toBe(opening.revision + 1);
    expect(saved.contentChanged).toBe(true);
    expect(saved.chapter.content).toContain("data-block-id");

    const { ops } = await listChapterOps(opening.id, ada, 0);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe("insert_block");
    expect(ops[0].seq).toBe(saved.chapter.revision);
  });

  it("pushes, pulls, ignores duplicate opIds, and returns a rebase payload when stale", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const bob = await registerUser({
      email: "bob@example.com",
      password: "long-enough-pw",
    });
    const project = await createProject(ada, { title: "Ops" });
    const chapter = project.chapters[0];

    const first: ManuscriptOp = {
      opId: "op-insert-1",
      baseRevision: chapter.revision,
      actor: "user",
      type: "insert_block",
      afterBlockId: null,
      blockId: "b1",
      html: "<p>First sentence.</p>",
    };
    const pushed = await appendOps(chapter.id, ada, [first]);
    expect(pushed.accepted).toHaveLength(1);
    expect(pushed.rejected).toHaveLength(0);
    expect(pushed.chapter.revision).toBe(1);
    expect(pushed.chapter.content).toContain("First sentence.");

    const again = await appendOps(chapter.id, ada, [first]);
    expect(again.accepted).toHaveLength(1);
    expect(again.accepted[0].seq).toBe(1);
    expect(again.ops).toHaveLength(0);
    expect(again.chapter.revision).toBe(1);

    const pulled = await listChapterOps(chapter.id, ada, 0);
    expect(pulled.ops).toHaveLength(1);
    expect(pulled.ops[0].opId).toBe("op-insert-1");
    expect((await listChapterOps(chapter.id, ada, 1)).ops).toHaveLength(0);

    const stale: ManuscriptOp = {
      opId: "op-stale",
      baseRevision: 0,
      actor: "user",
      type: "replace_block",
      blockId: "b1",
      html: "<p>Stale edit.</p>",
    };
    const conflict = await appendOps(chapter.id, ada, [stale]);
    expect(conflict.accepted).toHaveLength(0);
    expect(conflict.rejected).toEqual([
      expect.objectContaining({
        reason: "stale",
        chapter: expect.objectContaining({
          id: chapter.id,
          revision: 1,
          content: expect.stringContaining("First sentence."),
        }),
      }),
    ]);

    await expect(appendOps(chapter.id, bob, [first])).rejects.toMatchObject({
      status: 403,
    });
  });
});
