import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { archiveChat, loadChatSnapshot, restoreChat } from "@/lib/chat-history";

async function seedTurn(
  projectId: string,
  turnId: string,
  ask: string,
  reply: string,
  options: { emptyAssistant?: boolean } = {}
) {
  const user = await prisma.chatMessage.create({
    data: { projectId, role: "user", content: ask, kind: "chat", turnId },
  });
  const assistant = await prisma.chatMessage.create({
    data: {
      projectId,
      role: "assistant",
      content: options.emptyAssistant ? "" : reply,
      kind: "chat",
      turnId,
    },
  });
  await prisma.editorRun.create({
    data: {
      projectId,
      turnId,
      userMessageId: user.id,
      assistantMessageId: assistant.id,
      status: "completed",
      visibleOutput: reply,
    },
  });
  return { user, assistant };
}

async function project() {
  const author = await registerUser({
    email: "ada@example.com",
    password: "long-enough-pw",
    name: "Ada",
  });
  return createProject(author, { title: "Testing" });
}

describe("chat history", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("clears the chat without destroying it, and undoes by the stamp it returns", async () => {
    const book = await project();
    await seedTurn(book.id, "t1", "Say hi", "Hello.");

    expect((await loadChatSnapshot(book.id)).messages).toHaveLength(2);

    const cleared = await archiveChat(book.id);
    expect(cleared).toMatchObject({ ok: true, count: 2 });
    expect(cleared.archivedAt).toBeTruthy();
    expect((await loadChatSnapshot(book.id)).messages).toHaveLength(0);
    // Archived, not deleted — the rows are still there to come back.
    expect(await prisma.chatMessage.count({ where: { projectId: book.id } })).toBe(2);

    const restored = await restoreChat(book.id, cleared.archivedAt!);
    expect(restored).toMatchObject({ ok: true, count: 2 });
    const back = await loadChatSnapshot(book.id);
    expect(back.messages.map((m) => m.content)).toEqual(["Say hi", "Hello."]);
  });

  it("withholds the runs of cleared turns, which would otherwise put the reply back", async () => {
    const book = await project();
    // An assistant row the run has not been folded into yet: the client fills it
    // from run.visibleOutput, so a stray run resurrects a cleared reply.
    await seedTurn(book.id, "t1", "Say hi", "Hello.", { emptyAssistant: true });

    expect((await loadChatSnapshot(book.id)).runs).toHaveLength(1);

    await archiveChat(book.id);
    const after = await loadChatSnapshot(book.id);
    expect(after.messages).toHaveLength(0);
    expect(after.runs).toHaveLength(0);
  });

  it("keeps draft insertions, so an inserted draft is not offered again", async () => {
    const book = await project();
    await seedTurn(book.id, "t1", "Continue", "<draft>The night was long.</draft>");
    const chapter = await prisma.chapter.create({
      data: { projectId: book.id, title: "Chapter 1", order: 0 },
    });
    await prisma.draftInsertion.create({
      data: { projectId: book.id, turnId: "t1", segmentIndex: 1, chapterId: chapter.id },
    });

    await archiveChat(book.id);
    expect(await prisma.draftInsertion.count({ where: { projectId: book.id } })).toBe(1);
  });

  it("restores only the batch named, leaving earlier archived history alone", async () => {
    const book = await project();
    await seedTurn(book.id, "t1", "First ask", "First reply");
    const older = await archiveChat(book.id);

    await seedTurn(book.id, "t2", "Second ask", "Second reply");
    const newer = await archiveChat(book.id);

    await restoreChat(book.id, newer.archivedAt!);
    const back = await loadChatSnapshot(book.id);
    expect(back.messages.map((m) => m.content)).toEqual(["Second ask", "Second reply"]);
    expect(older.archivedAt).not.toBe(newer.archivedAt);
  });

  it("treats clearing an empty chat, and a nonsense stamp, as no-ops", async () => {
    const book = await project();
    expect(await archiveChat(book.id)).toMatchObject({ count: 0, archivedAt: null });
    expect(await restoreChat(book.id, "not-a-date")).toMatchObject({ count: 0 });
  });
});
