import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { updateChapter } from "@/lib/chapters";
import { NextRequest } from "next/server";
import { GET as exportGet } from "@/app/api/export/[id]/route";
import {
  createScratchNote,
  deleteScratchNote,
  listScratchNotes,
  updateScratchNote,
} from "@/lib/scratch";
import { SCRATCH_CONTENT_MAX, SCRATCH_NOTES_MAX } from "@/lib/scratch-view";

async function seed(email = "ada@example.com") {
  const user = await registerUser({ email, password: "long-enough-pw" });
  const project = await createProject(user, { title: "Notes" });
  return { user, project };
}

describe("manuscript scratchpad", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates, lists newest edit first, edits and deletes notes", async () => {
    const { user, project } = await seed();
    const a = await createScratchNote(project.id, user, { title: "Research", content: "Tides" });
    const b = await createScratchNote(project.id, user, { content: "Names to use" });
    expect(a.revision).toBe(0);
    expect((await listScratchNotes(project.id, user)).map((n) => n.id)).toEqual([b.id, a.id]);

    await new Promise((r) => setTimeout(r, 5));
    const edited = await updateScratchNote(project.id, a.id, user, { content: "Tides and moons" });
    expect(edited).toMatchObject({ content: "Tides and moons", title: "Research", revision: 1 });
    expect((await listScratchNotes(project.id, user))[0].id).toBe(a.id);

    await deleteScratchNote(project.id, a.id, user);
    expect((await listScratchNotes(project.id, user)).map((n) => n.id)).toEqual([b.id]);
  });

  it("refuses a stale edit with the current note", async () => {
    const { user, project } = await seed();
    const note = await createScratchNote(project.id, user, { content: "one" });
    await updateScratchNote(project.id, note.id, user, { content: "two", expectedRevision: 0 });
    await expect(
      updateScratchNote(project.id, note.id, user, { content: "three", expectedRevision: 0 })
    ).rejects.toMatchObject({
      status: 409,
      body: { currentRevision: 1, note: { content: "two" } },
    });
    const [saved] = await listScratchNotes(project.id, user);
    expect(saved.content).toBe("two");
  });

  it("validates input and caps the scratchpad", async () => {
    const { user, project } = await seed();
    await expect(
      createScratchNote(project.id, user, { content: "x".repeat(SCRATCH_CONTENT_MAX + 1) })
    ).rejects.toMatchObject({ status: 400 });
    const note = await createScratchNote(project.id, user, {});
    await expect(updateScratchNote(project.id, note.id, user, {})).rejects.toMatchObject({
      status: 400,
    });
    await prisma.scratchNote.createMany({
      data: Array.from({ length: SCRATCH_NOTES_MAX - 1 }, () => ({ projectId: project.id })),
    });
    await expect(createScratchNote(project.id, user, {})).rejects.toMatchObject({ status: 409 });
  });

  it("keeps notes private to the manuscript's owner", async () => {
    const { user, project } = await seed();
    const other = await registerUser({ email: "bob@example.com", password: "long-enough-pw" });
    const note = await createScratchNote(project.id, user, { content: "secret" });
    await expect(listScratchNotes(project.id, other)).rejects.toMatchObject({ status: 403 });
    await expect(
      updateScratchNote(project.id, note.id, other, { content: "x" })
    ).rejects.toMatchObject({ status: 403 });
    await expect(deleteScratchNote(project.id, note.id, other)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("stays out of chapter word counts and exports, and goes with the manuscript", async () => {
    const { user, project } = await seed();
    const chapter = project.chapters[0];
    await updateChapter(chapter.id, user, {
      content: "<p>one two three</p>",
      expectedRevision: chapter.revision,
    });
    await createScratchNote(project.id, user, { content: "alpha beta gamma delta epsilon" });

    const words = await prisma.chapter.aggregate({
      where: { projectId: project.id },
      _sum: { wordCount: true },
    });
    expect(words._sum.wordCount).toBe(3);
    const res = await exportGet(
      new NextRequest(`http://localhost/api/export/${project.id}?format=markdown`),
      { params: Promise.resolve({ id: project.id }) }
    );
    const exported = await res.text();
    expect(exported).toContain("one two three");
    expect(exported).not.toContain("epsilon");

    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.scratchNote.count()).toBe(0);
  });
});
