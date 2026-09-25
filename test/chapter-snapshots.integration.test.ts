import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser, type PublicUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { updateChapter } from "@/lib/chapters";
import { writeChapterHtml } from "@/lib/chapter-writes";
import { pullSync } from "@/lib/sync";
import { applyRemoteOps } from "@/lib/replica-merge";
import { htmlToText } from "@/lib/text";
import {
  AUTO_SNAPSHOT_LIMIT,
  captureSnapshot,
  deleteSnapshot,
  getSnapshot,
  listSnapshots,
  MANUAL_SNAPSHOT_LIMIT,
  saveManualSnapshot,
  SESSION_GAP_MS,
} from "@/lib/snapshots";
import { restoreSnapshot } from "@/lib/snapshot-restore";

async function seed(email = "ada@example.com") {
  const user = await registerUser({ email, password: "long-enough-pw" });
  const project = await createProject(user, { title: "History" });
  return { user, project, chapter: project.chapters[0] };
}

async function head(chapterId: string) {
  return prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
}

/** The author types: a PATCH from the desk, which lands as ops. */
async function authorWrites(chapterId: string, user: PublicUser, html: string) {
  const current = await head(chapterId);
  const saved = await updateChapter(chapterId, user, {
    content: html,
    expectedRevision: current.revision,
  });
  return saved.chapter;
}

async function aiWrites(chapterId: string, html: string) {
  const current = await head(chapterId);
  const written = await writeChapterHtml(current, html, { actor: "ai" });
  expect(written.ok).toBe(true);
  return written;
}

/** Pretend the chapter's last edit happened `ms` ago. */
async function ageOps(chapterId: string, ms: number) {
  await prisma.chapterOp.updateMany({
    where: { chapterId },
    data: { createdAt: new Date(Date.now() - ms) },
  });
}

describe("chapter version history", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("saves, lists, and reads back a manual snapshot", async () => {
    const { user, chapter } = await seed();
    await authorWrites(chapter.id, user, "<p>The hall was cold.</p><p>She waited.</p>");

    const saved = await saveManualSnapshot(chapter.id, user, { label: "  First   draft " });
    expect(saved.kind).toBe("manual");
    expect(saved.label).toBe("First draft");
    expect(saved.wordCount).toBe(6);

    const list = await listSnapshots(chapter.id, user);
    expect(list.map((s) => s.id)).toEqual([saved.id]);
    expect(list[0]).not.toHaveProperty("content");

    const detail = await getSnapshot(chapter.id, saved.id, user);
    expect(htmlToText(detail.content)).toBe("The hall was cold.\n\nShe waited.");
  });

  it("keeps another author out of the history", async () => {
    const { user, chapter } = await seed();
    await authorWrites(chapter.id, user, "<p>Private prose.</p>");
    const saved = await saveManualSnapshot(chapter.id, user, {});
    const { user: mallory } = await seed("mallory@example.com");

    await expect(listSnapshots(chapter.id, mallory)).rejects.toMatchObject({ status: 403 });
    await expect(getSnapshot(chapter.id, saved.id, mallory)).rejects.toMatchObject({ status: 403 });
    await expect(restoreSnapshot(chapter.id, saved.id, mallory)).rejects.toMatchObject({
      status: 403,
    });
    await expect(deleteSnapshot(chapter.id, saved.id, mallory)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("snapshots the author's text once before an editor run changes it", async () => {
    const { user, chapter } = await seed();
    await authorWrites(chapter.id, user, "<p>Mine.</p>");

    await aiWrites(chapter.id, "<p>Mine.</p><p>Ciciro one.</p>");
    await aiWrites(chapter.id, "<p>Mine.</p><p>Ciciro one.</p><p>Ciciro two.</p>");

    let list = await listSnapshots(chapter.id, user);
    expect(list.map((s) => s.kind)).toEqual(["before_ai"]);
    const kept = await getSnapshot(chapter.id, list[0].id, user);
    expect(htmlToText(kept.content)).toBe("Mine.");

    // The author writes again, then the next run starts: a second net.
    const latest = await head(chapter.id);
    await authorWrites(chapter.id, user, `${latest.content}<p>Mine again.</p>`);
    await aiWrites(chapter.id, "<p>Rewritten by Ciciro.</p>");

    list = await listSnapshots(chapter.id, user);
    expect(list.map((s) => s.kind)).toEqual(["before_ai", "before_ai"]);
    const second = await getSnapshot(chapter.id, list[0].id, user);
    expect(htmlToText(second.content)).toContain("Mine again.");
  });

  it("does not snapshot an empty chapter before the editor drafts into it", async () => {
    const { user, chapter } = await seed();
    await aiWrites(chapter.id, "<p>A first line from Ciciro.</p>");
    expect(await listSnapshots(chapter.id, user)).toEqual([]);
  });

  it("closes a writing session when the author comes back after a break", async () => {
    const { user, chapter } = await seed();
    await authorWrites(chapter.id, user, "<p>Monday's words.</p>");
    await ageOps(chapter.id, SESSION_GAP_MS + 60_000);
    const lastEdit = (await prisma.chapterOp.findFirstOrThrow({
      where: { chapterId: chapter.id },
      orderBy: { seq: "desc" },
    })).createdAt;

    await authorWrites(chapter.id, user, "<p>Monday's words.</p><p>Tuesday's.</p>");

    const list = await listSnapshots(chapter.id, user);
    expect(list.map((s) => s.kind)).toEqual(["session"]);
    // Dated to when the last session ended, not to when the next one began.
    expect(new Date(list[0].createdAt).getTime()).toBe(lastEdit.getTime());
    const kept = await getSnapshot(chapter.id, list[0].id, user);
    expect(htmlToText(kept.content)).toBe("Monday's words.");

    // Keystrokes inside the new session add nothing.
    const latest = await head(chapter.id);
    await authorWrites(chapter.id, user, `${latest.content}<p>More.</p>`);
    expect(await listSnapshots(chapter.id, user)).toHaveLength(1);
  });

  it("restores through the op log so a phone replica converges by replaying ops", async () => {
    const { user, project, chapter } = await seed();
    const draft = await authorWrites(chapter.id, user, "<p>Draft one.</p><p>Keep me.</p>");
    const snap = await saveManualSnapshot(chapter.id, user, { label: "Draft one" });

    const later = await authorWrites(
      chapter.id,
      user,
      draft.content.replace("Draft one.", "Draft two, much worse.") + "<p>Extra.</p>"
    );
    // The phone last synced here.
    const phone = {
      id: later.id,
      projectId: project.id,
      content: later.content,
      revision: later.revision,
      wordCount: later.wordCount,
    };

    const result = await restoreSnapshot(chapter.id, snap.id, user);
    expect(htmlToText(result.chapter.content)).toBe("Draft one.\n\nKeep me.");
    expect(result.chapter.revision).toBeGreaterThan(later.revision);
    expect(result.restored.id).toBe(snap.id);

    // The restore is ops in the log, authored by the user, ending at the head.
    const ops = await prisma.chapterOp.findMany({
      where: { chapterId: chapter.id, seq: { gt: later.revision } },
      orderBy: { seq: "asc" },
    });
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every((op) => op.actor === "user")).toBe(true);
    expect(ops[ops.length - 1].seq).toBe(result.chapter.revision);
    // The untouched paragraph is not rewritten.
    expect(ops.some((op) => op.payload.includes("Keep me."))).toBe(false);

    const pulled = await pullSync(project.id, user, { chapters: { [chapter.id]: later.revision } });
    const replayed = applyRemoteOps(phone, pulled.ops);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.chapter.content).toBe(result.chapter.content);
    expect(replayed.chapter.revision).toBe(result.chapter.revision);
  });

  it("keeps the replaced text so a restore can be undone", async () => {
    const { user, chapter } = await seed();
    await authorWrites(chapter.id, user, "<p>Old version.</p>");
    const snap = await saveManualSnapshot(chapter.id, user, {});
    const current = await authorWrites(chapter.id, user, "<p>New version I might want.</p>");

    const restored = await restoreSnapshot(chapter.id, snap.id, user);
    expect(restored.backup?.kind).toBe("before_restore");
    expect(htmlToText(restored.chapter.content)).toBe("Old version.");

    const undo = await restoreSnapshot(chapter.id, restored.backup!.id, user);
    expect(undo.chapter.content).toBe(current.content);
  });

  it("restoring the text the chapter already has changes nothing", async () => {
    const { user, chapter } = await seed();
    const written = await authorWrites(chapter.id, user, "<p>Same.</p>");
    const snap = await saveManualSnapshot(chapter.id, user, {});
    const result = await restoreSnapshot(chapter.id, snap.id, user);
    expect(result.chapter.revision).toBe(written.revision);
    expect(result.backup).toBeNull();
  });

  it("bounds automatic snapshots without evicting manual ones", async () => {
    const { user, project, chapter } = await seed();
    const manual = await saveManualSnapshot(chapter.id, user, { label: "Keeper" });
    const base = Date.now() - 1_000_000;
    for (let i = 0; i < AUTO_SNAPSHOT_LIMIT + 3; i++) {
      await captureSnapshot(
        { id: chapter.id, projectId: project.id, content: `<p>Version ${i}.</p>`, revision: i },
        "session",
        { at: new Date(base + i * 1000) }
      );
    }
    const list = await listSnapshots(chapter.id, user);
    const automatic = list.filter((s) => s.kind !== "manual");
    expect(automatic).toHaveLength(AUTO_SNAPSHOT_LIMIT);
    // The oldest automatic ones went first.
    expect(automatic[automatic.length - 1].revision).toBe(3);
    expect(list.some((s) => s.id === manual.id)).toBe(true);
    expect(MANUAL_SNAPSHOT_LIMIT).toBeGreaterThan(AUTO_SNAPSHOT_LIMIT);
  });

  it("skips an automatic snapshot of text history already holds", async () => {
    const { project, chapter } = await seed();
    const text = { id: chapter.id, projectId: project.id, content: "<p>Same.</p>", revision: 1 };
    expect(await captureSnapshot(text, "session")).not.toBeNull();
    expect(await captureSnapshot(text, "before_ai")).toBeNull();
    // An author's explicit save is always honored.
    expect(await captureSnapshot(text, "manual")).not.toBeNull();
  });

  it("never lets a snapshot failure cost the author an editor write", async () => {
    const { user, chapter } = await seed();
    await authorWrites(chapter.id, user, "<p>Mine.</p>");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(prisma.chapterSnapshot, "create").mockRejectedValue(new Error("no such table"));

    const written = await aiWrites(chapter.id, "<p>Mine.</p><p>Ciciro.</p>");
    expect(htmlToText(written.content)).toContain("Ciciro.");
    expect(warn).toHaveBeenCalled();
  });

  it("deletes one snapshot", async () => {
    const { user, chapter } = await seed();
    await authorWrites(chapter.id, user, "<p>Text.</p>");
    const saved = await saveManualSnapshot(chapter.id, user, {});
    await deleteSnapshot(chapter.id, saved.id, user);
    expect(await listSnapshots(chapter.id, user)).toEqual([]);
  });
});
