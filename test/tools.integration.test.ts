import { afterAll, beforeEach, describe, expect, it } from "vitest";
import fixture from "./fixtures/malformed-manuscript.json";
import { prisma } from "@/lib/db";
import { normalizePassageComparison } from "@/lib/passages";
import { executeEditorTool } from "@/lib/tools";

async function seedFixture() {
  return prisma.project.create({
    data: {
      title: "Malformed fixture",
      chapters: {
        create: fixture.chapters.map((chapter, order) => ({
          ...chapter,
          order,
        })),
      },
    },
    include: { chapters: { orderBy: { order: "asc" } } },
  });
}

describe("revision-safe structural tools", () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects stale deletion without changing manuscript bytes", async () => {
    const project = await seedFixture();
    const before = project.chapters[0];
    const result = await executeEditorTool(
      "delete_passages",
      { passageId: "ch1.p1", expectedRevision: before.revision - 1 },
      { projectId: project.id }
    );
    const after = await prisma.chapter.findUniqueOrThrow({
      where: { id: before.id },
    });

    expect(result.status).toBe("revision conflict");
    expect(result.mutationCount ?? 0).toBe(0);
    expect(after.content).toBe(before.content);
    expect(after.revision).toBe(before.revision);
  });

  it("reports normalized destination duplicates with its revision", async () => {
    const project = await seedFixture();
    const result = await executeEditorTool(
      "passage_exists",
      { chapterNumber: 2, passage: fixture.duplicatePassage },
      { projectId: project.id }
    );
    expect(JSON.parse(result.content)).toMatchObject({
      chapterNumber: 2,
      revision: fixture.chapters[1].revision,
      exists: true,
      count: 1,
    });
  });

  it("removes a fused boundary without duplicating an existing destination passage", async () => {
    const project = await seedFixture();
    const [source, destination] = project.chapters;
    const result = await executeEditorTool(
      "split_chapter_at",
      {
        sourceChapter: 1,
        destinationChapter: 2,
        boundary: fixture.boundary,
        expectedSourceRevision: source.revision,
        expectedDestinationRevision: destination.revision,
      },
      { projectId: project.id }
    );
    const [sourceAfter, destinationAfter] = await prisma.chapter.findMany({
      where: { projectId: project.id },
      orderBy: { order: "asc" },
    });

    expect(result.mutationCount).toBe(1);
    expect(sourceAfter.content).not.toContain(fixture.boundary);
    expect(normalizePassageComparison(sourceAfter.content)).not.toContain(
      normalizePassageComparison(fixture.duplicatePassage)
    );
    expect(destinationAfter.content).toBe(destination.content);
    expect(destinationAfter.revision).toBe(destination.revision);
  });

  it("rolls back both chapters on a stale split destination", async () => {
    const project = await seedFixture();
    const [source, destination] = project.chapters;
    const result = await executeEditorTool(
      "split_chapter_at",
      {
        sourceChapter: 1,
        destinationChapter: 2,
        boundary: fixture.boundary,
        expectedSourceRevision: source.revision,
        expectedDestinationRevision: destination.revision - 1,
      },
      { projectId: project.id }
    );
    const after = await prisma.chapter.findMany({
      where: { projectId: project.id },
      orderBy: { order: "asc" },
    });

    expect(result.status).toBe("revision conflict");
    expect(after.map(({ content, revision }) => ({ content, revision }))).toEqual(
      project.chapters.map(({ content, revision }) => ({ content, revision }))
    );
  });
});
