import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/anthropic", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/anthropic")>()),
  hasAnthropicKey: () => true,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { summarizeChapter } from "@/lib/summarize";

const reply = (text: string, stop_reason = "end_turn") => ({ content: [{ type: "text", text }], stop_reason });
const prose = (word: string) => `<p>${Array.from({ length: 150 }, () => word).join(" ")}</p>`;

async function seed(email = "ada@example.com") {
  const user = await registerUser({ email, password: "long-enough-pw" });
  const project = await createProject(user, { title: "Tides" });
  const chapter = await prisma.chapter.findFirstOrThrow({ where: { projectId: project.id } });
  await prisma.chapter.update({ where: { id: chapter.id }, data: { content: prose("tide") } });
  return { user, project, chapter };
}

describe("chapter beat summaries", () => {
  beforeEach(async () => {
    mocks.create.mockReset();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("saves the summary the model returns", async () => {
    const { user, chapter } = await seed();
    mocks.create.mockResolvedValue(reply("Mara reaches the harbor."));

    await summarizeChapter(chapter.id, user);

    const saved = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(saved.summary).toBe("Mara reaches the harbor.");
  });

  it("does not save a summary cut off at its token limit", async () => {
    const { user, chapter } = await seed();
    await prisma.chapter.update({ where: { id: chapter.id }, data: { summary: "Old summary." } });
    mocks.create.mockResolvedValue(reply("Mara reaches the har", "max_tokens"));

    await summarizeChapter(chapter.id, user);

    const saved = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(saved.summary).toBe("Old summary.");
  });
});
