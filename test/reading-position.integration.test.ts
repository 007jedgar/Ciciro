import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { createChapter } from "@/lib/chapters";
import { getReadingPosition, putReadingPosition } from "@/lib/reading-position";

describe("reading position", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("puts and gets the current user's position and last-write-wins", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const project = await createProject(ada, { title: "Book" });
    const second = await createChapter(ada, { projectId: project.id, title: "Two" });

    expect(await getReadingPosition(project.id, ada)).toBeNull();

    const first = await putReadingPosition(project.id, ada, {
      chapterId: project.chapters[0].id,
      blockId: "b1",
      offset: 12,
    });
    expect(first).toMatchObject({
      projectId: project.id,
      chapterId: project.chapters[0].id,
      blockId: "b1",
      offset: 12,
    });
    expect(await getReadingPosition(project.id, ada)).toMatchObject({
      chapterId: project.chapters[0].id,
      blockId: "b1",
      offset: 12,
    });

    const next = await putReadingPosition(project.id, ada, {
      chapterId: second.id,
      blockId: "b9",
      offset: 0,
    });
    expect(next).toMatchObject({
      chapterId: second.id,
      blockId: "b9",
      offset: 0,
    });
    expect(await prisma.readingPosition.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("forbids another author and rejects a chapter from a different manuscript", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const bob = await registerUser({
      email: "bob@example.com",
      password: "long-enough-pw",
    });
    const adas = await createProject(ada, { title: "Ada" });
    const bobs = await createProject(bob, { title: "Bob" });

    await expect(
      getReadingPosition(adas.id, bob)
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      putReadingPosition(adas.id, bob, {
        chapterId: adas.chapters[0].id,
        blockId: "b1",
        offset: 0,
      })
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      putReadingPosition(adas.id, ada, {
        chapterId: bobs.chapters[0].id,
        blockId: "b1",
        offset: 0,
      })
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      putReadingPosition(adas.id, ada, {
        chapterId: "missing-chapter",
        blockId: "b1",
        offset: 0,
      })
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      putReadingPosition(adas.id, ada, {
        chapterId: adas.chapters[0].id,
        blockId: "",
        offset: 0,
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});
