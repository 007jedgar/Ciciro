import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { buildEditorContext } from "@/lib/context";
import { visibleChaptersInclude } from "@/lib/chapters";

describe("chapter index query stays content-free; context output is unchanged", () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("visibleChaptersInclude selects only the fields buildEditorContext's index needs", () => {
    expect(visibleChaptersInclude.select).toEqual({
      id: true,
      title: true,
      order: true,
      wordCount: true,
      status: true,
      summary: true,
    });
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
