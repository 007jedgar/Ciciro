import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { readBibleFile, writeBibleFile } from "@/lib/bible";
import { editorToolsFor, executeEditorTool } from "@/lib/tools";
import { isManuscriptWriteTool } from "@/lib/edit-mode";

// The chat's way into who knows what: the author asks Ciciro to record what a
// character knows, and it lands against the chapter the author has open.

async function seed() {
  const project = await prisma.project.create({
    data: {
      title: "Tides",
      chapters: {
        create: Array.from({ length: 6 }, (_, i) => ({
          title: `Chapter ${i + 1}`,
          order: i,
          content: `<p>Chapter ${i + 1}.</p>`,
        })),
      },
    },
    include: { chapters: { orderBy: { order: "asc" } } },
  });
  await writeBibleFile(project.id, "characters/joe.md", "# Joe\n\nA locksmith.\n");
  await writeBibleFile(project.id, "characters/suzy-hale.md", "# Suzy Hale\n\nA courier.\n");
  return project;
}

const rows = (projectId: string) =>
  prisma.knowledgeFact.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });

describe("chat knowledge tools", () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("records against the open chapter and says exactly what it recorded", async () => {
    const project = await seed();
    const open = project.chapters[5];

    const result = await executeEditorTool(
      "record_knowledge",
      { character: "Joe", stance: "suspects", fact: "Suzy has the pen", topic: "who has the pen" },
      { projectId: project.id, activeChapterId: open.id }
    );

    const [row] = await rows(project.id);
    expect(row).toMatchObject({
      characterPath: "characters/joe.md",
      stance: "suspects",
      fact: "Suzy has the pen",
      chapterId: open.id,
      topic: "who has the pen",
      status: "active",
    });
    expect(result.mutationCount).toBe(1);
    expect(result.content).toContain(`joe suspects "Suzy has the pen", from chapter 6 ("Chapter 6")`);
    expect(result.content).toContain(`id ${row.id}`);
    expect(result.content).toContain("offer to change or remove it");
    expect(result.ui).toEqual({ type: "knowledge_changed", characterPath: "characters/joe.md" });
    expect(await readBibleFile(project.id, "characters/joe.md")).toContain(
      '- suspects (from "Chapter 6"): Suzy has the pen'
    );
  });

  it("uses the chapter the author names, or before the story", async () => {
    const project = await seed();
    await executeEditorTool(
      "record_knowledge",
      { character: "characters/joe.md", stance: "knows", fact: "Mara took it", chapterNumber: 2 },
      { projectId: project.id, activeChapterId: project.chapters[5].id }
    );
    await executeEditorTool(
      "record_knowledge",
      { character: "Suzy", stance: "believes_wrong", fact: "Joe is honest", beforeStory: true },
      { projectId: project.id, activeChapterId: project.chapters[5].id }
    );
    const [named, before] = await rows(project.id);
    expect(named.chapterId).toBe(project.chapters[1].id);
    expect(before).toMatchObject({ characterPath: "characters/suzy-hale.md", chapterId: null, stance: "believes_wrong" });
  });

  it("asks rather than guesses: unknown or ambiguous characters, or no chapter open", async () => {
    const project = await seed();
    await writeBibleFile(project.id, "characters/joe-black.md", "# Joe Black\n");

    const unknown = await executeEditorTool(
      "record_knowledge",
      { character: "Mara", stance: "knows", fact: "The vault is empty" },
      { projectId: project.id, activeChapterId: project.chapters[0].id }
    );
    expect(unknown.content).toMatch(/^Not recorded: no character file matches "Mara"/);
    expect(unknown.content).toContain("Ask the author");

    const ambiguous = await executeEditorTool(
      "record_knowledge",
      { character: "Joe", stance: "knows", fact: "The vault is empty" },
      { projectId: project.id, activeChapterId: project.chapters[0].id }
    );
    expect(ambiguous.content).toContain('"Joe" could be joe black (characters/joe-black.md) or joe (characters/joe.md)');

    const specific = await executeEditorTool(
      "record_knowledge",
      { character: "Joe Black", stance: "knows", fact: "The vault is empty" },
      { projectId: project.id, activeChapterId: project.chapters[0].id }
    );
    expect(specific.content).toMatch(/^Recorded in who knows what: joe black knows/);
    await prisma.knowledgeFact.deleteMany({ where: { projectId: project.id } });

    const noChapter = await executeEditorTool(
      "record_knowledge",
      { character: "Suzy Hale", stance: "knows", fact: "The vault is empty" },
      { projectId: project.id, activeChapterId: null }
    );
    expect(noChapter.content).toContain("No chapter is open");

    const badStance = await executeEditorTool(
      "record_knowledge",
      { character: "Suzy Hale", stance: "thinks", fact: "The vault is empty" },
      { projectId: project.id, activeChapterId: project.chapters[0].id }
    );
    expect(badStance.content).toContain("stance must be one of");

    expect(await rows(project.id)).toHaveLength(0);
  });

  it("is a bible write, so it runs on a Chat only turn like append_canon and update_bible", async () => {
    const project = await seed();
    const chatOnly = editorToolsFor(false).map((tool) => tool.name);
    for (const name of ["record_knowledge", "read_knowledge", "revise_knowledge", "append_canon", "update_bible"]) {
      expect(chatOnly).toContain(name);
      expect(isManuscriptWriteTool(name)).toBe(false);
    }

    const result = await executeEditorTool(
      "record_knowledge",
      { character: "Joe", stance: "knows", fact: "Mara took it" },
      { projectId: project.id, activeChapterId: project.chapters[2].id, editsAllowed: false }
    );
    expect(result.content).toMatch(/^Recorded in who knows what/);
    expect(await rows(project.id)).toHaveLength(1);
  });

  it("reads the ledger as of the open chapter, and changes the view where the author says", async () => {
    const project = await seed();
    const ctx = (n: number) => ({ projectId: project.id, activeChapterId: project.chapters[n - 1].id });
    await executeEditorTool(
      "record_knowledge",
      { character: "Joe", stance: "unaware", fact: "Who has the pen", topic: "who has the pen", beforeStory: true },
      ctx(1)
    );
    const [first] = await rows(project.id);
    await executeEditorTool(
      "record_knowledge",
      { character: "Joe", stance: "suspects", fact: "Suzy has the pen", replacesFactId: first.id },
      ctx(6)
    );

    const at3 = await executeEditorTool("read_knowledge", { character: "joe" }, ctx(3));
    expect(at3.content).toContain('Who knows what by the end of chapter 3 ("Chapter 3") for joe:');
    expect(at3.content).toContain('joe does not know "Who has the pen"');
    expect(at3.content).not.toContain("Suzy has the pen");
    expect(at3.content).toContain("Topics in use: who has the pen");

    const at6 = await executeEditorTool("read_knowledge", {}, ctx(6));
    expect(at6.content).toContain('joe suspects "Suzy has the pen", from chapter 6');
    expect(at6.content).not.toContain("Who has the pen\"");

    const before = await executeEditorTool("read_knowledge", { beforeStory: true }, ctx(6));
    expect(before.content).toContain("before the story opens");
    expect(before.content).toContain('joe does not know "Who has the pen"');
  });

  it("revises, retires from the open chapter, and removes a fact recorded by mistake", async () => {
    const project = await seed();
    const ctx = { projectId: project.id, activeChapterId: project.chapters[1].id };
    await executeEditorTool("record_knowledge", { character: "Joe", stance: "knows", fact: "Mara took it" }, ctx);
    const [row] = await rows(project.id);

    const edited = await executeEditorTool(
      "revise_knowledge",
      { factId: row.id, stance: "suspects", fact: "Mara might have taken it" },
      ctx
    );
    expect(edited.content).toContain('joe suspects "Mara might have taken it", from chapter 2');

    const retired = await executeEditorTool(
      "revise_knowledge",
      { factId: row.id, retire: true },
      { ...ctx, activeChapterId: project.chapters[4].id }
    );
    expect(retired.content).toContain('Retired from chapter 5 ("Chapter 5") on');
    expect(await prisma.knowledgeFact.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "superseded",
      supersededAtChapterId: project.chapters[4].id,
    });

    const removed = await executeEditorTool("revise_knowledge", { factId: row.id, remove: true }, ctx);
    expect(removed.content).toMatch(/^Removed from who knows what/);
    expect(await rows(project.id)).toHaveLength(0);

    const missing = await executeEditorTool("revise_knowledge", { factId: row.id, fact: "x" }, ctx);
    expect(missing.content).toBe("Not done: Fact not found.");
  });

  it("retires everywhere at the fact's own chapter, and refuses moving it past where it stopped", async () => {
    const project = await seed();
    const ctx = { projectId: project.id, activeChapterId: project.chapters[1].id };
    await executeEditorTool("record_knowledge", { character: "Joe", stance: "knows", fact: "Mara took it" }, ctx);
    await executeEditorTool("record_knowledge", { character: "Joe", stance: "knows", fact: "The door sticks" }, ctx);
    const [first, second] = await rows(project.id);

    const everywhere = await executeEditorTool("revise_knowledge", { factId: first.id, retire: true }, ctx);
    expect(everywhere.content).toMatch(/^Retired everywhere: /);
    expect(everywhere.content).not.toContain("still holds before then");
    expect(await prisma.knowledgeFact.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      status: "superseded",
      supersededAtChapterId: null,
    });

    await executeEditorTool(
      "revise_knowledge",
      { factId: second.id, retire: true },
      { ...ctx, activeChapterId: project.chapters[3].id }
    );
    const moved = await executeEditorTool("revise_knowledge", { factId: second.id, chapterNumber: 5 }, ctx);
    expect(moved.content).toBe(
      "Not done: A retired fact can only stop being true after the chapter it dates from."
    );
    expect(await prisma.knowledgeFact.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({
      chapterId: project.chapters[1].id,
      supersededAtChapterId: project.chapters[3].id,
    });
  });
});
