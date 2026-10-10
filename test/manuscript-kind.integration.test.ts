import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProject, getProject, listProjects, updateProject } from "@/lib/projects";
import { createFolder, listFolders } from "@/lib/folders";
import { estimatePages } from "@/lib/screenplay";
import { NIGHT_SHIFT } from "./fixtures/screenplay/night-shift";
import { createChapter, archiveChapter, SINGLE_PIECE_ERROR } from "@/lib/chapters";
import { registerUser } from "@/lib/auth/session";
import { CICIRO_AUTHOR, resolveSuggestions, suggestReplacements } from "@/lib/suggestions";
import { executeEditorTool } from "@/lib/tools";
import { updateUserSettings } from "@/lib/user-settings";
import { buildEditorContext } from "@/lib/context";
import { assistantReplacementSplitter, elementOfHtml, elementTagOfHtml } from "@/lib/manuscript-kind";

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

  it.each([true, false])(
    "keeps an edited dialogue line as dialogue and starts the next speaker (suggestions %s)",
    async (aiSuggestions) => {
      const owner = await registerUser({ email: "sp@example.com", password: "long-enough-pw", name: "Sam" });
      await updateUserSettings(owner.id, { aiSuggestions });
      const script = await createProject(owner, { title: "Heist", kind: "screenplay" });
      const [chapter] = script.chapters;
      const seeded = await prisma.chapter.update({
        where: { id: chapter.id },
        data: {
          content:
            '<p data-block-id="c" data-sp="character">MARA</p><p data-block-id="d" data-sp="dialogue">Hi.</p>',
        },
      });
      await executeEditorTool(
        "edit_manuscript",
        {
          chapterNumber: 1,
          expectedRevision: seeded.revision,
          replacements: [{ find: "Hi.", replace: "Hi there.\nJON\nHey." }],
        },
        { projectId: script.id }
      );
      const after = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
      const accepted = resolveSuggestions(after.content, "accept");
      expect(blocks(accepted)).toEqual([
        ["character", "MARA"],
        ["dialogue", "Hi there."],
        ["character", "JON"],
        ["dialogue", "Hey."],
      ]);
      expect(scanIds(accepted).slice(0, 2)).toEqual(["c", "d"]);
    }
  );

  const AFTER_DIALOGUE =
    '<p data-block-id="c" data-sp="character">MARA</p><p data-block-id="d" data-sp="dialogue">Hi.</p>' +
    '<p data-block-id="e">She leaves.</p>';

  it.each([true, false])(
    "keeps an edited action beat after dialogue as action (suggestions %s)",
    async (aiSuggestions) => {
      const owner = await registerUser({ email: "sp@example.com", password: "long-enough-pw", name: "Sam" });
      await updateUserSettings(owner.id, { aiSuggestions });
      const script = await createProject(owner, { title: "Heist", kind: "screenplay" });
      const [chapter] = script.chapters;
      const seeded = await prisma.chapter.update({ where: { id: chapter.id }, data: { content: AFTER_DIALOGUE } });
      await executeEditorTool(
        "edit_manuscript",
        {
          chapterNumber: 1,
          expectedRevision: seeded.revision,
          replacements: [{ find: "She leaves.", replace: "She leaves.\nJON\nWait." }],
        },
        { projectId: script.id }
      );
      const after = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
      expect(blocks(resolveSuggestions(after.content, "accept"))).toEqual([
        ["character", "MARA"],
        ["dialogue", "Hi."],
        ["action", "She leaves."],
        ["character", "JON"],
        ["dialogue", "Wait."],
      ]);
    }
  );

  it("inserts an action line after dialogue as action", async () => {
    const script = await createProject(null, { title: "Heist", kind: "screenplay" });
    const [chapter] = script.chapters;
    const seeded = await prisma.chapter.update({ where: { id: chapter.id }, data: { content: AFTER_DIALOGUE } });
    await executeEditorTool(
      "insert_text",
      { chapterNumber: 1, expectedRevision: seeded.revision, position: "end", text: "The door slams." },
      { projectId: script.id }
    );
    const after = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(blocks(after.content).at(-1)).toEqual(["action", "The door slams."]);
  });

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

  const tagged = (html: string) =>
    (html.match(/<p\b[^>]*>.*?<\/p>/g) ?? []).map((b) => [elementTagOfHtml(b), b.replace(/<[^>]+>/g, "")]);

  async function replaceBlocks(content: string, find: string, replace: string) {
    const owner = await registerUser({ email: "sp@example.com", password: "long-enough-pw", name: "Sam" });
    await updateUserSettings(owner.id, { aiSuggestions: false });
    const script = await createProject(owner, { title: "Heist", kind: "screenplay" });
    const [chapter] = script.chapters;
    const seeded = await prisma.chapter.update({ where: { id: chapter.id }, data: { content } });
    const result = await executeEditorTool(
      "edit_manuscript",
      { chapterNumber: 1, expectedRevision: seeded.revision, replacements: [{ find, replace }] },
      { projectId: script.id }
    );
    expect(result.mutationCount).toBe(1);
    return tagged((await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } })).content);
  }

  it("keeps a replaced shot a shot when an edit rewrites whole blocks", async () => {
    expect(
      await replaceBlocks(
        '<p data-sp="shot">CLOSE ON THE DOOR</p><p>It opens.</p>',
        "CLOSE ON THE DOOR\n\nIt opens.",
        "THE KNIFE\nIt glints."
      )
    ).toEqual([
      ["shot", "THE KNIFE"],
      ["action", "It glints."],
    ]);
  });

  it("keeps a newer client's element when an edit rewrites whole blocks", async () => {
    expect(
      await replaceBlocks(
        '<p data-sp="centered">THE END</p><p>Credits roll.</p>',
        "THE END\n\nCredits roll.",
        "FIN\nMARA\nGoodbye."
      )
    ).toEqual([
      ["centered", "FIN"],
      ["character", "MARA"],
      ["dialogue", "Goodbye."],
    ]);
  });

  it("places a drafted camera direction as a shot when an edit rewrites whole blocks", async () => {
    expect(
      await replaceBlocks("<p>Old action.</p><p>More action.</p>", "Old action.\n\nMore action.", "CLOSE ON THE KNIFE\nIt glints.")
    ).toEqual([
      ["shot", "CLOSE ON THE KNIFE"],
      ["action", "It glints."],
    ]);
  });

  it("keeps a replaced shot a shot in a suggested replacement", () => {
    const { html } = suggestReplacements(
      '<p data-sp="shot" data-block-id="a">CLOSE ON THE DOOR</p><p data-block-id="b">It opens.</p>',
      [{ find: "CLOSE ON THE DOOR\n\nIt opens.", replace: "THE KNIFE\nIt glints." }],
      {
        author: CICIRO_AUTHOR,
        newBlockId: () => "nb",
        splitReplacement: assistantReplacementSplitter("screenplay"),
      }
    );
    expect(tagged(resolveSuggestions(html, "accept"))).toEqual([
      ["shot", "THE KNIFE"],
      ["action", "It glints."],
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

describe("the assistant reads and writes a script as marked lines", () => {
  const SCRIPT =
    '<p data-block-id="a" data-sp="scene-heading">int. lab - day</p>' +
    '<p data-block-id="b">BOOM.</p>' +
    '<p data-block-id="c" data-sp="character">MARA</p>' +
    '<p data-block-id="d" data-sp="dialogue">Hi.</p>' +
    '<p data-block-id="e" data-sp="scene-heading">EXT. ROOF - NIGHT</p>' +
    '<p data-block-id="f">Wind.</p>';

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.project.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const tagged = (html: string) =>
    (html.match(/<p\b[^>]*>.*?<\/p>/g) ?? []).map((b) => [elementTagOfHtml(b), b.replace(/<[^>]+>/g, "")]);

  async function seeded(opts: { aiSuggestions?: boolean } = {}) {
    const owner = await registerUser({ email: "sp@example.com", password: "long-enough-pw", name: "Sam" });
    await updateUserSettings(owner.id, { aiSuggestions: opts.aiSuggestions ?? false });
    const script = await createProject(owner, { title: "Heist", kind: "screenplay" });
    const [chapter] = script.chapters;
    const row = await prisma.chapter.update({ where: { id: chapter.id }, data: { content: SCRIPT } });
    return { owner, script, chapter: row };
  }

  async function content(id: string) {
    return (await prisma.chapter.findUniqueOrThrow({ where: { id } })).content;
  }

  it("shows a script with each line's element and each scene by its heading", async () => {
    const { script } = await seeded();
    const read = await executeEditorTool("read_chapter", { number: 1 }, { projectId: script.id });
    expect(read.content).toContain("[ch1.s1 · 7w]\n.int. lab - day\n\n!BOOM.\n\n@MARA\nHi.");
    expect(read.content).toContain("[ch1.s2 · 5w]\n.EXT. ROOF - NIGHT\n\n!Wind.");
    const list = await executeEditorTool("list_passages", { chapterNumber: 1 }, { projectId: script.id });
    expect(list.content).toContain("- ch1.s1 (7w, p1-p4) INT. LAB - DAY");
    expect(list.content).toContain("- ch1.s2 (5w, p5-p6) EXT. ROOF - NIGHT");
    // A novel's chapter still reads as plain text.
    const novel = await createProject(null, { title: "Book" });
    await prisma.chapter.update({ where: { id: novel.chapters[0].id }, data: { content: "<p>One.</p><p>Two.</p>" } });
    const plain = await executeEditorTool("read_chapter", { number: 1 }, { projectId: novel.id });
    expect(plain.content).toContain("[ch1.s1 · 2w]\nOne.\n\nTwo.");
  });

  it("gives the editor's context the script lines and the scene index", async () => {
    const { script, chapter } = await seeded();
    const whole = await buildEditorContext(script.id, chapter.id, "chapter");
    expect(whole).toContain("- ch1.s2 (5w, p5-p6) EXT. ROOF - NIGHT");
    expect(whole).toContain("[ch1.s1 · 7w]\n.int. lab - day\n\n!BOOM.\n\n@MARA\nHi.");
    const brief = await buildEditorContext(script.id, chapter.id);
    expect(brief).toContain("@MARA\nHi.\n\n.EXT. ROOF - NIGHT\n\n!Wind.");
    expect(brief).not.toContain("</p>");
  });

  it("deletes a scene by its heading and leaves the rest of the script", async () => {
    const { script, chapter } = await seeded();
    const result = await executeEditorTool(
      "delete_passages",
      { passageId: "ch1.s1", expectedRevision: chapter.revision },
      { projectId: script.id }
    );
    expect(result.mutationCount).toBe(1);
    expect(tagged(await content(chapter.id))).toEqual([
      ["scene-heading", "EXT. ROOF - NIGHT"],
      ["action", "Wind."],
    ]);
  });

  it("places marked lines as the elements they name, ALL-CAPS action included", async () => {
    const { script, chapter } = await seeded();
    await executeEditorTool(
      "insert_text",
      {
        chapterNumber: 1,
        expectedRevision: chapter.revision,
        position: "end",
        text: "!SHE RUNS OUT.\n\n@MARA\n(panting)\nWait.\nSTOP.\n\n>CUT TO:\n\n^CLOSE ON THE DOOR",
      },
      { projectId: script.id }
    );
    expect(tagged(await content(chapter.id)).slice(-7)).toEqual([
      ["action", "SHE RUNS OUT."],
      ["character", "MARA"],
      ["parenthetical", "panting"],
      ["dialogue", "Wait."],
      ["dialogue", "STOP."],
      ["transition", "CUT TO:"],
      ["shot", "CLOSE ON THE DOOR"],
    ]);
  });

  it("continues a speech: a line inserted under a cue is dialogue", async () => {
    const { script, chapter } = await seeded();
    await executeEditorTool(
      "insert_text",
      { chapterNumber: 1, expectedRevision: chapter.revision, after: "ch1.p3", text: "Hello there." },
      { projectId: script.id }
    );
    expect(tagged(await content(chapter.id)).slice(2, 5)).toEqual([
      ["character", "MARA"],
      ["dialogue", "Hello there."],
      ["dialogue", "Hi."],
    ]);
  });

  it.each([true, false])(
    "replaces a whole line with a marked line, as that element (suggestions %s)",
    async (aiSuggestions) => {
      const { script, chapter } = await seeded({ aiSuggestions });
      await executeEditorTool(
        "edit_manuscript",
        {
          chapterNumber: 1,
          expectedRevision: chapter.revision,
          replacements: [{ find: "Hi.", replace: "!She waves." }],
        },
        { projectId: script.id }
      );
      const after = await content(chapter.id);
      expect(tagged(resolveSuggestions(after, "accept"))).toEqual([
        ["scene-heading", "int. lab - day"],
        ["action", "BOOM."],
        ["character", "MARA"],
        ["action", "She waves."],
        ["scene-heading", "EXT. ROOF - NIGHT"],
        ["action", "Wind."],
      ]);
      // The author can still turn it down and have the dialogue back.
      if (aiSuggestions) expect(tagged(resolveSuggestions(after, "reject"))[3]).toEqual(["dialogue", "Hi."]);
    }
  );

  it.each([true, false])(
    "edits the words inside a line in place and keeps its element (suggestions %s)",
    async (aiSuggestions) => {
      const { script, chapter } = await seeded({ aiSuggestions });
      await executeEditorTool(
        "edit_manuscript",
        {
          chapterNumber: 1,
          expectedRevision: chapter.revision,
          replacements: [{ find: "Wind.", replace: "Wind rises." }],
        },
        { projectId: script.id }
      );
      expect(tagged(resolveSuggestions(await content(chapter.id), "accept")).at(-1)).toEqual([
        "action",
        "Wind rises.",
      ]);
    }
  );
});

describe("a screenplay's page count in the manuscript lists", () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const html = NIGHT_SHIFT.map((b) => `<p${b.element === "action" ? "" : ` data-sp="${b.element}"`}>${b.text}</p>`).join("");

  it("lists how many pages each screenplay runs, across its sequences, and nothing for other kinds", async () => {
    const script = await createProject(null, { title: "Heist", kind: "screenplay" });
    const second = await createChapter(null, { projectId: script.id });
    await prisma.chapter.update({ where: { id: script.chapters[0].id }, data: { content: html } });
    await prisma.chapter.update({ where: { id: second.id }, data: { content: html } });
    const archived = await createChapter(null, { projectId: script.id });
    await archiveChapter(archived.id, null);
    await prisma.chapter.update({ where: { id: archived.id }, data: { content: html } });
    const novel = await createProject(null, { title: "Book" });
    await createProject(null, { title: "Blank", kind: "screenplay" });

    const rows = await listProjects(null);
    const byTitle = new Map(rows.map((row) => [row.title, row]));
    // Sequences run on from one another, and an archived one is not in the script.
    expect(byTitle.get("Heist")?.pages).toBe(estimatePages([html, html]));
    expect(byTitle.get("Heist")?.pages).toBeGreaterThan(estimatePages([html]));
    expect(byTitle.get("Heist")?._count.chapters).toBe(2);
    // An empty script has no pages to count, and a novel never carries the field.
    expect(byTitle.get("Blank")).not.toHaveProperty("pages");
    expect(byTitle.get(novel.title)).not.toHaveProperty("pages");
  });

  it("carries the count into a folder's manuscripts", async () => {
    const script = await createProject(null, { title: "Heist", kind: "screenplay" });
    await prisma.chapter.update({ where: { id: script.chapters[0].id }, data: { content: html } });
    const folder = await createFolder(null, { name: "Scripts", projectIds: [script.id] });
    expect(folder.projects[0].pages).toBe(estimatePages([html]));
    const [listed] = await listFolders(null);
    expect(listed.projects[0].pages).toBe(estimatePages([html]));
  });
});
