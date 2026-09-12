import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { ensureBible, writeBibleFile } from "@/lib/bible";
import { pullSync, pushSync } from "@/lib/sync";

describe("sync envelope", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("pushes and pulls a mix of ops, bible, and position", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const bob = await registerUser({
      email: "bob@example.com",
      password: "long-enough-pw",
    });
    const project = await createProject(ada, { title: "Sync" });
    const chapter = project.chapters[0];
    await ensureBible(project.id);
    const world = await writeBibleFile(project.id, "world.md", "# World\nseed\n");

    const pushed = await pushSync(project.id, ada, {
      after: { chapters: { [chapter.id]: 0 }, bible: { "world.md": world.revision } },
      ops: [
        {
          opId: "sync-op-1",
          chapterId: chapter.id,
          baseRevision: chapter.revision,
          actor: "user",
          type: "insert_block",
          afterBlockId: null,
          blockId: "b1",
          html: "<p>Offline sentence.</p>",
        },
      ],
      bible: [{ path: "canon.md", revision: 0, content: "# Canon\nThe fire was arson.\n" }],
      position: { chapterId: chapter.id, blockId: "b1", offset: 4 },
    });

    expect(pushed.accepted).toHaveLength(1);
    expect(pushed.rejected).toHaveLength(0);
    expect(pushed.bibleRejected).toHaveLength(0);
    expect(pushed.position).toMatchObject({
      chapterId: chapter.id,
      blockId: "b1",
      offset: 4,
    });
    expect(pushed.chapters.find((c) => c.id === chapter.id)?.revision).toBe(1);
    expect(pushed.bible.find((b) => b.path === "canon.md")?.revision).toBe(1);
    expect(pushed.ops.map((op) => op.opId)).toEqual(["sync-op-1"]);
    expect(pushed.bibleFiles.some((f) => f.path === "canon.md")).toBe(true);
    expect(pushed.bibleFiles.some((f) => f.path === "world.md")).toBe(false);

    const pulled = await pullSync(project.id, ada, {
      chapters: { [chapter.id]: 0 },
      bible: { "world.md": world.revision },
    });
    expect(pulled.ops).toHaveLength(1);
    expect(pulled.position?.offset).toBe(4);
    expect(pulled.bibleFiles.map((f) => f.path)).toContain("canon.md");

    const mixed = await pushSync(project.id, ada, {
      after: { chapters: { [chapter.id]: 1 } },
      ops: [
        {
          opId: "author-op",
          chapterId: chapter.id,
          baseRevision: 1,
          actor: "user",
          type: "replace_block",
          blockId: "b1",
          html: "<p>Their going home.</p>",
        },
        {
          opId: "correction-op",
          chapterId: chapter.id,
          baseRevision: 2,
          actor: "correction",
          type: "replace_block",
          blockId: "b1",
          html: "<p>They're going home.</p>",
        },
      ],
    });
    expect(mixed.accepted.map((row) => row.op.opId)).toEqual(["author-op", "correction-op"]);
    expect(mixed.accepted.map((row) => row.op.actor)).toEqual(["user", "correction"]);
    expect(mixed.rejected).toHaveLength(0);
    expect(mixed.chapters.find((c) => c.id === chapter.id)?.revision).toBe(3);

    await expect(pullSync(project.id, bob)).rejects.toMatchObject({ status: 403 });
    await expect(
      pushSync(project.id, bob, {
        ops: [
          {
            opId: "stolen",
            chapterId: chapter.id,
            baseRevision: 1,
            actor: "user",
            type: "delete_block",
            blockId: "b1",
          },
        ],
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});
