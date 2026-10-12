import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { createShareLink, updateShareLink, sharePreviewInfo } from "@/lib/shares";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("sharePreviewInfo", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns the author, title and kind of an active link", async () => {
    const user = await registerUser({ email: "ada@example.com", password: "long-enough-pw" });
    const project = await createProject(user, { title: "Midnight Harbor", author: "Ada Lovelace", kind: "screenplay" });
    const link = await createShareLink(project.id, user, {});

    await expect(sharePreviewInfo(link.token)).resolves.toEqual({
      author: "Ada Lovelace",
      title: "Midnight Harbor",
      kind: "screenplay",
    });
  });

  it("returns null for a revoked link", async () => {
    const user = await registerUser({ email: "ada@example.com", password: "long-enough-pw" });
    const project = await createProject(user, { title: "Midnight Harbor", author: "Ada Lovelace" });
    const link = await createShareLink(project.id, user, {});
    await updateShareLink(link.id, user, { revoke: true });

    await expect(sharePreviewInfo(link.token)).resolves.toBeNull();
  });

  it("returns null for an expired link", async () => {
    const user = await registerUser({ email: "ada@example.com", password: "long-enough-pw" });
    const project = await createProject(user, { title: "Midnight Harbor", author: "Ada Lovelace" });
    const made = new Date();
    const link = await createShareLink(project.id, user, { expiresInDays: 7 }, made);
    const after = new Date(made.getTime() + 7 * DAY_MS + 1000);

    await expect(sharePreviewInfo(link.token, after)).resolves.toBeNull();
  });

  it("returns null for an unknown or malformed token", async () => {
    await expect(sharePreviewInfo("not-a-real-token")).resolves.toBeNull();
    await expect(sharePreviewInfo(undefined)).resolves.toBeNull();
    // Right shape, but never issued.
    await expect(sharePreviewInfo("A".repeat(43))).resolves.toBeNull();
  });
});
