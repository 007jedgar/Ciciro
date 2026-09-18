import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { appendOps } from "@/lib/chapter-ops";
import { parseSyncAfter, pullSync } from "@/lib/sync";
import { docHash, type ManuscriptOp } from "@/lib/manuscript";

// Convergence used to be assumed: the phone asked for ops after revision N and
// trusted that its own bytes at N matched the server's. When they did not — a
// dropped op, a stale replica, a snapshot written without a log entry — nothing
// noticed, and the author quietly lost a paragraph. The pull now carries a
// fingerprint so the disagreement is caught the next time the phone speaks.

describe("divergence detection on pull", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function chapterAtRevisionOne() {
    const ada = await registerUser({ email: "ada@example.com", password: "long-enough-pw" });
    const project = await createProject(ada, { title: "Divergence" });
    const chapter = project.chapters[0];
    const op: ManuscriptOp = {
      opId: "seed",
      baseRevision: chapter.revision,
      actor: "user",
      type: "insert_block",
      afterBlockId: null,
      blockId: "b1",
      html: '<p data-block-id="b1">The lamp was still burning.</p>',
    };
    const pushed = await appendOps(chapter.id, ada, [op], { actor: "user" });
    return { ada, project, chapter, head: pushed.chapter };
  }

  it("says nothing when the client's bytes match at the same revision", async () => {
    const { ada, project, chapter, head } = await chapterAtRevisionOne();
    const pulled = await pullSync(project.id, ada, {
      chapters: { [chapter.id]: head.revision },
      hashes: { [chapter.id]: docHash(head.content) },
    });
    expect(pulled.diverged).toEqual([]);
  });

  it("reports the split and hands back the whole chapter to heal from", async () => {
    const { ada, project, chapter, head } = await chapterAtRevisionOne();
    const pulled = await pullSync(project.id, ada, {
      chapters: { [chapter.id]: head.revision },
      hashes: { [chapter.id]: docHash("<p>A paragraph the server never had.</p>") },
    });

    expect(pulled.diverged).toHaveLength(1);
    const [split] = pulled.diverged;
    expect(split.chapterId).toBe(chapter.id);
    expect(split.revision).toBe(head.revision);
    expect(split.serverHash).toBe(docHash(head.content));
    expect(split.clientHash).not.toBe(split.serverHash);
    // The chapter rides along so the client heals in this same round trip
    // rather than needing another request to find out what it should hold.
    expect(split.chapter.content).toBe(head.content);
  });

  it("does not call a client that is merely behind diverged", async () => {
    const { ada, project, chapter } = await chapterAtRevisionOne();
    // Revision 0 with the bytes of revision 0. The ops in this response are
    // what carry it forward; there is nothing to heal.
    const pulled = await pullSync(project.id, ada, {
      chapters: { [chapter.id]: 0 },
      hashes: { [chapter.id]: docHash("") },
    });
    expect(pulled.diverged).toEqual([]);
    expect(pulled.ops).toHaveLength(1);
  });

  it("ignores a hash for a chapter outside the project", async () => {
    const { ada, project, chapter } = await chapterAtRevisionOne();
    const bob = await registerUser({ email: "bob@example.com", password: "long-enough-pw" });
    const other = await createProject(bob, { title: "Bob's" });
    const pulled = await pullSync(project.id, ada, {
      chapters: { [chapter.id]: 1, [other.chapters[0].id]: 0 },
      hashes: { [other.chapters[0].id]: "h-wrong" },
    });
    expect(pulled.diverged).toEqual([]);
  });

  it("parses hashes off the wire and refuses malformed ones", () => {
    expect(parseSyncAfter({ hashes: { c1: "habc" } }).hashes).toEqual({ c1: "habc" });
    expect(parseSyncAfter({ chapters: { c1: 2 } }).hashes).toBeUndefined();
    expect(() => parseSyncAfter({ hashes: { c1: 3 } })).toThrow(/hashes/);
    expect(() => parseSyncAfter({ hashes: [] })).toThrow();
  });
});
