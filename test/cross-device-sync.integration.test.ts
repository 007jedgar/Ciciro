import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { updateChapter } from "@/lib/chapters";
import { applyRemoteOps, rebaseRejectedOp } from "@/lib/replica-merge";
import { resumePlainTextIndex } from "@/lib/reading-caret";
import { pullSync, pushSync } from "@/lib/sync";
import { putReadingPosition } from "@/lib/reading-position";
import { htmlToDoc } from "@/lib/manuscript";

describe("desk → phone mid-sentence continuity", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("applies a desk edit and resume caret onto an empty phone replica", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const project = await createProject(ada, { title: "Two devices" });
    const opening = project.chapters[0];
    const html = '<p data-block-id="b-desk">The lantern was still burning.</p>';

    const saved = await updateChapter(opening.id, ada, {
      content: html,
      expectedRevision: opening.revision,
    });
    expect(saved.chapter.content).toContain("lantern was still burning");

    await putReadingPosition(project.id, ada, {
      chapterId: saved.chapter.id,
      blockId: "b-desk",
      offset: 4,
    });

    const pulled = await pullSync(project.id, ada, {
      chapters: { [opening.id]: opening.revision },
    });

    const phone = applyRemoteOps(
      {
        id: opening.id,
        projectId: project.id,
        content: opening.content,
        revision: opening.revision,
        wordCount: opening.wordCount,
      },
      pulled.ops
    );

    expect(phone.ok).toBe(true);
    if (!phone.ok) return;
    expect(phone.chapter.content).toContain("lantern was still burning");
    expect(phone.chapter.revision).toBe(saved.chapter.revision);
    expect(htmlToDoc(phone.chapter.content, phone.chapter.revision).doc.blocks[0]?.id).toBe(
      "b-desk"
    );
    expect(pulled.position).toMatchObject({
      chapterId: saved.chapter.id,
      blockId: "b-desk",
      offset: 4,
    });
    expect(resumePlainTextIndex(phone.chapter.content, "b-desk", 4)).toBe(4);
  });

  it("rebases a stale phone op onto the desk snapshot and retries", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const project = await createProject(ada, { title: "Rebase" });
    const opening = project.chapters[0];

    const desk = await updateChapter(opening.id, ada, {
      content: '<p data-block-id="b1">Desk sentence.</p>',
      expectedRevision: opening.revision,
    });

    const stale = await pushSync(project.id, ada, {
      ops: [
        {
          opId: "phone-stale",
          chapterId: opening.id,
          baseRevision: opening.revision,
          actor: "user",
          type: "replace_block",
          blockId: "b1",
          html: "<p>Phone overlay.</p>",
        },
      ],
    });

    expect(stale.rejected).toHaveLength(1);
    expect(stale.rejected[0]?.reason).toBe("stale");

    const rebased = rebaseRejectedOp({
      op: stale.rejected[0]!.op,
      reason: stale.rejected[0]!.reason,
      chapter: {
        id: stale.rejected[0]!.chapter.id,
        projectId: project.id,
        content: stale.rejected[0]!.chapter.content,
        revision: stale.rejected[0]!.chapter.revision,
        wordCount: stale.rejected[0]!.chapter.wordCount,
      },
    });
    expect(rebased.retry?.baseRevision).toBe(desk.chapter.revision);
    expect(rebased.retry).not.toBeNull();

    const retried = await pushSync(project.id, ada, {
      ops: [
        {
          ...rebased.retry!,
          chapterId: opening.id,
        },
      ],
    });
    expect(retried.accepted).toHaveLength(1);
    expect(retried.rejected).toHaveLength(0);
    expect(retried.ops.some((op) => op.opId === "phone-stale")).toBe(true);
  });
});
