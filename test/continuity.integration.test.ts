import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), hasKey: true }));

vi.mock("@/lib/anthropic", () => ({
  DRAFTER_MODEL: "claude-sonnet-5",
  hasAnthropicKey: () => mocks.hasKey,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { writeBibleFile } from "@/lib/bible";
import { runContinuityCheck } from "@/lib/continuity";

function reply(text: string) {
  mocks.create.mockResolvedValueOnce({ content: [{ type: "text", text }] });
}

async function seed(email = "ada@example.com") {
  const user = await registerUser({ email, password: "long-enough-pw" });
  const project = await createProject(user, { title: "Tides" });
  return { user, project };
}

async function chapterOf(projectId: string, title: string, content: string, order = 0) {
  return prisma.chapter.create({ data: { projectId, title, order, content } });
}

function promptText(call = 0): string {
  return mocks.create.mock.calls[call][0].messages[0].content as string;
}

const CONTRADICTION = JSON.stringify([
  {
    chapterQuote: "Her eyes were brown in the lamplight.",
    canonFile: "characters/mara.md",
    canonQuote: "Mara has green eyes.",
    note: "Eye color contradicts the character file.",
  },
]);

describe("continuity check", () => {
  beforeEach(async () => {
    mocks.hasKey = true;
    mocks.create.mockReset();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sends canon.md, world.md, timeline.md and only the characters the chapter names", async () => {
    const { user, project } = await seed();
    await writeBibleFile(project.id, "canon.md", "# Canon\n- POV: close third");
    await writeBibleFile(project.id, "world.md", "# World\n- The city never sleeps.");
    await writeBibleFile(project.id, "timeline.md", "# Timeline\n- Day 1: Mara arrives.");
    await writeBibleFile(project.id, "characters/mara.md", "# Mara\n> Character\nMara has green eyes.");
    await writeBibleFile(project.id, "characters/theo.md", "# Theo\n> Character\nTheo walks with a limp.");
    const chapter = await chapterOf(
      project.id,
      "Arrival",
      "<p>Mara stepped off the train. Her eyes were brown in the lamplight.</p>"
    );
    reply(CONTRADICTION);

    const result = await runContinuityCheck(project.id, user, { scope: "chapter", chapterId: chapter.id });

    expect(result.scope).toBe("chapter");
    expect(result.unchecked).toEqual([]);
    expect(result.findings).toEqual([
      {
        chapterQuote: "Her eyes were brown in the lamplight.",
        canonFile: "characters/mara.md",
        canonQuote: "Mara has green eyes.",
        note: "Eye color contradicts the character file.",
        chapterId: chapter.id,
        chapterTitle: "Arrival",
      },
    ]);

    const sent = promptText();
    expect(sent).toContain("## canon.md");
    expect(sent).toContain("## world.md");
    expect(sent).toContain("## timeline.md");
    expect(sent).toContain("## characters/mara.md");
    expect(sent).not.toContain("## characters/theo.md");
    expect(sent).toContain("Mara stepped off the train");
  });

  it("reports nothing when the model finds no contradiction", async () => {
    const { user, project } = await seed();
    const chapter = await chapterOf(project.id, "Quiet", "<p>Nothing much happened.</p>");
    reply("[]");

    const result = await runContinuityCheck(project.id, user, { scope: "chapter", chapterId: chapter.id });
    expect(result.findings).toEqual([]);
  });

  it("checks every chapter for scope book, tagging each finding with its chapter", async () => {
    const { user, project } = await seed();
    await writeBibleFile(project.id, "canon.md", "# Canon\n- Aiden works nights.");
    const one = await chapterOf(project.id, "One", "<p>Aiden arrived at dawn.</p>", 0);
    const two = await chapterOf(project.id, "Two", "<p>Aiden left at dusk.</p>", 1);
    const empty = await chapterOf(project.id, "Empty", "", 2);
    reply(
      JSON.stringify([
        { chapterQuote: "arrived at dawn", canonFile: "canon.md", canonQuote: "Aiden works nights.", note: "Time of day." },
      ])
    );
    reply("[]");

    const result = await runContinuityCheck(project.id, user, { scope: "book" });

    expect(result.scope).toBe("book");
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].chapterId).toBe(one.id);
    expect(result.findings[0].chapterTitle).toBe("One");
    // The empty chapter is skipped; the model is called once per non-empty chapter.
    expect(mocks.create).toHaveBeenCalledTimes(2);
    void two;
    void empty;
  });

  it("keeps findings from checked chapters when another chapter's call fails", async () => {
    const { user, project } = await seed();
    await writeBibleFile(project.id, "canon.md", "# Canon\n- Aiden works nights.");
    const one = await chapterOf(project.id, "One", "<p>Aiden arrived at dawn.</p>", 0);
    const two = await chapterOf(project.id, "Two", "<p>Aiden left at dusk.</p>", 1);
    mocks.create.mockImplementation(async (req: { messages: { content: string }[] }) => {
      if (req.messages[0].content.includes("# Chapter: Two")) {
        throw Object.assign(new Error("overloaded"), { status: 529 });
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify([
              { chapterQuote: "arrived at dawn", canonFile: "canon.md", canonQuote: "Aiden works nights.", note: "" },
            ]),
          },
        ],
      };
    });

    const result = await runContinuityCheck(project.id, user, { scope: "book" });

    expect(result.findings.map((f) => f.chapterId)).toEqual([one.id]);
    expect(result.unchecked).toEqual([{ chapterId: two.id, chapterTitle: "Two" }]);
  });

  it("fails the book run when no chapter could be checked", async () => {
    const { user, project } = await seed();
    await chapterOf(project.id, "One", "<p>Text.</p>", 0);
    await chapterOf(project.id, "Two", "<p>More text.</p>", 1);
    mocks.create.mockRejectedValue(Object.assign(new Error("overloaded"), { status: 529 }));
    await expect(runContinuityCheck(project.id, user, { scope: "book" })).rejects.toMatchObject({ status: 503 });
  });

  it("sends the chapter without pending suggestions, so an unaccepted edit is not read as canon", async () => {
    const { user, project } = await seed();
    const attrs = 'data-author-id="ciciro" data-author-name="Ciciro" data-created-at="2026-09-25T10:00:00.000Z"';
    const chapter = await chapterOf(
      project.id,
      "Eyes",
      `<p>Her eyes were <del data-suggestion-id="s1" ${attrs}>green</del><ins data-suggestion-id="s1" ${attrs}>brown</ins>.</p>`
    );
    reply("[]");

    await runContinuityCheck(project.id, user, { scope: "chapter", chapterId: chapter.id });

    const sent = promptText();
    expect(sent).toContain("Her eyes were green.");
    expect(sent).not.toContain("brown");
  });

  it("skips archived chapters", async () => {
    const { user, project } = await seed();
    await prisma.chapter.create({
      data: { projectId: project.id, title: "Gone", order: 0, content: "<p>Text.</p>", archivedAt: new Date() },
    });
    reply("[]");
    const result = await runContinuityCheck(project.id, user, { scope: "book" });
    expect(result.findings).toEqual([]);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("requires chapterId for a chapter-scoped check and 404s on an unknown chapter", async () => {
    const { user, project } = await seed();
    await expect(runContinuityCheck(project.id, user, { scope: "chapter" })).rejects.toMatchObject({ status: 400 });
    await expect(
      runContinuityCheck(project.id, user, { scope: "chapter", chapterId: "nope" })
    ).rejects.toMatchObject({ status: 404 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("maps editor outages to a retryable error", async () => {
    const { user, project } = await seed();
    const chapter = await chapterOf(project.id, "One", "<p>Text.</p>");
    mocks.create.mockRejectedValueOnce(Object.assign(new Error("overloaded"), { status: 529 }));
    await expect(
      runContinuityCheck(project.id, user, { scope: "chapter", chapterId: chapter.id })
    ).rejects.toMatchObject({ status: 503 });
    mocks.create.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(
      runContinuityCheck(project.id, user, { scope: "chapter", chapterId: chapter.id })
    ).rejects.toMatchObject({ status: 502 });
  });

  it("refuses without an API key", async () => {
    const { user, project } = await seed();
    mocks.hasKey = false;
    await expect(runContinuityCheck(project.id, user, { scope: "book" })).rejects.toMatchObject({ status: 503 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("keeps checks scoped to the owner's own project", async () => {
    const { project } = await seed();
    const other = await registerUser({ email: "bob@example.com", password: "long-enough-pw" });
    await expect(runContinuityCheck(project.id, other, { scope: "book" })).rejects.toMatchObject({ status: 403 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
