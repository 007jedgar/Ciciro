import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { archiveChapter, createChapter, listChapters, reorderChapters } from "@/lib/chapters";

async function seed() {
  const ada = await registerUser({ email: "ada@example.com", password: "long-enough-pw" });
  const project = await createProject(ada, { title: "Outline" });
  const a = project.chapters[0];
  const b = await createChapter(ada, { projectId: project.id, title: "B" });
  const c = await createChapter(ada, { projectId: project.id, title: "C" });
  return { ada, project, a, b, c };
}

describe("chapter reorder", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("renumbers live chapters into the dragged order without touching revisions", async () => {
    const { ada, project, a, b, c } = await seed();
    const result = await reorderChapters(ada, {
      projectId: project.id,
      chapterIds: [c.id, a.id, b.id],
    });
    expect(result.map((ch) => ch.id)).toEqual([c.id, a.id, b.id]);
    expect(result.map((ch) => ch.order)).toEqual([0, 1, 2]);
    expect(result.map((ch) => ch.revision)).toEqual([c.revision, a.revision, b.revision]);
  });

  it("keeps chapters the client did not mention and parks archived ones last", async () => {
    const { ada, project, a, b, c } = await seed();
    await archiveChapter(a.id, ada);
    const result = await reorderChapters(ada, { projectId: project.id, chapterIds: [c.id] });
    expect(result.map((ch) => ch.id)).toEqual([c.id, b.id]);
    const archived = await prisma.chapter.findUniqueOrThrow({ where: { id: a.id } });
    expect(archived.order).toBe(2);
    expect((await listChapters(project.id, ada)).map((ch) => ch.id)).toEqual([c.id, b.id]);
  });

  it("applies overlapping reorders whole, never leaving two chapters on one slot", async () => {
    const { ada, project, a, b, c } = await seed();
    const first = [c.id, a.id, b.id];
    const second = [b.id, c.id, a.id];
    await Promise.all([
      reorderChapters(ada, { projectId: project.id, chapterIds: first }),
      reorderChapters(ada, { projectId: project.id, chapterIds: second }),
    ]);
    const result = await listChapters(project.id, ada);
    expect(result.map((ch) => ch.order)).toEqual([0, 1, 2]);
    expect([first, second]).toContainEqual(result.map((ch) => ch.id));
  });

  it("rejects bad input and other manuscripts' chapters", async () => {
    const { ada, project, a } = await seed();
    const other = await createProject(ada, { title: "Other" });
    await expect(
      reorderChapters(ada, { projectId: project.id, chapterIds: "nope" })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      reorderChapters(ada, { projectId: project.id, chapterIds: [a.id, a.id] })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      reorderChapters(ada, { projectId: project.id, chapterIds: [other.chapters[0].id] })
    ).rejects.toMatchObject({ status: 400 });
    await expect(reorderChapters(ada, { chapterIds: [] })).rejects.toMatchObject({ status: 400 });
  });
});
