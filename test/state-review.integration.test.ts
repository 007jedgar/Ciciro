import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), hasKey: true }));

vi.mock("@/lib/anthropic", () => ({
  DRAFTER_MODEL: "claude-sonnet-5-5",
  hasAnthropicKey: () => mocks.hasKey,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { readBibleFile, writeBibleFile } from "@/lib/bible";
import { dismissStateProposal, keepStateProposal, runStateReview } from "@/lib/state-review";

function reply(text: string, stop_reason = "end_turn") {
  mocks.create.mockResolvedValueOnce({ stop_reason, content: [{ type: "text", text }] });
}

async function seed() {
  const user = await registerUser({ email: "ada@example.com", password: "long-enough-pw" });
  const project = await createProject(user, { title: "Tides" });
  await writeBibleFile(project.id, "characters/mara.md", "# Mara\n\nBrave.\n");
  const chapter = await prisma.chapter.create({
    data: {
      projectId: project.id,
      title: "Vault",
      order: 1,
      content: "<p>Mara found the vault empty and told no one.</p>",
    },
  });
  return { user, project, chapter };
}

describe("chapter-close review", () => {
  beforeEach(async () => {
    mocks.hasKey = true;
    mocks.create.mockReset();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("drops a proposal whose quote is not in the chapter and omits an unknown character", async () => {
    const { user, project, chapter } = await seed();
    reply(
      JSON.stringify([
        {
          kind: "canon",
          chapterQuote: "the vault empty",
          text: "The vault is empty",
          note: "She opens it.",
        },
        {
          kind: "plot",
          chapterQuote: "this sentence is not in the chapter",
          text: "Mara lies about the vault",
          note: "Paraphrase.",
        },
        {
          kind: "knowledge",
          chapterQuote: "told no one",
          text: "Mara is keeping a secret",
          note: "No file for this name.",
          stance: "believes",
          characterPath: "characters/ghost.md",
        },
      ])
    );

    const result = await runStateReview(project.id, user, { chapterId: chapter.id });

    expect(result.proposals.map((p) => p.text)).toEqual(["The vault is empty"]);
    expect(await prisma.knowledgeFact.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.bibleFile.findFirst({ where: { projectId: project.id, path: "characters/ghost.md" } })).toBeNull();
  });

  it("does not offer a dismissed proposal on the next run", async () => {
    const { user, project, chapter } = await seed();
    await dismissStateProposal(project.id, user, {
      chapterId: chapter.id,
      kind: "canon",
      chapterQuote: "the vault empty",
      text: "The vault is empty",
      note: "She opens it.",
    });
    reply(
      JSON.stringify([
        {
          kind: "canon",
          chapterQuote: "the vault empty",
          text: "  the   vault is empty  ",
          note: "Same line, different spacing.",
        },
        {
          kind: "plot",
          chapterQuote: "told no one",
          text: "Mara keeps the secret",
          note: "Still open.",
        },
      ])
    );

    const result = await runStateReview(project.id, user, { chapterId: chapter.id });

    expect(result.proposals.map((p) => p.text)).toEqual(["Mara keeps the secret"]);
  });

  it("keep writes a knowledge fact and the mirror block, and a canon bullet", async () => {
    const { user, project, chapter } = await seed();
    await keepStateProposal(project.id, user, {
      chapterId: chapter.id,
      kind: "knowledge",
      chapterQuote: "the vault empty",
      text: "The vault is empty",
      note: "She sees it.",
      stance: "knows",
      characterPath: "characters/mara.md",
    });
    await keepStateProposal(project.id, user, {
      chapterId: chapter.id,
      kind: "canon",
      chapterQuote: "told no one",
      text: "Mara tells no one the vault is empty",
      note: "A ruling.",
    });

    const fact = await prisma.knowledgeFact.findFirstOrThrow({ where: { projectId: project.id } });
    expect(fact.stance).toBe("knows");
    expect(fact.fact).toBe("The vault is empty");
    expect(fact.characterPath).toBe("characters/mara.md");
    expect(fact.status).toBe("active");
    const file = await readBibleFile(project.id, "characters/mara.md");
    expect(file).toContain("Brave.");
    expect(file).toContain("<!-- knows:start -->");
    expect(file).toContain("- knows: The vault is empty");
    expect(file).toContain("<!-- knows:end -->");
    expect(await readBibleFile(project.id, "canon.md")).toContain("Mara tells no one the vault is empty");
  });

  it("refuses to keep a quote that is not in the chapter", async () => {
    const { user, project, chapter } = await seed();
    await expect(
      keepStateProposal(project.id, user, {
        chapterId: chapter.id,
        kind: "canon",
        chapterQuote: "not in the chapter",
        text: "Invented",
        note: "No.",
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(await readBibleFile(project.id, "canon.md")).not.toContain("Invented");
  });

  it("treats a max_tokens reply as a failure and writes nothing", async () => {
    const { user, project, chapter } = await seed();
    reply('[{"kind":"canon","chapterQuote":"the vault empty","text":"Cut off"', "max_tokens");
    await expect(runStateReview(project.id, user, { chapterId: chapter.id })).rejects.toMatchObject({
      status: 502,
    });
    expect(await prisma.knowledgeFact.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.stateProposal.count({ where: { projectId: project.id } })).toBe(0);
    expect(await readBibleFile(project.id, "canon.md")).not.toContain("Cut off");
  });
});
