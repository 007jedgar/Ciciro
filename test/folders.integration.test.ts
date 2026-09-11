import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthError, registerUser } from "@/lib/auth/session";
import { createProject, deleteProject, updateProject } from "@/lib/projects";
import {
  addProjectsToFolder,
  createFolder,
  deleteFolder,
  getFolder,
  listFolders,
  removeProjectsFromFolder,
  updateFolder,
} from "@/lib/folders";

describe("manuscript folders", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a folder with a name and notes, and files manuscripts into it", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
      name: "Ada",
    });
    const first = await createProject(ada, { title: "Book One" });
    const second = await createProject(ada, { title: "Book Two" });

    await expect(createFolder(ada, { notes: "No name" })).rejects.toMatchObject({
      status: 400,
    });

    const folder = await createFolder(ada, {
      name: "  The Cycle  ",
      notes: "  Linked novels.  ",
      projectIds: [first.id, second.id],
    });
    expect(folder.userId).toBe(ada.id);
    expect(folder.name).toBe("The Cycle");
    expect(folder.notes).toBe("Linked novels.");
    expect(folder._count.projects).toBe(2);
    expect(folder.projects.map((p) => p.title).sort()).toEqual(["Book One", "Book Two"]);
    expect(folder.projects.every((p) => p.folderId === folder.id)).toBe(true);
  });

  it("lists only the signed-in author's folders", async () => {
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
    const adas = await createFolder(ada, { name: "Ada's shelf" });
    const bobs = await createFolder(bob, { name: "Bob's shelf" });
    const local = await createFolder(null, { name: "Desk drawer" });

    const adaList = await listFolders(ada);
    expect(adaList.map((f) => f.name)).toEqual(["Ada's shelf"]);

    const bobList = await listFolders(bob);
    expect(bobList.map((f) => f.name)).toEqual(["Bob's shelf"]);

    const all = await listFolders(null);
    expect(all.map((f) => f.id).sort()).toEqual([adas.id, bobs.id, local.id].sort());
  });

  it("does not leak other authors' folders when hosted auth is on", async () => {
    const prev = process.env.CICIRO_REQUIRE_AUTH;
    process.env.CICIRO_REQUIRE_AUTH = "true";
    try {
      const ada = await registerUser({
        email: "ada-hosted-folders@example.com",
        password: "long-enough-pw",
      });
      const bob = await registerUser({
        email: "bob-hosted-folders@example.com",
        password: "long-enough-pw",
      });
      await createFolder(ada, { name: "Ada hosted" });
      await createFolder(bob, { name: "Bob hosted" });

      await expect(listFolders(null)).rejects.toMatchObject({ status: 401 });
      expect((await listFolders(ada)).map((f) => f.name)).toEqual(["Ada hosted"]);
    } finally {
      if (prev === undefined) delete process.env.CICIRO_REQUIRE_AUTH;
      else process.env.CICIRO_REQUIRE_AUTH = prev;
    }
  });

  it("adds and removes manuscripts, moving them if they already have a folder", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const book = await createProject(ada, { title: "Night Watch" });
    const cycle = await createFolder(ada, { name: "Cycle" });
    const drafts = await createFolder(ada, { name: "Drafts" });

    const filed = await addProjectsToFolder(cycle.id, ada, { projectIds: [book.id] });
    expect(filed.projects.map((p) => p.id)).toEqual([book.id]);

    const moved = await addProjectsToFolder(drafts.id, ada, { projectIds: [book.id] });
    expect(moved.projects.map((p) => p.id)).toEqual([book.id]);
    expect((await getFolder(cycle.id, ada)).projects).toEqual([]);

    const emptied = await removeProjectsFromFolder(drafts.id, ada, { projectIds: [book.id] });
    expect(emptied.projects).toEqual([]);
    const unfiled = await prisma.project.findUniqueOrThrow({
      where: { id: book.id },
      select: { folderId: true },
    });
    expect(unfiled.folderId).toBeNull();
  });

  it("lets the owner rename, annotate, fetch, and delete a folder without deleting manuscripts", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const book = await createProject(ada, { title: "Keep me" });
    const folder = await createFolder(ada, {
      name: "Temp",
      projectIds: [book.id],
    });

    const renamed = await updateFolder(folder.id, ada, {
      name: "  Archive  ",
      notes: "Finished work.",
    });
    expect(renamed.name).toBe("Archive");
    expect(renamed.notes).toBe("Finished work.");
    expect((await getFolder(folder.id, ada)).name).toBe("Archive");

    await deleteFolder(folder.id, ada);
    await expect(getFolder(folder.id, ada)).rejects.toMatchObject({ status: 404 });
    const leftover = await prisma.project.findUniqueOrThrow({
      where: { id: book.id },
      select: { id: true, folderId: true, title: true },
    });
    expect(leftover).toMatchObject({ id: book.id, folderId: null, title: "Keep me" });
  });

  it("forbids another author from reading, editing, filling, or deleting a folder", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const bob = await registerUser({
      email: "bob@example.com",
      password: "long-enough-pw",
    });
    const adasBook = await createProject(ada, { title: "Private" });
    const bobsBook = await createProject(bob, { title: "Bob's" });
    const folder = await createFolder(ada, { name: "Ada only" });

    await expect(getFolder(folder.id, bob)).rejects.toMatchObject({ status: 403 });
    await expect(updateFolder(folder.id, bob, { name: "Stolen" })).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      addProjectsToFolder(folder.id, bob, { projectIds: [bobsBook.id] })
    ).rejects.toMatchObject({ status: 403 });
    await expect(deleteFolder(folder.id, bob)).rejects.toMatchObject({ status: 403 });

    await expect(
      addProjectsToFolder(folder.id, ada, { projectIds: [bobsBook.id] })
    ).rejects.toMatchObject({ status: 403 });
    await expect(createFolder(ada, { name: "Nope", projectIds: [bobsBook.id] })).rejects.toMatchObject(
      { status: 403 }
    );

    const createdInFolder = await createProject(ada, {
      title: "Filed at birth",
      folderId: folder.id,
    });
    expect(createdInFolder.folderId).toBe(folder.id);

    const moved = await updateProject(adasBook.id, ada, { folderId: folder.id });
    expect(moved.folderId).toBe(folder.id);
    const unfiled = await updateProject(adasBook.id, ada, { folderId: null });
    expect(unfiled.folderId).toBeNull();

    await expect(updateProject(adasBook.id, ada, { folderId: "missing" })).rejects.toMatchObject({
      status: 404,
    });
    await deleteProject(createdInFolder.id, ada);
  });

  it("rejects bad membership payloads", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const folder = await createFolder(ada, { name: "Empty" });
    await expect(addProjectsToFolder(folder.id, ada, {})).rejects.toBeInstanceOf(AuthError);
    await expect(
      addProjectsToFolder(folder.id, ada, { projectIds: "nope" })
    ).rejects.toMatchObject({ status: 400 });
    await expect(removeProjectsFromFolder(folder.id, ada, { projectIds: [] })).rejects.toMatchObject({
      status: 400,
    });
  });
});
