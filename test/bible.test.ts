import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { createCharacter, createPlotPoint } from "@/lib/story";
import {
  appendCanon,
  ensureBible,
  getBibleFile,
  listBible,
  listBibleFiles,
  readBibleFile,
  writeBibleFile,
} from "@/lib/bible";

describe("bible D1 storage", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("seeds bible rows from the project and never touches the data/ directory", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
      name: "Ada",
    });
    const project = await createProject(ada, {
      title: "Night Watch",
      logline: "A hook.",
      genre: "Mystery",
    });
    await createCharacter(ada, {
      projectId: project.id,
      name: "Ada Lovelace",
      role: "protagonist",
      description: "Mathematician.",
    });
    await createPlotPoint(ada, {
      projectId: project.id,
      title: "The turn",
      type: "turn",
    });

    await ensureBible(project.id);
    await ensureBible(project.id);

    const entries = await listBible(project.id);
    expect(entries.map((e) => e.path)).toEqual([
      "canon.md",
      "characters/ada-lovelace.md",
      "plot.md",
      "style.md",
      "timeline.md",
      "world.md",
    ]);
    expect(entries.find((e) => e.path === "canon.md")?.summary).toMatch(/Canon/);
    expect(await readBibleFile(project.id, "canon.md")).toContain("A hook.");
    expect(await readBibleFile(project.id, "characters/ada-lovelace.md")).toContain(
      "Ada Lovelace"
    );
    expect(await readBibleFile(project.id, "missing.md")).toBe("");

    const dataDir = path.join(process.cwd(), "data", project.id);
    await expect(fs.access(dataDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await prisma.bibleFile.count({ where: { projectId: project.id } })).toBe(6);
  });

  it("writes, lists, and CAS-protects bible files", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const project = await createProject(ada, { title: "Book" });
    await ensureBible(project.id);

    const first = await writeBibleFile(project.id, "world.md", "# World\nrewritten\n");
    expect(first.revision).toBe(1);
    expect(await readBibleFile(project.id, "world.md")).toContain("rewritten");

    const second = await writeBibleFile(
      project.id,
      "world.md",
      "# World\nagain\n",
      first.revision
    );
    expect(second.revision).toBe(2);

    await expect(
      writeBibleFile(project.id, "world.md", "# World\nstale\n", first.revision)
    ).rejects.toMatchObject({ status: 409, name: "AuthError" });

    const lww = await writeBibleFile(project.id, "world.md", "# World\nlww\n");
    expect(lww.revision).toBe(3);
    expect(await readBibleFile(project.id, "world.md")).toContain("lww");

    await appendCanon(project.id, "The fire was arson.");
    const canon = await getBibleFile(project.id, "canon.md");
    expect(canon?.content).toMatch(/The fire was arson/);
    expect(canon?.revision).toBeGreaterThan(0);

    const changed = await listBibleFiles(project.id, { "world.md": 1, "canon.md": 99 });
    expect(changed.map((f) => f.path)).toContain("world.md");
    expect(changed.map((f) => f.path)).not.toContain("canon.md");
  });

  it("rejects path traversal and non-markdown paths", async () => {
    const ada = await registerUser({
      email: "ada@example.com",
      password: "long-enough-pw",
    });
    const project = await createProject(ada, { title: "Book" });

    await expect(readBibleFile(project.id, "../secret.md")).rejects.toThrow(/escapes/);
    await expect(writeBibleFile(project.id, "/etc/passwd.md", "x")).rejects.toThrow(
      /escapes/
    );
    await expect(readBibleFile(project.id, "notes.txt")).rejects.toThrow(/\.md/);
  });
});
