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
import { createCanvasCard, createOutlineFromReply } from "@/lib/canvas";
import { generateCanvas } from "@/lib/canvas-ai";

function reply(text: string, stop_reason = "end_turn") {
  mocks.create.mockResolvedValueOnce({ stop_reason, content: [{ type: "text", text }] });
}

async function seed() {
  const user = await registerUser({ email: "ada@example.com", password: "long-enough-pw" });
  const project = await createProject(user, { title: "Tides" });
  const premise = await createCanvasCard(project.id, user, { title: "Premise", body: "A theft.", x: 40, y: 20 });
  return { user, project, premise };
}

describe("canvas outline", () => {
  beforeEach(async () => {
    mocks.hasKey = true;
    mocks.create.mockReset();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates no cards from a bad or truncated outline", async () => {
    const { user, project, premise } = await seed();
    const before = await prisma.canvasCard.count({ where: { projectId: project.id } });
    for (const raw of ["", "{", '{"title":"Part 1"', '{"nodes":[{"title":"Part 1: Home"']) {
      expect(await createOutlineFromReply(project.id, user, premise.id, raw)).toEqual({
        created: 0,
        cardIds: [],
      });
    }
    expect(await prisma.canvasCard.count({ where: { projectId: project.id } })).toBe(before);
    expect(await prisma.canvasEdge.count({ where: { projectId: project.id } })).toBe(0);
    expect(await prisma.canvasLabel.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("accepts a parsed outline under the premise and does not touch the manuscript", async () => {
    const { user, project, premise } = await seed();
    const chaptersBefore = await prisma.chapter.count({ where: { projectId: project.id } });
    const raw = JSON.stringify({
      nodes: [
        {
          title: "Part 1: The Ordinary World",
          body: "Home.",
          children: [{ title: "Part 2: The Call", body: "A letter.", children: [] }],
        },
      ],
    });
    const result = await createOutlineFromReply(project.id, user, premise.id, raw);
    expect(result.created).toBe(2);
    const cards = await prisma.canvasCard.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "asc" },
    });
    expect(cards.map((card) => card.title)).toEqual([
      "Premise",
      "Part 1: The Ordinary World",
      "Part 2: The Call",
    ]);
    const edges = await prisma.canvasEdge.findMany({ where: { projectId: project.id } });
    expect(edges).toHaveLength(2);
    expect(edges.map((edge) => edge.fromId).sort()).toEqual([premise.id, result.cardIds[0]].sort());
    expect(await prisma.chapter.count({ where: { projectId: project.id } })).toBe(chaptersBefore);
    expect(await prisma.canvasLabel.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("does not write a card when Fill is cut off or when it only returns a body", async () => {
    const { user, project, premise } = await seed();
    reply('{"body":"She leaves', "max_tokens");
    await expect(
      generateCanvas(project.id, user, { mode: "fill", cardId: premise.id })
    ).rejects.toMatchObject({ status: 502 });
    expect(await prisma.canvasCard.findUniqueOrThrow({ where: { id: premise.id } })).toMatchObject({
      body: "A theft.",
    });

    reply('{"body":"She leaves at dawn."}');
    const filled = await generateCanvas(project.id, user, { mode: "fill", cardId: premise.id });
    expect(filled).toEqual({ mode: "fill", body: "She leaves at dawn." });
    expect(await prisma.canvasCard.findUniqueOrThrow({ where: { id: premise.id } })).toMatchObject({
      body: "A theft.",
    });
    expect(await prisma.canvasCard.count({ where: { projectId: project.id } })).toBe(1);
  });
});
