import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const model = vi.hoisted(() => ({
  summary: "Mara keeps the harbor watch until the lantern dies.",
  create: vi.fn(async () => ({
    content: [{ type: "text", text: model.summary }],
  })),
}));

const afterWork = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
  async flush() {
    const batch = this.pending;
    this.pending = [];
    await Promise.all(batch);
  },
}));

vi.mock("@/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/anthropic")>();
  return {
    ...actual,
    getAnthropic: () => ({
      messages: { create: model.create },
    }),
  };
});

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (task: () => unknown) => {
      afterWork.pending.push(Promise.resolve().then(task));
    },
  };
});

import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects";
import { executeEditorTool } from "@/lib/tools";
import { summarizeChapter } from "@/lib/summarize";
import { htmlToText } from "@/lib/text";
import { PATCH } from "@/app/api/chapters/[id]/route";
import { POST as POST_OPS } from "@/app/api/chapters/[id]/ops/route";

const LONG_PROSE =
  "The harbor lantern guttered in the salt wind as Mara kept watch over the black water. ".repeat(
    4
  );

function longHtml() {
  return `<p>${LONG_PROSE}</p>`;
}

async function waitForSummary(chapterId: string, expected: string) {
  await vi.waitFor(async () => {
    const chapter = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
    expect(chapter.summary).toBe(expected);
  });
}

describe("chapter summaries", () => {
  beforeEach(async () => {
    model.summary = "Mara keeps the harbor watch until the lantern dies.";
    model.create.mockReset();
    model.create.mockImplementation(async () => ({
      content: [{ type: "text", text: model.summary }],
    }));
    afterWork.pending = [];
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("writes a beat summary after a substantial chapter save", async () => {
    expect(htmlToText(longHtml()).length).toBeGreaterThanOrEqual(200);
    const project = await createProject(null, { title: "Summaries" });
    const chapter = project.chapters[0];
    await prisma.chapter.update({
      where: { id: chapter.id },
      data: { content: longHtml() },
    });

    await summarizeChapter(chapter.id);

    const saved = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(saved.summary).toBe(model.summary);
    expect(model.create).toHaveBeenCalledTimes(1);
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 200,
        messages: [{ role: "user", content: htmlToText(longHtml()) }],
      })
    );
  });

  it("clears a stale summary when the chapter drops below the minimum length", async () => {
    const project = await createProject(null, { title: "Summaries" });
    const chapter = project.chapters[0];
    await prisma.chapter.update({
      where: { id: chapter.id },
      data: { content: "<p>Short.</p>", summary: "Old beat." },
    });

    await summarizeChapter(chapter.id);

    const saved = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(saved.summary).toBe("");
    expect(model.create).not.toHaveBeenCalled();
  });

  it("refreshes the summary after a content PATCH", async () => {
    const project = await createProject(null, { title: "Summaries" });
    const chapter = project.chapters[0];
    const req = new NextRequest(`http://localhost/api/chapters/${chapter.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: longHtml(),
        expectedRevision: chapter.revision,
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: chapter.id }) });
    expect(res.status).toBe(200);
    await afterWork.flush();
    await waitForSummary(chapter.id, model.summary);
    expect(model.create).toHaveBeenCalled();
  });

  it("refreshes the summary after manuscript ops apply", async () => {
    const project = await createProject(null, { title: "Summaries" });
    const chapter = project.chapters[0];
    const req = new NextRequest(`http://localhost/api/chapters/${chapter.id}/ops`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ops: [
          {
            opId: "sum-op-1",
            baseRevision: chapter.revision,
            actor: "user",
            type: "insert_block",
            afterBlockId: null,
            blockId: "b-sum",
            html: longHtml(),
          },
        ],
      }),
    });

    const res = await POST_OPS(req, { params: Promise.resolve({ id: chapter.id }) });
    expect(res.status).toBe(200);
    await afterWork.flush();
    await waitForSummary(chapter.id, model.summary);
    expect(model.create).toHaveBeenCalled();
  });

  it("refreshes the summary after insert_text", async () => {
    const project = await createProject(null, { title: "Summaries" });
    const chapter = project.chapters[0];
    const result = await executeEditorTool(
      "insert_text",
      {
        chapterNumber: 1,
        expectedRevision: chapter.revision,
        text: LONG_PROSE,
        position: "end",
      },
      { projectId: project.id }
    );

    expect(result.mutationCount).toBe(1);
    await waitForSummary(chapter.id, model.summary);
    expect(model.create).toHaveBeenCalled();
  });

  it("fails soft when the summarizer model errors", async () => {
    model.create.mockRejectedValueOnce(new Error("haiku down"));
    const project = await createProject(null, { title: "Summaries" });
    const chapter = project.chapters[0];
    await prisma.chapter.update({
      where: { id: chapter.id },
      data: { content: longHtml(), summary: "Keep me." },
    });

    await expect(summarizeChapter(chapter.id)).resolves.toBeUndefined();
    const saved = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(saved.summary).toBe("Keep me.");
  });
});
