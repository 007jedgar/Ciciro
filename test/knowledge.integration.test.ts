import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { readBibleFile, writeBibleFile } from "@/lib/bible";
import {
  addKnowledgeFact,
  listKnowledgeFacts,
  retireKnowledgeFact,
  updateKnowledgeFact,
} from "@/lib/knowledge";

async function seed() {
  const user = await registerUser({ email: "ada@example.com", password: "long-enough-pw" });
  const project = await createProject(user, { title: "Tides" });
  await writeBibleFile(project.id, "characters/joe.md", "# Joe\n\nA locksmith.\n");
  await writeBibleFile(project.id, "characters/suzy.md", "# Suzy\n\nA courier.\n");
  const chapter1 = await prisma.chapter.create({
    data: { projectId: project.id, title: "Chapter 1", order: 1 },
  });
  const chapter6 = await prisma.chapter.create({
    data: { projectId: project.id, title: "Chapter 6", order: 6 },
  });
  return { user, project, chapter1, chapter6 };
}

describe("knowledge ledger (the Knowledge screen's API)", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lists facts for one character with the chapter embedded", async () => {
    const { user, project, chapter6 } = await seed();
    await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "Suzy has the pen",
      stance: "believes",
      chapterId: chapter6.id,
    });
    await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "He locks the shop at dusk",
      stance: "knows",
    });

    const facts = await listKnowledgeFacts(project.id, user, {
      characterPath: "characters/joe.md",
    });
    expect(facts).toHaveLength(2);
    const withChapter = facts.find((f) => f.fact === "Suzy has the pen");
    expect(withChapter?.chapter).toMatchObject({ id: chapter6.id, title: "Chapter 6", order: 6 });
    const withoutChapter = facts.find((f) => f.fact === "He locks the shop at dusk");
    expect(withoutChapter?.chapter).toBeNull();
    expect(withoutChapter?.chapterId).toBeNull();
  });

  it("lists every character at once when characterPath is omitted", async () => {
    const { user, project } = await seed();
    await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "He locks the shop at dusk",
      stance: "knows",
    });
    await addKnowledgeFact(project.id, user, {
      characterPath: "characters/suzy.md",
      fact: "She has the pen",
      stance: "knows",
    });

    const facts = await listKnowledgeFacts(project.id, user, {});
    expect(facts.map((f) => f.characterPath).sort()).toEqual([
      "characters/joe.md",
      "characters/suzy.md",
    ]);
  });

  it("keeps a retired fact out of the default list but in the includeRetired history", async () => {
    const { user, project } = await seed();
    const fact = await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "No idea who has the pen",
      stance: "knows",
    });
    await retireKnowledgeFact(project.id, user, fact.id);

    const active = await listKnowledgeFacts(project.id, user, {
      characterPath: "characters/joe.md",
    });
    expect(active).toHaveLength(0);

    const history = await listKnowledgeFacts(project.id, user, {
      characterPath: "characters/joe.md",
      includeRetired: true,
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: "superseded" });

    const mirror = await readBibleFile(project.id, "characters/joe.md");
    expect(mirror).not.toContain("No idea who has the pen");
  });

  it("edits a fact's text, stance, and chapter in place and refreshes the mirror", async () => {
    const { user, project, chapter1, chapter6 } = await seed();
    const fact = await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "No idea who has the pen",
      stance: "knows",
      chapterId: chapter1.id,
    });

    const updated = await updateKnowledgeFact(project.id, user, fact.id, {
      fact: "Suzy has the pen",
      stance: "believes",
      chapterId: chapter6.id,
    });
    expect(updated).toMatchObject({
      fact: "Suzy has the pen",
      // The first vocabulary's "believes" lands as "suspects".
      stance: "suspects",
      chapterId: chapter6.id,
    });
    expect(updated.chapter).toMatchObject({ title: "Chapter 6" });

    const mirror = await readBibleFile(project.id, "characters/joe.md");
    expect(mirror).toContain('- suspects (from "Chapter 6"): Suzy has the pen');
    expect(mirror).not.toContain("No idea who has the pen");
  });

  it("clears a fact's chapter back to before the story opens", async () => {
    const { user, project, chapter1 } = await seed();
    const fact = await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "He locks the shop at dusk",
      stance: "knows",
      chapterId: chapter1.id,
    });

    const updated = await updateKnowledgeFact(project.id, user, fact.id, { chapterId: null });
    expect(updated.chapterId).toBeNull();
    expect(updated.chapter).toBeNull();
  });

  it("rejects a non-string fact or chapter as a bad request", async () => {
    const { user, project } = await seed();
    const fact = await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "He locks the shop at dusk",
      stance: "knows",
    });
    await expect(updateKnowledgeFact(project.id, user, fact.id, { fact: 5 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      updateKnowledgeFact(project.id, user, fact.id, { chapterId: { id: "x" } })
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses an edit from someone who does not own the project", async () => {
    const { user, project } = await seed();
    const other = await registerUser({ email: "bob@example.com", password: "long-enough-pw" });
    const fact = await addKnowledgeFact(project.id, user, {
      characterPath: "characters/joe.md",
      fact: "He locks the shop at dusk",
      stance: "knows",
    });
    await expect(
      updateKnowledgeFact(project.id, other, fact.id, { fact: "Someone else's edit" })
    ).rejects.toMatchObject({ status: 403 });
  });
});
