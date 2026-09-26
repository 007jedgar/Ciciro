import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createProject, getProject, updateProject } from "@/lib/projects";
import { createChapter, archiveChapter } from "@/lib/chapters";
import { buildEditorContext } from "@/lib/context";
import { elementOfHtml } from "@/lib/manuscript-kind";

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
