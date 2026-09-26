import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), hasKey: true }));

vi.mock("@/lib/anthropic", () => ({
  DRAFTER_FAST_MODEL: "claude-haiku-4-5",
  DRAFTER_MODEL: "claude-sonnet-5",
  hasAnthropicKey: () => mocks.hasKey,
  getAnthropic: () => ({ messages: { create: mocks.create } }),
}));

import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { getRecap, getStuckPrompts } from "@/lib/recap";
import {
  fingerprintText,
  parseStuckPrompts,
  shouldShowRecap,
  RECAP_ABSENCE_MS,
} from "@/lib/recap-view";

const reply = (text: string) => ({ content: [{ type: "text", text }] });
const prose = (word: string) => `<p>${Array.from({ length: 150 }, () => word).join(" ")}</p>`;

const write = (id: string, content: string) =>
  prisma.chapter.update({ where: { id }, data: { content } });

async function seed(email = "ada@example.com") {
  const user = await registerUser({ email, password: "long-enough-pw" });
  const project = await createProject(user, { title: "Tides" });
  const chapter = await prisma.chapter.findFirstOrThrow({ where: { projectId: project.id } });
  return { user, project, chapter };
}

describe("previously-on recap and stuck prompts", () => {
  beforeEach(async () => {
    mocks.create.mockReset();
    mocks.hasKey = true;
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns nothing for a near-empty manuscript without calling the model", async () => {
    const { user, project } = await seed();
    expect(await getRecap(project.id, user)).toEqual({ recap: null });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("generates once and reuses the cache until the writing changes", async () => {
    const { user, project, chapter } = await seed();
    await write(chapter.id, prose("tide"));
    mocks.create.mockResolvedValue(reply("You left Marta on the pier."));

    const first = await getRecap(project.id, user);
    expect(first.recap?.text).toBe("You left Marta on the pier.");
    const again = await getRecap(project.id, user);
    expect(again.recap).toEqual(first.recap);
    expect(mocks.create).toHaveBeenCalledTimes(1);

    await write(chapter.id, prose("moon"));
    mocks.create.mockResolvedValue(reply("You left Marta at dusk."));
    expect((await getRecap(project.id, user)).recap?.text).toBe("You left Marta at dusk.");
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("serves the stale recap when the model fails, and null with no key", async () => {
    const { user, project, chapter } = await seed();
    await write(chapter.id, prose("tide"));
    mocks.create.mockResolvedValueOnce(reply("Old recap."));
    await getRecap(project.id, user);

    await write(chapter.id, prose("moon"));
    mocks.create.mockRejectedValue(new Error("boom"));
    expect((await getRecap(project.id, user)).recap?.text).toBe("Old recap.");

    mocks.hasKey = false;
    expect((await getRecap(project.id, user)).recap?.text).toBe("Old recap.");
  });

  it("marks the chapter edited last, even when it comes earlier in the story", async () => {
    const { user, project, chapter } = await seed();
    const later = await prisma.chapter.create({
      data: { projectId: project.id, title: "The Storm", order: chapter.order + 1 },
    });
    await write(later.id, prose("storm"));
    await prisma.chapter.update({
      where: { id: chapter.id },
      data: { title: "The Pier", content: prose("pier"), updatedAt: new Date(Date.now() + 60_000) },
    });
    mocks.create.mockResolvedValue(reply("You went back to the pier."));

    await getRecap(project.id, user);
    const source: string = mocks.create.mock.calls[0][0].messages[0].content;
    expect(source).toContain("## The Pier (edited most recently)");
    expect(source).toContain("## The Storm\n");
    expect(source.indexOf("The Pier")).toBeLessThan(source.indexOf("The Storm"));
  });

  it("refuses another author's manuscript", async () => {
    const { project } = await seed();
    const other = await registerUser({ email: "bob@example.com", password: "long-enough-pw" });
    await expect(getRecap(project.id, other)).rejects.toMatchObject({ status: 403 });
  });

  it("asks for stuck prompts from the chapter and bible context", async () => {
    const { user, project, chapter } = await seed();
    await write(chapter.id, prose("harbor"));
    mocks.create.mockResolvedValue(reply('```json\n["Have Marta find the letter.", "Cut to the storm."]\n```'));

    const res = await getStuckPrompts(project.id, user, { chapterId: chapter.id });
    expect(res.prompts).toEqual(["Have Marta find the letter.", "Cut to the storm."]);
    const sent = mocks.create.mock.calls[0][0];
    expect(sent.messages[0].content).toContain("harbor");
    expect(sent.messages[0].content).toContain("Tides");
  });

  it("leaves an archived chapter out of the stuck prompt context", async () => {
    const { user, project, chapter } = await seed();
    await prisma.chapter.update({
      where: { id: chapter.id },
      data: { content: prose("harbor"), archivedAt: new Date() },
    });
    mocks.create.mockResolvedValue(reply('["Start the next scene."]'));

    await getStuckPrompts(project.id, user, { chapterId: chapter.id });
    expect(mocks.create.mock.calls[0][0].messages[0].content).not.toContain("harbor");
  });

  it("reports a missing key or a bad reply as an error", async () => {
    const { user, project } = await seed();
    mocks.hasKey = false;
    await expect(getStuckPrompts(project.id, user, {})).rejects.toMatchObject({ status: 503 });
    mocks.hasKey = true;
    mocks.create.mockResolvedValue(reply("no idea"));
    await expect(getStuckPrompts(project.id, user, {})).rejects.toMatchObject({ status: 502 });
  });
});

describe("recap rules", () => {
  it("shows the recap only after a real absence", () => {
    const now = 10 * RECAP_ABSENCE_MS;
    expect(shouldShowRecap(null, now)).toBe(false);
    expect(shouldShowRecap(now - 60_000, now)).toBe(false);
    expect(shouldShowRecap(now - RECAP_ABSENCE_MS, now)).toBe(true);
  });

  it("fingerprints equal text equally", () => {
    expect(fingerprintText("abc")).toBe(fingerprintText("abc"));
    expect(fingerprintText("abc")).not.toBe(fingerprintText("abd"));
  });

  it("parses prompts from fences, prose and junk, capped and deduped", () => {
    expect(parseStuckPrompts('Here: ["a", "a", 3, " b "]')).toEqual(["a", "b"]);
    expect(parseStuckPrompts('["1","2","3","4","5"]')).toHaveLength(4);
    expect(parseStuckPrompts("nothing")).toEqual([]);
  });
});
