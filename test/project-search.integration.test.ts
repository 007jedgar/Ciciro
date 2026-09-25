import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { writeChapterHtml } from "@/lib/chapter-writes";
import { replaceInProject, searchProject } from "@/lib/project-search";

const loose = { matchCase: false, wholeWord: false };

async function seed() {
  const ada = await registerUser({ email: "ada@example.com", password: "long-enough-pw" });
  const project = await createProject(ada, { title: "Search" });
  const first = project.chapters[0];
  const second = await prisma.chapter.create({
    data: { projectId: project.id, order: 1, title: "Two" },
  });
  const write = async (id: string, html: string) => {
    const row = await prisma.chapter.findUniqueOrThrow({ where: { id } });
    await writeChapterHtml(row, html, { actor: "user" });
  };
  await write(first.id, "<p>Jon met jon. Jonathan smiled.</p><p>The Jon <em>left</em>.</p>");
  await write(second.id, "<p>Later, JON returned.</p>");
  return { ada, project, first, second };
}

const head = (id: string) => prisma.chapter.findUniqueOrThrow({ where: { id } });

describe("manuscript search and replace", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("finds matches across chapters with context and a jump target", async () => {
    const { ada, project, first, second } = await seed();
    const found = await searchProject(project.id, ada, "jon", loose);
    expect(found.total).toBe(5);
    expect(found.chapters).toBe(2);
    expect(found.matches[0]).toMatchObject({
      chapterId: first.id,
      chapterNumber: 1,
      occurrence: 0,
      offset: 0,
      match: "Jon",
      before: "",
    });
    expect(found.matches[4]).toMatchObject({ chapterId: second.id, chapterNumber: 2 });

    const whole = await searchProject(project.id, ada, "jon", { matchCase: true, wholeWord: true });
    expect(whole.total).toBe(1);
  });

  it("does not let another user search a manuscript", async () => {
    const { project } = await seed();
    const eve = await registerUser({ email: "eve@example.com", password: "long-enough-pw" });
    await expect(searchProject(project.id, eve, "jon", loose)).rejects.toMatchObject({ status: 403 });
  });

  it("replaces one match through the op log", async () => {
    const { ada, project, first } = await seed();
    const before = await head(first.id);
    const [, second] = (await searchProject(project.id, ada, "jon", { ...loose, wholeWord: true })).matches;
    const out = await replaceInProject(project.id, ada, {
      ...loose,
      wholeWord: true,
      query: "jon",
      replacement: "Joan",
      target: { chapterId: second.chapterId, blockId: second.blockId, occurrence: second.occurrence },
    });
    expect(out.replaced).toBe(1);
    const after = await head(first.id);
    expect(after.content).toContain("Jon met Joan. Jonathan smiled.");
    expect(after.content).toContain("The Jon <em>left</em>.");
    expect(after.revision).toBeGreaterThan(before.revision);
    const ops = await prisma.chapterOp.findMany({ where: { chapterId: first.id, seq: { gt: before.revision } } });
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((op) => op.actor === "user")).toBe(true);
    expect(out.chapters[0]).toMatchObject({ id: first.id, revision: after.revision, replaced: 1 });
  });

  it("replaces every whole-word match in every chapter", async () => {
    const { ada, project, first, second } = await seed();
    const out = await replaceInProject(project.id, ada, {
      ...loose,
      wholeWord: true,
      query: "jon",
      replacement: "Ada",
    });
    expect(out.replaced).toBe(4);
    expect((await head(first.id)).content).toContain("Ada met Ada. Jonathan smiled.");
    expect((await head(second.id)).content).toContain("Later, Ada returned.");
    expect((await searchProject(project.id, ada, "jon", { ...loose, wholeWord: true })).total).toBe(0);
  });

  it("rejects a single replace whose match has moved", async () => {
    const { ada, project, first } = await seed();
    const [match] = (await searchProject(project.id, ada, "smiled", loose)).matches;
    await replaceInProject(project.id, ada, {
      ...loose,
      query: "smiled",
      replacement: "frowned",
      target: { chapterId: first.id, blockId: match.blockId, occurrence: 0 },
    });
    await expect(
      replaceInProject(project.id, ada, {
        ...loose,
        query: "smiled",
        replacement: "frowned",
        target: { chapterId: first.id, blockId: match.blockId, occurrence: 0 },
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("skips archived chapters", async () => {
    const { ada, project, second } = await seed();
    await prisma.chapter.update({ where: { id: second.id }, data: { archivedAt: new Date() } });
    expect((await searchProject(project.id, ada, "jon", loose)).chapters).toBe(1);
  });
});
