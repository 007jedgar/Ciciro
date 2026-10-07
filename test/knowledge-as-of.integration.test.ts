import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { readBibleFile, writeBibleFile } from "@/lib/bible";
import { buildEditorContext } from "@/lib/context";
import { deleteChapter, reorderChapters } from "@/lib/chapters";
import {
  addKnowledgeFact,
  factsAsOfChapter,
  retireKnowledgeFact,
  updateKnowledgeFact,
} from "@/lib/knowledge";

// "As of chapter N": the ledger read at a point in the story, for the editor
// context, the continuity check, What changed, and the chat's knowledge tools.

async function seed() {
  const user = await registerUser({ email: "ada@example.com", password: "long-enough-pw" });
  const project = await createProject(user, { title: "Tides" });
  // createProject opens with one chapter; start from a clean six.
  await prisma.chapter.deleteMany({ where: { projectId: project.id } });
  await writeBibleFile(project.id, "characters/joe.md", "# Joe\n\nA locksmith.\n");
  await writeBibleFile(project.id, "characters/suzy.md", "# Suzy\n\nA courier.\n");
  const chapters = [];
  for (let i = 0; i < 6; i++) {
    chapters.push(
      await prisma.chapter.create({
        data: {
          projectId: project.id,
          title: `Chapter ${i + 1}`,
          order: i,
          content: i === 4 ? "" : `<p>Joe and Suzy, chapter ${i + 1}.</p>`,
        },
      })
    );
  }
  return { user, project, chapters };
}

const facts = async (projectId: string, chapterId: string | null) =>
  (await factsAsOfChapter(projectId, ["characters/joe.md"], chapterId)).facts.map((f) => f.fact);

describe("who knows what, as of a chapter", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("holds a fact from its chapter on, and a retired one only until it stopped", async () => {
    const { user, project, chapters } = await seed();
    const unaware = await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "Who has the pen",
      stance: "unaware",
      topic: "who has the pen",
    });
    const suspects = await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "Suzy has the pen",
      stance: "suspects",
      chapterId: chapters[5].id,
      replacesFactId: unaware.id,
    });
    expect(suspects.topic).toBe("who has the pen");

    expect(await facts(project.id, chapters[0].id)).toEqual(["Who has the pen"]);
    expect(await facts(project.id, chapters[4].id)).toEqual(["Who has the pen"]);
    expect(await facts(project.id, chapters[5].id)).toEqual(["Suzy has the pen"]);
    // No chapter: the ledger as it stands now.
    expect(await facts(project.id, null)).toEqual(["Suzy has the pen"]);

    const retired = await prisma.knowledgeFact.findUniqueOrThrow({ where: { id: unaware.id } });
    expect(retired).toMatchObject({ status: "superseded", supersededAtChapterId: chapters[5].id });
  });

  it("follows a reorder: the chapter's order and each fact's are read live", async () => {
    const { user, project, chapters } = await seed();
    await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "Suzy has the pen",
      stance: "suspects",
      chapterId: chapters[5].id,
    });
    expect(await facts(project.id, chapters[1].id)).toEqual([]);

    // Move chapter 6 up to second place.
    const order = chapters.map((c) => c.id);
    await reorderChapters(user, {
      projectId: project.id,
      chapterIds: [order[0], order[5], order[1], order[2], order[3], order[4]],
    });
    expect(await facts(project.id, chapters[1].id)).toEqual(["Suzy has the pen"]);
    expect(await facts(project.id, chapters[0].id)).toEqual([]);
  });

  it("moves a deleted chapter's facts to the chapter that takes its place, never to before the story", async () => {
    const { user, project, chapters } = await seed();
    // Chapter 5 is empty, so it can be deleted.
    const learned = await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "Mara took the pen",
      stance: "knows",
      chapterId: chapters[4].id,
    });
    const until = await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "The shop is safe",
      stance: "believes_wrong",
    });
    await retireKnowledgeFact(project.id, user, until.id, chapters[4].id);

    await deleteChapter(chapters[4].id, user);

    const moved = await prisma.knowledgeFact.findUniqueOrThrow({ where: { id: learned.id } });
    expect(moved.chapterId).toBe(chapters[5].id);
    const stopped = await prisma.knowledgeFact.findUniqueOrThrow({ where: { id: until.id } });
    expect(stopped.supersededAtChapterId).toBe(chapters[5].id);
    expect(await facts(project.id, chapters[0].id)).toEqual(["The shop is safe"]);
    expect(await facts(project.id, chapters[3].id)).toEqual(["The shop is safe"]);
    expect(await facts(project.id, chapters[5].id)).toEqual(["Mara took the pen"]);
    expect(await readBibleFile(project.id, "characters/joe.md")).toContain(
      '- knows (from "Chapter 6"): Mara took the pen'
    );
  });

  it("retires a fact at a chapter, and with none retires it everywhere", async () => {
    const { user, project, chapters } = await seed();
    const a = await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "The door sticks",
      stance: "knows",
      chapterId: chapters[1].id,
    });
    await expect(retireKnowledgeFact(project.id, user, a.id, chapters[0].id)).rejects.toMatchObject({
      status: 400,
    });
    await retireKnowledgeFact(project.id, user, a.id, chapters[3].id);
    expect(await facts(project.id, chapters[2].id)).toEqual(["The door sticks"]);
    expect(await facts(project.id, chapters[3].id)).toEqual([]);

    // Moving where it stopped is an edit on the retired fact.
    await updateKnowledgeFact(project.id, user, a.id, { supersededAtChapterId: chapters[2].id });
    expect(await facts(project.id, chapters[2].id)).toEqual([]);

    const b = await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "The key is lost",
      stance: "knows",
    });
    await retireKnowledgeFact(project.id, user, b.id, null);
    for (const chapter of chapters) expect(await facts(project.id, chapter.id)).not.toContain("The key is lost");
  });

  it("refuses a replacement for another character or one before the fact began", async () => {
    const { user, project, chapters } = await seed();
    const joe = await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "Suzy has the pen",
      stance: "suspects",
      chapterId: chapters[3].id,
    });
    await expect(
      addKnowledgeFact(project.id, user, {
        characterPath: "characters/suzy.md",
        fact: "Joe has it",
        stance: "knows",
        chapterId: chapters[4].id,
        replacesFactId: joe.id,
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      addKnowledgeFact(project.id, user, {
        characterPath: "characters/joe.md",
        fact: "Mara has it",
        stance: "knows",
        chapterId: chapters[1].id,
        replacesFactId: joe.id,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("scopes the editor context to the open chapter: drafting chapter 2 never sees chapter 6", async () => {
    const { user, project, chapters } = await seed();
    const unaware = await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "Who has the pen",
      stance: "unaware",
    });
    await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "Suzy has the pen",
      stance: "suspects",
      chapterId: chapters[5].id,
      replacesFactId: unaware.id,
    });

    const at2 = await buildEditorContext(project.id, chapters[1].id, "chapter");
    expect(at2).toContain("# WHO KNOWS WHAT as of the end of chapter 2");
    expect(at2).toContain("- joe does not know: Who has the pen [before the story]");
    expect(at2).not.toContain("Suzy has the pen");

    const at6 = await buildEditorContext(project.id, chapters[5].id, "chapter");
    expect(at6).toContain("# WHO KNOWS WHAT as of the end of chapter 6");
    expect(at6).toContain("- joe suspects: Suzy has the pen [from ch. 6]");
    expect(at6).not.toContain("Who has the pen");
  });
});
