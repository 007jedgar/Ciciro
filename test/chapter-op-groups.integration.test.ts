import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import {
  appendOps,
  appendSystemOps,
  parseManuscriptOp,
  unsupportedOpVersion,
} from "@/lib/chapter-ops";
import { OP_VERSION, type ManuscriptOp } from "@/lib/manuscript";

// The engine's three promises, exercised against the real database:
// a write lands the op and the snapshot together or not at all; one authoring
// action lands whole or not at all; and a client speaking a format we do not
// understand is told so rather than half-applied.

describe("grouped, seq-claimed chapter ops", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function openChapter(email = "ada@example.com") {
    const ada = await registerUser({ email, password: "long-enough-pw" });
    const project = await createProject(ada, { title: "Groups" });
    return { ada, project, chapter: project.chapters[0] };
  }

  const seed = (baseRevision: number): ManuscriptOp => ({
    opId: "seed",
    baseRevision,
    actor: "user",
    type: "insert_block",
    afterBlockId: null,
    blockId: "b1",
    html: '<p data-block-id="b1">One two three four.</p>',
  });

  /** A Return keypress: replace the paragraph with its left half, insert the right. */
  const split = (baseRevision: number, groupId: string): ManuscriptOp[] => [
    {
      opId: `${groupId}-replace`,
      baseRevision,
      actor: "user",
      groupId,
      type: "replace_block",
      blockId: "b1",
      html: '<p data-block-id="b1">One two</p>',
    },
    {
      opId: `${groupId}-insert`,
      baseRevision: baseRevision + 1,
      actor: "user",
      groupId,
      type: "insert_block",
      afterBlockId: "b1",
      blockId: "b2",
      html: '<p data-block-id="b2">three four.</p>',
    },
  ];

  it("commits every accepted op with the seq that equals the resulting revision", async () => {
    const { ada, chapter } = await openChapter();
    const pushed = await appendOps(chapter.id, ada, [seed(chapter.revision)], {
      actor: "user",
    });
    expect(pushed.chapter.revision).toBe(1);

    const group = split(1, "g-1");
    const result = await appendOps(chapter.id, ada, group, { actor: "user" });
    expect(result.rejected).toHaveLength(0);
    expect(result.accepted.map((row) => row.seq)).toEqual([2, 3]);
    expect(result.chapter.revision).toBe(3);

    // The log is the source of truth; the snapshot is the cache it projects
    // onto. If those ever disagree the phone pushes from a base that no longer
    // exists, which is how typing used to vanish.
    const rows = await prisma.chapterOp.findMany({
      where: { chapterId: chapter.id },
      orderBy: { seq: "asc" },
    });
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(rows[rows.length - 1].seq).toBe(result.chapter.revision);
    expect(rows.map((row) => row.groupId)).toEqual([null, "g-1", "g-1"]);
    expect(result.chapter.content).toContain("One two");
    expect(result.chapter.content).toContain("three four.");
  });

  it("rejects a whole group rather than landing half a split", async () => {
    const { ada, chapter } = await openChapter();
    await appendOps(chapter.id, ada, [seed(chapter.revision)], { actor: "user" });

    // The group's replace is applicable; its insert names an anchor that will
    // be gone by the time it is reached. Before groups, the replace committed
    // and the author lost the second half of the paragraph.
    const torn: ManuscriptOp[] = [
      {
        opId: "torn-replace",
        baseRevision: 1,
        actor: "user",
        groupId: "g-torn",
        type: "replace_block",
        blockId: "b1",
        html: '<p data-block-id="b1">One two</p>',
      },
      {
        opId: "torn-insert",
        baseRevision: 2,
        actor: "user",
        groupId: "g-torn",
        type: "insert_block",
        afterBlockId: "b-nonexistent",
        blockId: "b2",
        html: '<p data-block-id="b2">three four.</p>',
      },
    ];
    const result = await appendOps(chapter.id, ada, torn, { actor: "user" });

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected.map((row) => row.op.opId)).toEqual([
      "torn-replace",
      "torn-insert",
    ]);
    expect(result.rejected.every((row) => row.reason === "missing_block")).toBe(true);
    expect(result.chapter.revision).toBe(1);
    expect(result.chapter.content).toContain("One two three four.");
    expect(await prisma.chapterOp.count({ where: { chapterId: chapter.id } })).toBe(1);
  });

  it("replays a group that already committed without applying it twice", async () => {
    const { ada, chapter } = await openChapter();
    await appendOps(chapter.id, ada, [seed(chapter.revision)], { actor: "user" });
    const group = split(1, "g-2");

    const first = await appendOps(chapter.id, ada, group, { actor: "user" });
    // The phone never saw the response and pushes its backlog again.
    const replay = await appendOps(chapter.id, ada, group, { actor: "user" });

    expect(replay.rejected).toHaveLength(0);
    expect(replay.ops).toHaveLength(0);
    expect(replay.accepted.map((row) => row.seq)).toEqual([2, 3]);
    expect(replay.chapter.revision).toBe(first.chapter.revision);
    expect(replay.chapter.content).toBe(first.chapter.content);
    expect(await prisma.chapterOp.count({ where: { chapterId: chapter.id } })).toBe(3);
  });

  it("refuses to bump a revision without an op behind it", async () => {
    const { ada, chapter } = await openChapter();
    await appendOps(chapter.id, ada, [seed(chapter.revision)], { actor: "user" });
    const group = split(1, "g-3");
    await appendOps(chapter.id, ada, group, { actor: "user" });

    // Every revision this chapter has ever been at is explained by a row in the
    // log. That is the invariant reconcileHeads exists to paper over on the
    // phone, and the one the snapshot-only writers used to break.
    const head = await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    const seqs = await prisma.chapterOp.findMany({
      where: { chapterId: chapter.id },
      select: { seq: true },
      orderBy: { seq: "asc" },
    });
    expect(seqs.map((row) => row.seq)).toEqual(
      Array.from({ length: head.revision }, (_, i) => i + 1)
    );
  });

  it("stamps the actor the route derived and discards the one the client sent", async () => {
    const { ada, project, chapter } = await openChapter();

    await appendOps(
      chapter.id,
      ada,
      [{ ...seed(chapter.revision), actor: "ai" }],
      { actor: "user" }
    );
    await appendSystemOps(
      chapter.id,
      project.id,
      [
        {
          opId: "ai-1",
          baseRevision: 1,
          actor: "user",
          type: "insert_block",
          afterBlockId: "b1",
          blockId: "b9",
          html: '<p data-block-id="b9">Drafted.</p>',
        },
      ],
      { actor: "ai" }
    );

    const rows = await prisma.chapterOp.findMany({
      where: { chapterId: chapter.id },
      orderBy: { seq: "asc" },
    });
    expect(rows.map((row) => row.actor)).toEqual(["user", "ai"]);
  });

  it("will not let a system write reach a chapter outside the project it authorized", async () => {
    const { chapter } = await openChapter("ada@example.com");
    const bob = await registerUser({ email: "bob@example.com", password: "long-enough-pw" });
    const other = await createProject(bob, { title: "Not Ada's" });

    await expect(
      appendSystemOps(chapter.id, other.id, [seed(chapter.revision)])
    ).rejects.toMatchObject({ status: 404 });
  });

  it("names the version a build is speaking instead of dropping fields it does not know", async () => {
    expect(unsupportedOpVersion([{ v: OP_VERSION }])).toBeNull();
    expect(unsupportedOpVersion([{ opId: "no-version" }])).toBeNull();
    expect(unsupportedOpVersion([{ v: OP_VERSION }, { v: OP_VERSION + 1 }])).toBe(
      OP_VERSION + 1
    );
    // A `v` that is not a version is malformed input, not an old build.
    expect(unsupportedOpVersion([{ v: 0 }])).toBeNull();
    expect(unsupportedOpVersion([{ v: "two" }])).toBeNull();
    expect(
      parseManuscriptOp({
        opId: "bad-v",
        baseRevision: 0,
        actor: "user",
        type: "delete_block",
        blockId: "b1",
        v: 0,
      })
    ).toBeNull();
  });

  it("reads an op written before versioning as the version it was", async () => {
    const parsed = parseManuscriptOp({
      opId: "legacy",
      baseRevision: 0,
      actor: "user",
      type: "delete_block",
      blockId: "b1",
    });
    expect(parsed).toMatchObject({ v: OP_VERSION, groupId: null });
  });
});
