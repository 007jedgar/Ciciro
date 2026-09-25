import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthError, registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { listChapters } from "@/lib/chapters";
import { importManuscript } from "@/lib/import-manuscript";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures/import", name)));

describe("importManuscript", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const signUp = (email: string) => registerUser({ email, password: "long-enough-pw", name: "Ada" });

  it("creates a new manuscript from a Word file with stamped, counted chapters", async () => {
    const ada = await signUp("ada@example.com");
    const result = await importManuscript(ada, { filename: "book.docx", data: fixture("sample.docx") });
    expect(result.appended).toBe(false);
    expect(result.title).toBe("The Lighthouse Keeper");

    const project = await prisma.project.findUniqueOrThrow({ where: { id: result.projectId } });
    expect(project).toMatchObject({ userId: ada.id, author: "Ada" });

    const chapters = await listChapters(result.projectId, ada);
    expect(chapters.map((c) => [c.title, c.order])).toEqual([
      ["Chapter One", 0],
      ["Chapter Two", 1],
    ]);
    expect(chapters[0].content).toContain("data-block-id");
    expect(chapters[0].content).toContain("<strong");
    expect(chapters[0].wordCount).toBeGreaterThan(10);
    expect(chapters[0].revision).toBe(0);
  });

  it("appends chapters after the existing ones and leaves the manuscript title alone", async () => {
    const ada = await signUp("ada@example.com");
    const project = await createProject(ada, { title: "Mine" });
    const result = await importManuscript(ada, {
      filename: "more.md",
      data: fixture("sample.md"),
      projectId: project.id,
      title: "ignored",
    });
    expect(result.appended).toBe(true);
    expect(result.title).toBe("Mine");
    const chapters = await listChapters(project.id, ada);
    expect(chapters.map((c) => [c.title, c.order])).toEqual([
      ["Chapter 1", 0],
      ["Chapter One: The Storm", 1],
      ["Chapter Two: After", 2],
    ]);
  });

  it("imports a zipped Scrivener project", async () => {
    const ada = await signUp("ada@example.com");
    const result = await importManuscript(ada, { filename: "Lighthouse.scriv.zip", data: fixture("sample.scriv.zip") });
    expect(result.chapters.map((c) => c.title)).toEqual(["The Storm", "Aftermath"]);
  });

  it("reports unreadable files as 422 and creates nothing", async () => {
    const ada = await signUp("ada@example.com");
    await expect(
      importManuscript(ada, { filename: "x.docx", data: new Uint8Array([1, 2, 3]) })
    ).rejects.toMatchObject({ status: 422 });
    expect(await prisma.project.count()).toBe(0);
  });

  it("will not append to someone else's manuscript", async () => {
    const ada = await signUp("ada@example.com");
    const bob = await signUp("bob@example.com");
    const project = await createProject(ada, { title: "Ada's" });
    const attempt = importManuscript(bob, { filename: "a.md", data: fixture("sample.md"), projectId: project.id });
    await expect(attempt).rejects.toBeInstanceOf(AuthError);
    expect(await prisma.chapter.count({ where: { projectId: project.id } })).toBe(1);
  });
});
