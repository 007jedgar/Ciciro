import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { buildEditorContext } from "@/lib/context";

async function loadedChapterContent(run: () => Promise<unknown>) {
  const findProject = vi.spyOn(prisma.project, "findUnique");
  const findChapters = vi.spyOn(prisma.chapter, "findMany");
  await run();
  const projects = (await Promise.all(findProject.mock.results.map((r) => r.value))) as Array<{
    chapters?: Array<Record<string, unknown>>;
  } | null>;
  const chapterRows = (await Promise.all(findChapters.mock.results.map((r) => r.value))) as Array<
    Array<Record<string, unknown>>
  >;
  return {
    indexRows: projects.flatMap((p) => p?.chapters ?? []),
    contentIds: chapterRows
      .flat()
      .filter((row) => "content" in row)
      .map((row) => row.id as string)
      .sort(),
  };
}

describe("chapter index query stays content-free; context output is unchanged", () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("loads content only for the open and named chapters, never for the whole index", async () => {
    const project = await prisma.project.create({
      data: {
        title: "Content load fixture",
        chapters: {
          create: [
            { title: "Ch1", order: 0, content: "<p>One.</p>", wordCount: 1 },
            { title: "Ch2", order: 1, content: "<p>Two.</p>", wordCount: 1 },
            { title: "Ch3", order: 2, content: "<p>Three.</p>", wordCount: 1 },
            { title: "Ch4", order: 3, content: "<p>Four.</p>", wordCount: 1 },
          ],
        },
      },
      include: { chapters: { orderBy: { order: "asc" } } },
    });
    const [ch1, ch2, ch3] = project.chapters;

    const { indexRows, contentIds } = await loadedChapterContent(() =>
      buildEditorContext(project.id, ch2.id, "chapter", false, [3])
    );

    expect(indexRows).toHaveLength(4);
    expect(indexRows.every((row) => !("content" in row))).toBe(true);
    expect(contentIds).toEqual([ch2.id, ch3.id].sort());
    expect(contentIds).not.toContain(ch1.id);
  });

  it("loads no chapter content when no chapter is open or named", async () => {
    const project = await prisma.project.create({
      data: {
        title: "No open chapter",
        chapters: { create: [{ title: "Ch1", order: 0, content: "<p>One.</p>" }] },
      },
    });

    const { indexRows, contentIds } = await loadedChapterContent(() =>
      buildEditorContext(project.id, null, "book")
    );

    expect(indexRows).toHaveLength(1);
    expect(indexRows.every((row) => !("content" in row))).toBe(true);
    expect(contentIds).toEqual([]);
  });

  it("is byte-identical for a fixture manuscript: full index for every chapter, prose only for the open one", async () => {
    const project = await prisma.project.create({
      data: {
        title: "Fixture Manuscript",
        author: "A. Author",
        chapters: {
          create: [
            {
              title: "Chapter One",
              order: 0,
              content: "<p>UNIQUE_MARKER_CH1 opening line.</p>",
              summary: "Ch1 summary.",
              status: "draft",
              wordCount: 4,
            },
            {
              title: "Chapter Two",
              order: 1,
              content: "<p>UNIQUE_MARKER_CH2 second chapter prose.</p>",
              summary: "Ch2 summary.",
              status: "revised",
              wordCount: 4,
            },
            {
              title: "Chapter Three",
              order: 2,
              content: "<p>UNIQUE_MARKER_CH3 closing line.</p>",
              summary: "Ch3 summary.",
              status: "final",
              wordCount: 4,
            },
          ],
        },
      },
      include: { chapters: { orderBy: { order: "asc" } } },
    });
    const active = project.chapters[1];

    const first = await buildEditorContext(project.id, active.id, "chapter");
    const second = await buildEditorContext(project.id, active.id, "chapter");

    // Deterministic / stable across calls (the same query shape every time).
    expect(first).toBe(second);

    // Every chapter's index line still carries title/wordCount/status/summary.
    expect(first).toContain("- 1. Chapter One (4 words, draft) - Ch1 summary.");
    expect(first).toContain("- 2. Chapter Two (4 words, revised) - Ch2 summary.  <-- OPEN");
    expect(first).toContain("- 3. Chapter Three (4 words, final) - Ch3 summary.");

    // Only the open chapter's prose is inlined; the others never leak content.
    expect(first).toContain("UNIQUE_MARKER_CH2");
    expect(first).not.toContain("UNIQUE_MARKER_CH1");
    expect(first).not.toContain("UNIQUE_MARKER_CH3");
  });

  it("fetches a named (referenced but not open) chapter's content too", async () => {
    const project = await prisma.project.create({
      data: {
        title: "Named chapter fixture",
        chapters: {
          create: [
            { title: "Ch1", order: 0, content: "<p>UNIQUE_NAMED_MARKER text.</p>", wordCount: 3 },
            { title: "Ch2", order: 1, content: "<p>Open chapter text.</p>", wordCount: 3 },
          ],
        },
      },
      include: { chapters: { orderBy: { order: "asc" } } },
    });
    const [, ch2] = project.chapters;

    const context = await buildEditorContext(project.id, ch2.id, "book", false, [1]);
    expect(context).toContain("NAMED CHAPTER 1");
    expect(context).toContain("UNIQUE_NAMED_MARKER");
  });

  it("still returns full chapter rows (including content) for the project detail API", async () => {
    const project = await prisma.project.create({
      data: {
        title: "Detail fixture",
        chapters: { create: [{ title: "Ch1", order: 0, content: "<p>DETAIL_MARKER.</p>" }] },
      },
      include: { chapters: { orderBy: { order: "asc" } } },
    });
    const { getProject } = await import("@/lib/projects");
    const detail = await getProject(project.id, null);
    expect(detail.chapters[0].content).toContain("DETAIL_MARKER");
  });
});
