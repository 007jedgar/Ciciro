import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthError, registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { archiveChapter, listChapters, SINGLE_PIECE_ERROR } from "@/lib/chapters";
import { importManuscript } from "@/lib/import-manuscript";
import { parseScriptSettings } from "@/lib/screenplay";

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

  it("refuses to append a second chapter to a blog post and adds nothing", async () => {
    const ada = await signUp("ada@example.com");
    const post = await createProject(ada, { title: "Ten notes", kind: "blog" });
    await expect(
      importManuscript(ada, { filename: "more.md", data: fixture("sample.md"), projectId: post.id })
    ).rejects.toMatchObject({ status: 409, message: SINGLE_PIECE_ERROR });
    expect((await listChapters(post.id, ada)).map((c) => c.title)).toEqual(["Ten notes"]);
  });

  it("lets a single piece fill a blog post whose only chapter was archived", async () => {
    const ada = await signUp("ada@example.com");
    const post = await createProject(ada, { title: "Ten notes", kind: "blog" });
    await archiveChapter(post.chapters[0].id, ada);
    await importManuscript(ada, {
      filename: "draft.md",
      data: new TextEncoder().encode("A single draft.\n"),
      projectId: post.id,
    });
    const chapters = await listChapters(post.id, ada);
    expect(chapters.map((c) => c.title)).toEqual(["draft"]);
    expect(chapters[0].content).toContain("A single draft.");
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

  describe("a Fountain script", () => {
    const script = new TextEncoder().encode(
      "Title: Night Shift\n\n# Act one\n\nINT. LAB - DAY\n\nMARA\nHello.\n\n# Act two\n\nEXT. ROOF - NIGHT\n"
    );

    it("becomes a new screenplay with a sequence for each section", async () => {
      const ada = await signUp("ada@example.com");
      const result = await importManuscript(ada, { filename: "night.fountain", data: script });
      expect(result.title).toBe("Night Shift");
      const project = await prisma.project.findUniqueOrThrow({ where: { id: result.projectId } });
      expect(project.kind).toBe("screenplay");
      const chapters = await listChapters(result.projectId, ada);
      expect(chapters.map((c) => c.title)).toEqual(["Act one", "Act two"]);
      expect(chapters[0].content).toContain('data-sp="character"');
      expect(chapters[0].content).toContain("data-block-id");
    });

    it("names untitled sequences for a screenplay", async () => {
      const ada = await signUp("ada@example.com");
      const result = await importManuscript(ada, {
        filename: "night.fountain",
        data: new TextEncoder().encode("INT. A - DAY\n\nHi."),
      });
      expect((await listChapters(result.projectId, ada)).map((c) => c.title)).toEqual(["Sequence 1"]);
    });

    it("is appended to a screenplay with its elements, to a novel as plain paragraphs", async () => {
      const ada = await signUp("ada@example.com");
      const play = await createProject(ada, { title: "Play", kind: "screenplay" });
      await importManuscript(ada, { filename: "n.fountain", data: script, projectId: play.id });
      const playChapters = await listChapters(play.id, ada);
      expect(playChapters.at(-1)!.content).toContain('data-sp="scene-heading"');

      const novel = await createProject(ada, { title: "Novel" });
      await importManuscript(ada, { filename: "n.fountain", data: script, projectId: novel.id });
      const novelChapters = await listChapters(novel.id, ada);
      expect(novelChapters.at(-1)!.content).not.toContain("data-sp");
      expect(novelChapters.at(-1)!.content).toContain("EXT. ROOF - NIGHT");
    });
  });

  describe("what a script's file carries beyond its lines", () => {
    const withTitlePage = new TextEncoder().encode(
      "Title: Night Shift\nCredit: Written by\nAuthor: Jo Writer\nSource: A true story\nDraft date: June 2026\nContact:\n    Jo Writer\n    jo@example.com\n\nINT. LAB - DAY #1#\n\nMARA\nHello.\n\nEXT. ROOF - NIGHT #2#\n"
    );

    it("keeps a Fountain title page and numbered scenes as the script's own settings", async () => {
      const ada = await signUp("ada@example.com");
      const result = await importManuscript(ada, { filename: "night.fountain", data: withTitlePage });
      const project = await prisma.project.findUniqueOrThrow({ where: { id: result.projectId } });
      const settings = parseScriptSettings(project.scriptSettings);
      expect(settings.titlePage).toEqual({
        title: "Night Shift",
        credit: "Written by",
        author: "Jo Writer",
        source: "A true story",
        draftDate: "June 2026",
        contact: "Jo Writer\njo@example.com",
      });
      expect(settings.sceneNumbers).toBe(true);
      // The numbers are the page engine's to count, so none stay in the lines.
      const chapters = await listChapters(result.projectId, ada);
      expect(chapters[0].content).not.toContain("#1#");
    });

    it("leaves a script with neither on the defaults", async () => {
      const ada = await signUp("ada@example.com");
      const result = await importManuscript(ada, {
        filename: "plain.fountain",
        data: new TextEncoder().encode("INT. A - DAY\n\nHi."),
      });
      const project = await prisma.project.findUniqueOrThrow({ where: { id: result.projectId } });
      expect(project.scriptSettings).toBe("");
    });

    it("does not touch the settings of a script it is appended to", async () => {
      const ada = await signUp("ada@example.com");
      const play = await createProject(ada, { title: "Play", kind: "screenplay" });
      await importManuscript(ada, { filename: "n.fountain", data: withTitlePage, projectId: play.id });
      const project = await prisma.project.findUniqueOrThrow({ where: { id: play.id } });
      expect(project.scriptSettings).toBe("");
      expect(project.title).toBe("Play");
    });
  });

  describe("an FDX script", () => {
    const fdx = new Uint8Array(readFileSync(join(__dirname, "fixtures/fdx/night-shift.fdx")));

    it("becomes a new screenplay, with its elements, dual dialogue, title page and scene numbers", async () => {
      const ada = await signUp("ada@example.com");
      const result = await importManuscript(ada, { filename: "night-shift.fdx", data: fdx });
      // The title page of the file is typed in capitals, as Final Draft title pages usually are.
      expect(result.title).toBe("NIGHT SHIFT");
      const project = await prisma.project.findUniqueOrThrow({ where: { id: result.projectId } });
      expect(project.kind).toBe("screenplay");
      const settings = parseScriptSettings(project.scriptSettings);
      expect(settings.titlePage.author).toBe("Jo Writer");
      expect(settings.sceneNumbers).toBe(true);
      const html = (await listChapters(result.projectId, ada)).map((c) => c.content).join("");
      expect(html).toContain('data-sp="scene-heading"');
      expect(html).toContain('data-sp="character" data-sp-dual="1"');
      expect(html).toContain('data-sp="centered"');
      expect(html).toContain("data-block-id");
    });

    it("says plainly when the file is not a script", async () => {
      const ada = await signUp("ada@example.com");
      await expect(
        importManuscript(ada, { filename: "broken.fdx", data: new TextEncoder().encode("<not-fdx/>") })
      ).rejects.toThrow(/Final Draft|FDX|script/i);
    });
  });
});
