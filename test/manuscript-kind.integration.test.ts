import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProject, getProject, updateProject } from "@/lib/projects";
import { createChapter, archiveChapter, SINGLE_PIECE_ERROR } from "@/lib/chapters";
import { registerUser } from "@/lib/auth/session";
import { CICIRO_AUTHOR, resolveSuggestions, suggestReplacements } from "@/lib/suggestions";
import { executeEditorTool } from "@/lib/tools";
import { updateUserSettings } from "@/lib/user-settings";
import { buildEditorContext } from "@/lib/context";
import { assistantReplacementSplitter, elementOfHtml } from "@/lib/manuscript-kind";

const scanIds = (html: string) => [...html.matchAll(/<p\b[^>]*data-block-id="([^"]+)"/g)].map((m) => m[1]);

describe("manuscript kinds", () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("defaults to a novel and ignores an unknown kind", async () => {
    const plain = await createProject(null, { title: "Plain" });
    expect(plain.kind).toBe("novel");
    expect(plain.chapters.map((c) => c.title)).toEqual(["Chapter 1"]);
    const odd = await createProject(null, { title: "Odd", kind: "haiku" });
    expect(odd.kind).toBe("novel");
  });

  it("starts a screenplay on a scene heading and names later sequences", async () => {
    const script = await createProject(null, { title: "Heist", kind: "screenplay" });
    expect(script.kind).toBe("screenplay");
    expect(script.chapters[0].title).toBe("Sequence 1");
    expect(elementOfHtml(script.chapters[0].content)).toBe("scene-heading");
    const next = await createChapter(null, { projectId: script.id });
    expect(next.title).toBe("Sequence 2");
    expect(elementOfHtml(next.content)).toBe("scene-heading");
  });

  it("makes a blog post a single piece", async () => {
    const post = await createProject(null, { title: "Ten notes", kind: "blog", logline: "A subtitle" });
    expect(post.chapters).toHaveLength(1);
    expect(post.chapters[0].title).toBe("Ten notes");
    expect(post.logline).toBe("A subtitle");
    await expect(createChapter(null, { projectId: post.id })).rejects.toMatchObject({ status: 409 });
    await archiveChapter(post.chapters[0].id, null);
    expect((await createChapter(null, { projectId: post.id })).title).toBe("Post");
  });

  it("opens a journal on the author's local date and adds dated entries", async () => {
    const journal = await createProject(null, { kind: "journal", today: "2026-09-26" });
    expect(journal.chapters[0].title).toBe("Saturday, September 26, 2026");
    const entry = await createChapter(null, {
      projectId: journal.id,
      title: "Sunday, September 27, 2026",
    });
    expect(entry.title).toBe("Sunday, September 27, 2026");
  });

  it("does not let a patch change the kind, and tells the assistant what it is editing", async () => {
    const script = await createProject(null, { title: "Heist", kind: "screenplay" });
    await updateProject(script.id, null, { kind: "novel", title: "Heist II" });
    const after = await getProject(script.id, null);
    expect(after.kind).toBe("screenplay");
    const context = await buildEditorContext(script.id, script.chapters[0].id);
    expect(context).toContain("Type: Screenplay");
    const novel = await createProject(null, { title: "Book" });
    expect(await buildEditorContext(novel.id, novel.chapters[0].id)).not.toContain("Type:");
  });
});

describe("assistant tools respect the manuscript kind", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();
  });

  const blocks = (html: string) =>
    (html.match(/<p\b[^>]*>.*?<\/p>/g) ?? []).map((b) => [elementOfHtml(b), b.replace(/<[^>]+>/g, "")]);

  it("refuses to add a second chapter to a blog post", async () => {
    const post = await createProject(null, { title: "Ten notes", kind: "blog" });
    const result = await executeEditorTool("create_chapter", { title: "Part two" }, { projectId: post.id });
    expect(result.status).toBe("create failed");
    expect(result.content).toBe(SINGLE_PIECE_ERROR);
    expect(result.mutationCount ?? 0).toBe(0);
    expect(await prisma.chapter.count({ where: { projectId: post.id } })).toBe(1);
  });

  it("refuses to split a blog post into a new chapter", async () => {
    const post = await createProject(null, { title: "Ten notes", kind: "blog" });
    const [chapter] = post.chapters;
    await prisma.chapter.update({
      where: { id: chapter.id },
      data: { content: "<p>The opening line.</p><p>The second point.</p>" },
    });
    const result = await executeEditorTool(
      "split_chapter_at",
      {
        sourceChapter: 1,
        destinationChapter: 2,
        boundary: "The second point.",
        expectedSourceRevision: chapter.revision,
      },
      { projectId: post.id }
    );
    expect(result.status).toBe("split failed");
    expect(result.content).toBe(SINGLE_PIECE_ERROR);
    const after = await prisma.chapter.findMany({ where: { projectId: post.id } });
    expect(after).toHaveLength(1);
    expect(after[0].content).toContain("The second point.");
  });

  it("names an assistant-created screenplay sequence and opens it on a scene heading", async () => {
    const script = await createProject(null, { title: "Heist", kind: "screenplay" });
    const result = await executeEditorTool("create_chapter", {}, { projectId: script.id });
    expect(result.status).toBe("creating chapter 2");
    const created = await prisma.chapter.findFirstOrThrow({ where: { projectId: script.id, order: 1 } });
    expect(created.title).toBe("Sequence 2");
    expect(elementOfHtml(created.content)).toBe("scene-heading");
  });

  it("places inserted script lines as screenplay elements", async () => {
    const script = await createProject(null, { title: "Heist", kind: "screenplay" });
    const [chapter] = script.chapters;
    await executeEditorTool(
      "insert_text",
      {
        chapterNumber: 1,
        expectedRevision: chapter.revision,
        position: "end",
        text: "INT. KITCHEN - NIGHT\nMara stares.\nMARA\nHello.",
      },
      { projectId: script.id }
    );
    const after = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(blocks(after.content).slice(-4)).toEqual([
      ["scene-heading", "INT. KITCHEN - NIGHT"],
      ["action", "Mara stares."],
      ["character", "MARA"],
      ["dialogue", "Hello."],
    ]);
  });

  it("suggests screenplay elements when an edit replaces whole blocks with default settings", async () => {
    const owner = await registerUser({ email: "sp@example.com", password: "long-enough-pw", name: "Sam" });
    const script = await createProject(owner, { title: "Heist", kind: "screenplay" });
    const [chapter] = script.chapters;
    const seeded = await prisma.chapter.update({
      where: { id: chapter.id },
      data: { content: '<p data-sp="scene-heading">INT. HALL - DAY</p><p>Old action.</p>' },
    });
    const result = await executeEditorTool(
      "edit_manuscript",
      {
        chapterNumber: 1,
        expectedRevision: seeded.revision,
        replacements: [
          {
            find: "INT. HALL - DAY\n\nOld action.",
            replace: "INT. KITCHEN - NIGHT\nMara stares.\nMARA\nHello.",
          },
        ],
      },
      { projectId: script.id }
    );
    expect(result.status).toBe("suggesting edits in chapter 1");
    const after = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(after.content).toContain("data-suggestion-id");
    expect(blocks(resolveSuggestions(after.content, "accept"))).toEqual([
      ["scene-heading", "INT. KITCHEN - NIGHT"],
      ["action", "Mara stares."],
      ["character", "MARA"],
      ["dialogue", "Hello."],
    ]);
    expect(blocks(resolveSuggestions(after.content, "reject"))).toEqual([
      ["scene-heading", "INT. HALL - DAY"],
      ["action", "Old action."],
    ]);
  });

  it.each([true, false])(
    "splits a one-block script edit into elements (suggestions %s)",
    async (aiSuggestions) => {
      const owner = await registerUser({ email: "sp@example.com", password: "long-enough-pw", name: "Sam" });
      await updateUserSettings(owner.id, { aiSuggestions });
      const script = await createProject(owner, { title: "Heist", kind: "screenplay" });
      const [chapter] = script.chapters;
      const seeded = await prisma.chapter.update({
        where: { id: chapter.id },
        data: { content: '<p data-sp="scene-heading">INT. HALL - DAY</p><p>Old action.</p>' },
      });
      const result = await executeEditorTool(
        "edit_manuscript",
        {
          chapterNumber: 1,
          expectedRevision: seeded.revision,
          replacements: [{ find: "Old action.", replace: "Mara stares.\nMARA\nHello." }],
        },
        { projectId: script.id }
      );
      expect(result.mutationCount).toBe(1);
      const after = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
      expect(blocks(resolveSuggestions(after.content, "accept"))).toEqual([
        ["scene-heading", "INT. HALL - DAY"],
        ["action", "Mara stares."],
        ["character", "MARA"],
        ["dialogue", "Hello."],
      ]);
    }
  );

  it("pairs a script block with its element whatever the attribute order", () => {
    const { html } = suggestReplacements(
      '<p data-sp="character" data-block-id="a">MARA</p><p data-sp="dialogue" data-block-id="b">Hi there.</p>',
      [{ find: "MARA\n\nHi there.", replace: "MARA\nHello there." }],
      {
        author: CICIRO_AUTHOR,
        newBlockId: () => "nb",
        splitReplacement: assistantReplacementSplitter("screenplay"),
      }
    );
    expect(scanIds(html)).toEqual(["a", "b"]);
    expect(blocks(resolveSuggestions(html, "accept"))).toEqual([
      ["character", "MARA"],
      ["dialogue", "Hello there."],
    ]);
  });

  it("keeps screenplay elements when an edit replaces whole blocks", async () => {
    const owner = await registerUser({ email: "sp@example.com", password: "long-enough-pw", name: "Sam" });
    await updateUserSettings(owner.id, { aiSuggestions: false });
    const script = await createProject(owner, { title: "Heist", kind: "screenplay" });
    const [chapter] = script.chapters;
    const seeded = await prisma.chapter.update({
      where: { id: chapter.id },
      data: { content: '<p data-sp="scene-heading">INT. HALL - DAY</p><p>Old action.</p>' },
    });
    const result = await executeEditorTool(
      "edit_manuscript",
      {
        chapterNumber: 1,
        expectedRevision: seeded.revision,
        replacements: [
          {
            find: "INT. HALL - DAY\n\nOld action.",
            replace: "INT. KITCHEN - NIGHT\nMara stares.\nMARA\nHello.",
          },
        ],
      },
      { projectId: script.id }
    );
    expect(result.mutationCount).toBe(1);
    const after = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(blocks(after.content)).toEqual([
      ["scene-heading", "INT. KITCHEN - NIGHT"],
      ["action", "Mara stares."],
      ["character", "MARA"],
      ["dialogue", "Hello."],
    ]);
  });
});
