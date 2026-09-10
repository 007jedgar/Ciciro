import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthError, registerUser } from "@/lib/auth/session";
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  updateProject,
} from "@/lib/projects";
import {
  createChapter,
  deleteChapter,
  listChapters,
  updateChapter,
} from "@/lib/chapters";
import {
  createCharacter,
  createPlotPoint,
  createQuestion,
  listCharacters,
  listPlotPoints,
  listQuestions,
  updateCharacter,
} from "@/lib/story";

describe("manuscript and story APIs", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a manuscript with an opening chapter, defaulting title and author", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
      name: "Ada",
    });
    const untitled = await createProject(ada, {});
    expect(untitled.userId).toBe(ada.id);
    expect(untitled.title).toBe("Untitled Manuscript");
    expect(untitled.author).toBe("Ada");
    expect(untitled.chapters).toHaveLength(1);
    expect(untitled.chapters[0]).toMatchObject({ title: "Chapter 1", order: 0 });

    const named = await createProject(ada, {
      title: "  The Book  ",
      author: "  A. Lovelace  ",
      genre: " Mystery ",
      logline: " A hook. ",
    });
    expect(named).toMatchObject({
      title: "The Book",
      author: "A. Lovelace",
      genre: "Mystery",
      logline: "A hook.",
      userId: ada.id,
    });
  });

  it("lists only the signed-in author's manuscripts", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
      name: "Ada",
    });
    const bob = await registerUser({
      email: "bob@example.com",
      password: "long-enough-pw",
      name: "Bob",
    });
    const adas = await createProject(ada, { title: "Ada's book" });
    const bobs = await createProject(bob, { title: "Bob's book" });
    const local = await createProject(null, { title: "Local draft" });

    const adaList = await listProjects(ada);
    expect(adaList.map((p) => p.title)).toEqual(["Ada's book"]);
    expect(adaList[0]._count.chapters).toBe(1);

    const bobList = await listProjects(bob);
    expect(bobList.map((p) => p.title)).toEqual(["Bob's book"]);

    const all = await listProjects(null);
    expect(all.map((p) => p.id).sort()).toEqual([adas.id, bobs.id, local.id].sort());
  });

  it("forbids another author from reading, editing, or deleting a manuscript", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const bob = await registerUser({
      email: "bob@example.com",
      password: "long-enough-pw",
    });
    const project = await createProject(ada, { title: "Private" });

    await expect(getProject(project.id, bob)).rejects.toMatchObject({ status: 403 });
    await expect(updateProject(project.id, bob, { title: "Stolen" })).rejects.toMatchObject({
      status: 403,
    });
    await expect(deleteProject(project.id, bob)).rejects.toMatchObject({ status: 403 });

    const updated = await updateProject(project.id, ada, { title: "Still mine", synopsis: "Yep" });
    expect(updated.title).toBe("Still mine");
    expect(updated.synopsis).toBe("Yep");

    await deleteProject(project.id, ada);
    await expect(getProject(project.id, ada)).rejects.toMatchObject({ status: 404 });
  });

  it("lets the owner add, list, update, and delete chapters", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const bob = await registerUser({
      email: "bob@example.com",
      password: "long-enough-pw",
    });
    const project = await createProject(ada, { title: "Chapters" });
    const opening = project.chapters[0];

    await expect(
      createChapter(bob, { projectId: project.id, title: "Nope" })
    ).rejects.toMatchObject({ status: 403 });

    const second = await createChapter(ada, { projectId: project.id });
    expect(second.title).toBe("Chapter 2");
    expect(second.order).toBe(1);

    const named = await createChapter(ada, { projectId: project.id, title: "  Epilogue  " });
    expect(named.title).toBe("Epilogue");

    const listed = await listChapters(project.id, ada);
    expect(listed.map((c) => c.title)).toEqual(["Chapter 1", "Chapter 2", "Epilogue"]);

    const saved = await updateChapter(opening.id, ada, {
      title: "Prologue",
      content: "<p>Once upon a time.</p>",
      expectedRevision: opening.revision,
    });
    expect(saved.chapter.title).toBe("Prologue");
    expect(saved.chapter.wordCount).toBe(4);
    expect(saved.chapter.revision).toBe(opening.revision + 1);
    expect(saved.contentChanged).toBe(true);

    await expect(
      updateChapter(opening.id, ada, { title: "Stale", expectedRevision: opening.revision })
    ).rejects.toMatchObject({ status: 409 });

    await expect(updateChapter(opening.id, ada, { title: "No rev" })).rejects.toMatchObject({
      status: 428,
    });

    await expect(deleteChapter(second.id, bob)).rejects.toMatchObject({ status: 403 });
    await deleteChapter(second.id, ada);
    const remaining = await listChapters(project.id, ada);
    expect(remaining.map((c) => c.title)).toEqual(["Prologue", "Epilogue"]);
    expect(remaining.map((c) => c.order)).toEqual([0, 1]);
  });

  it("scopes characters, plot points, and questions to the manuscript owner", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const bob = await registerUser({
      email: "bob@example.com",
      password: "long-enough-pw",
    });
    const project = await createProject(ada, { title: "Story" });

    await expect(
      createCharacter(bob, { projectId: project.id, name: "Intruder" })
    ).rejects.toMatchObject({ status: 403 });

    const mara = await createCharacter(ada, {
      projectId: project.id,
      name: "  Mara  ",
      role: "protagonist",
    });
    expect(mara.name).toBe("Mara");
    const renamed = await updateCharacter(mara.id, ada, { role: "narrator" });
    expect(renamed.role).toBe("narrator");
    await expect(updateCharacter(mara.id, bob, { name: "Stolen" })).rejects.toMatchObject({
      status: 403,
    });
    expect((await listCharacters(project.id, ada)).map((c) => c.name)).toEqual(["Mara"]);
    await expect(listCharacters(project.id, bob)).rejects.toMatchObject({ status: 403 });

    const beat = await createPlotPoint(ada, { projectId: project.id, title: "The turn" });
    expect(beat.order).toBe(0);
    expect(beat.type).toBe("beat");
    await expect(
      createPlotPoint(bob, { projectId: project.id, title: "Nope" })
    ).rejects.toMatchObject({ status: 403 });
    expect((await listPlotPoints(project.id, ada)).map((p) => p.title)).toEqual(["The turn"]);

    const question = await createQuestion(ada, {
      projectId: project.id,
      question: "Who is the killer?",
    });
    expect(question.status).toBe("open");
    const open = await listQuestions(project.id, ada, "open");
    expect(open.map((q) => q.id)).toEqual([question.id]);
    await expect(listQuestions(project.id, bob)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects create payloads that omit required ids", async () => {
    await expect(createChapter(null, {})).rejects.toBeInstanceOf(AuthError);
    await expect(createCharacter(null, { name: "Mara" })).rejects.toMatchObject({ status: 400 });
    await expect(createPlotPoint(null, { projectId: "x" })).rejects.toMatchObject({ status: 400 });
    await expect(createQuestion(null, { projectId: "x" })).rejects.toMatchObject({ status: 400 });
  });
});
