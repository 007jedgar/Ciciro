import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, registerUser, type PublicUser } from "@/lib/auth/session";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { createProject } from "@/lib/projects";
import { updateChapter } from "@/lib/chapters";
import {
  createShareLink,
  deleteShareComment,
  deleteShareLink,
  listShareComments,
  listShareLinks,
  openSharedManuscript,
  postReaderComment,
  setShareCommentStatus,
  updateShareLink,
} from "@/lib/shares";
import { COMMENT_LIMITS } from "@/lib/share-view";
import { POST as postCommentRoute } from "@/app/api/read/[token]/comments/route";
import { GET as listLinksRoute, POST as createLinkRoute } from "@/app/api/projects/[id]/shares/route";
import { PATCH as patchLinkRoute } from "@/app/api/shares/[id]/route";
import { GET as listCommentsRoute } from "@/app/api/projects/[id]/share-comments/route";
import { PATCH as patchCommentRoute } from "@/app/api/share-comments/[id]/route";
import { middleware } from "@/middleware";

const DAY_MS = 24 * 60 * 60 * 1000;

async function author(email: string) {
  const user = await registerUser({ email, password: "long-enough-pw" });
  const project = await createProject(user, { title: `Book by ${email.split("@")[0]}` });
  return { user, project, first: project.chapters[0] };
}

async function write(chapterId: string, user: PublicUser, html: string) {
  const current = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
  const saved = await updateChapter(chapterId, user, { content: html, expectedRevision: current.revision });
  return saved.chapter;
}

async function addChapter(projectId: string, title: string, html: string, order: number) {
  return prisma.chapter.create({
    data: { projectId, title, order, content: html },
  });
}

/** Block id of the paragraph containing `text` in the chapter's current HTML. */
async function blockIdOf(chapterId: string, text: string) {
  const { content } = await prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } });
  const block = content.match(new RegExp(`<p data-block-id="([^"]+)">[^<]*${text}`));
  if (!block) throw new Error(`no block with ${text}`);
  return block[1];
}

const reader = { address: "203.0.113.7" };

function comment(chapterId: string, blockId: string, extra: Record<string, unknown> = {}) {
  return { chapterId, blockId, quote: "cold", offset: 9, body: "Loved this.", name: "Sam", ...extra };
}

describe("beta reader share links", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("reader access through a token", () => {
    it("shows every live chapter of a whole-manuscript link, and nothing archived", async () => {
      const { user, project, first } = await author("ada@example.com");
      await write(first.id, user, "<p>The hall was cold.</p>");
      const second = await addChapter(project.id, "Two", "<p>Morning came.</p>", 1);
      await addChapter(project.id, "Cut", "<p>Deleted scene.</p>", 2).then((c) =>
        prisma.chapter.update({ where: { id: c.id }, data: { archivedAt: new Date() } })
      );
      const link = await createShareLink(project.id, user, { label: "Sam" });

      const shared = await openSharedManuscript(link.token);
      expect(shared.title).toBe(project.title);
      expect(shared.chapters.map((c) => c.id)).toEqual([first.id, second.id]);
      expect(shared.chapters.map((c) => c.number)).toEqual([1, 2]);
      expect(JSON.stringify(shared)).not.toContain("Deleted scene");

      // A chapter written after the link was made is part of the manuscript.
      const third = await addChapter(project.id, "Three", "<p>Later.</p>", 3);
      expect((await openSharedManuscript(link.token)).chapters.map((c) => c.id)).toContain(third.id);
    });

    it("shows only the picked chapters of a selected-chapters link", async () => {
      const { user, project, first } = await author("ada@example.com");
      const second = await addChapter(project.id, "Two", "<p>Secret middle.</p>", 1);
      const third = await addChapter(project.id, "Three", "<p>The end.</p>", 2);
      const link = await createShareLink(project.id, user, { chapterIds: [third.id, first.id] });

      const shared = await openSharedManuscript(link.token);
      expect(shared.chapters.map((c) => c.id)).toEqual([first.id, third.id]);
      expect(JSON.stringify(shared)).not.toContain("Secret middle");
      expect(shared.chapters.some((c) => c.id === second.id)).toBe(false);

      // A picked chapter the author later archives disappears from the link.
      await prisma.chapter.update({ where: { id: third.id }, data: { archivedAt: new Date() } });
      expect((await openSharedManuscript(link.token)).chapters.map((c) => c.id)).toEqual([first.id]);
    });

    it("exposes nothing of the author's other manuscripts or other authors", async () => {
      const ada = await author("ada@example.com");
      const other = await createProject(ada.user, { title: "Ada's other book" });
      await write(other.chapters[0].id, ada.user, "<p>Other book prose.</p>");
      const mallory = await author("mallory@example.com");
      await write(mallory.first.id, mallory.user, "<p>Mallory prose.</p>");
      await write(ada.first.id, ada.user, "<p>Shared prose.</p>");
      const link = await createShareLink(ada.project.id, ada.user, {});

      const shared = JSON.stringify(await openSharedManuscript(link.token));
      expect(shared).toContain("Shared prose");
      expect(shared).not.toContain("Other book prose");
      expect(shared).not.toContain("Mallory prose");
      expect(shared).not.toContain(ada.user.email);
      expect(shared).not.toContain(ada.user.id);
    });

    it("strips anything executable from the prose a reader sees", async () => {
      const { user, project, first } = await author("ada@example.com");
      await prisma.chapter.update({
        where: { id: first.id },
        data: {
          content:
            '<p onclick="steal()">Hi <img src=x onerror="steal()"><script>steal()</script><a href="javascript:steal()">there</a></p>',
        },
      });
      const link = await createShareLink(project.id, user, {});
      const [chapter] = (await openSharedManuscript(link.token)).chapters;
      expect(chapter.html).toMatch(/^<p data-block-id="[^"]+">Hi there<\/p>$/);
    });

    it("refuses a link from another manuscript's chapters", async () => {
      const ada = await author("ada@example.com");
      const adaOther = await createProject(ada.user, { title: "Other" });
      const mallory = await author("mallory@example.com");
      await expect(
        createShareLink(ada.project.id, ada.user, { chapterIds: [adaOther.chapters[0].id] })
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        createShareLink(ada.project.id, ada.user, { chapterIds: [mallory.first.id] })
      ).rejects.toMatchObject({ status: 400 });
      await prisma.chapter.update({ where: { id: ada.first.id }, data: { archivedAt: new Date() } });
      await expect(
        createShareLink(ada.project.id, ada.user, { chapterIds: [ada.first.id] })
      ).rejects.toMatchObject({ status: 400 });
    });

    it("stops working once revoked, for reading and commenting alike", async () => {
      const { user, project, first } = await author("ada@example.com");
      await write(first.id, user, "<p>The hall was cold.</p>");
      const link = await createShareLink(project.id, user, {});
      const blockId = await blockIdOf(first.id, "cold");
      await postReaderComment(link.token, comment(first.id, blockId), reader);

      const revoked = await updateShareLink(link.id, user, { revoke: true });
      expect(revoked.status).toBe("revoked");
      await expect(openSharedManuscript(link.token)).rejects.toMatchObject({ status: 404 });
      await expect(postReaderComment(link.token, comment(first.id, blockId), reader)).rejects.toMatchObject({
        status: 404,
      });
      // Earlier comments stay with the author.
      expect(await listShareComments(project.id, user)).toHaveLength(1);
      // Renaming a revoked link does not bring it back.
      await updateShareLink(link.id, user, { label: "renamed" });
      await expect(openSharedManuscript(link.token)).rejects.toMatchObject({ status: 404 });
    });

    it("stops working when it expires", async () => {
      const { user, project, first } = await author("ada@example.com");
      await write(first.id, user, "<p>The hall was cold.</p>");
      const made = new Date();
      const link = await createShareLink(project.id, user, { expiresInDays: 7 }, made);
      expect(new Date(link.expiresAt!).getTime()).toBe(made.getTime() + 7 * DAY_MS);
      const blockId = await blockIdOf(first.id, "cold");

      const before = new Date(made.getTime() + 7 * DAY_MS - 1000);
      const after = new Date(made.getTime() + 7 * DAY_MS + 1000);
      await expect(openSharedManuscript(link.token, before)).resolves.toBeTruthy();
      await expect(openSharedManuscript(link.token, after)).rejects.toMatchObject({ status: 404 });
      await expect(
        postReaderComment(link.token, comment(first.id, blockId), reader, after)
      ).rejects.toMatchObject({ status: 404 });
      expect((await listShareLinks(project.id, user))[0].status).toBe("active");

      await expect(createShareLink(project.id, user, { expiresInDays: 0 })).rejects.toMatchObject({ status: 400 });
      await expect(createShareLink(project.id, user, { expiresInDays: 400 })).rejects.toMatchObject({
        status: 400,
      });
    });

    it("answers unknown, malformed, and deleted tokens with the same 404", async () => {
      const { user, project } = await author("ada@example.com");
      const link = await createShareLink(project.id, user, {});
      const unknown = "A".repeat(43);
      for (const token of [unknown, "short", `${link.token}x`, "", null, 42, link.id]) {
        await expect(openSharedManuscript(token)).rejects.toMatchObject({ status: 404 });
      }
      await deleteShareLink(link.id, user);
      await expect(openSharedManuscript(link.token)).rejects.toMatchObject({ status: 404 });
    });

    it("gives every link its own unguessable token", async () => {
      const { user, project } = await author("ada@example.com");
      const tokens = new Set<string>();
      for (let i = 0; i < 20; i++) tokens.add((await createShareLink(project.id, user, {})).token);
      expect(tokens.size).toBe(20);
      for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });
  });

  describe("reader comments", () => {
    it("takes a comment on a passage and shows it to the author with its place", async () => {
      const { user, project, first } = await author("ada@example.com");
      await write(first.id, user, "<p>The hall was cold.</p><p>She waited.</p>");
      const link = await createShareLink(project.id, user, { label: "Sam's read" });
      const blockId = await blockIdOf(first.id, "cold");

      const receipt = await postReaderComment(
        link.token,
        comment(first.id, blockId, { name: "  Sam   Lee ", body: "  Great line.  " }),
        reader
      );
      expect(receipt).toMatchObject({ readerName: "Sam Lee", body: "Great line.", quote: "cold" });

      const [seen] = await listShareComments(project.id, user);
      expect(seen).toMatchObject({
        linkLabel: "Sam's read",
        chapterId: first.id,
        readerName: "Sam Lee",
        status: "open",
        anchor: { blockId, offset: 13, length: 4 },
      });
      expect(seen).not.toHaveProperty("clientHash");
      expect((await listShareLinks(project.id, user))[0]).toMatchObject({ commentCount: 1, openCommentCount: 1 });
    });

    it("cannot comment on a chapter the link does not share, in any project", async () => {
      const ada = await author("ada@example.com");
      await write(ada.first.id, ada.user, "<p>The hall was cold.</p>");
      const hidden = await addChapter(ada.project.id, "Hidden", '<p data-block-id="h1">Hidden cold.</p>', 1);
      const otherBook = await createProject(ada.user, { title: "Other" });
      await write(otherBook.chapters[0].id, ada.user, "<p>Other cold.</p>");
      const mallory = await author("mallory@example.com");
      await write(mallory.first.id, mallory.user, "<p>Mallory cold.</p>");
      const link = await createShareLink(ada.project.id, ada.user, { chapterIds: [ada.first.id] });

      for (const chapterId of [hidden.id, otherBook.chapters[0].id, mallory.first.id]) {
        const blockId =
          chapterId === hidden.id ? "h1" : await blockIdOf(chapterId, "cold");
        await expect(
          postReaderComment(link.token, comment(chapterId, blockId), reader)
        ).rejects.toMatchObject({ status: 404 });
      }
      expect(await prisma.shareComment.count()).toBe(0);
    });

    it("cannot anchor a comment to a paragraph that is not in the shared chapter", async () => {
      const ada = await author("ada@example.com");
      await write(ada.first.id, ada.user, "<p>The hall was cold.</p>");
      await addChapter(ada.project.id, "Two", '<p data-block-id="b2">Other.</p>', 1);
      const link = await createShareLink(ada.project.id, ada.user, {});
      await expect(
        postReaderComment(link.token, comment(ada.first.id, "b2"), reader)
      ).rejects.toMatchObject({ status: 409 });
      await expect(
        postReaderComment(link.token, comment(ada.first.id, "made-up"), reader)
      ).rejects.toMatchObject({ status: 409 });
    });

    it("requires a name, a comment, and a passage, and bounds their size", async () => {
      const { user, project, first } = await author("ada@example.com");
      await write(first.id, user, "<p>The hall was cold.</p>");
      const link = await createShareLink(project.id, user, {});
      const blockId = await blockIdOf(first.id, "cold");
      const cases: Record<string, unknown>[] = [
        { name: "  " },
        { body: "" },
        { body: "x".repeat(2001) },
        { quote: " " },
        { offset: -1 },
        { offset: 1.5 },
        { offset: "3" },
      ];
      for (const extra of cases) {
        await expect(
          postReaderComment(link.token, comment(first.id, blockId, extra), reader)
        ).rejects.toMatchObject({ status: 400 });
      }
      const long = await postReaderComment(
        link.token,
        comment(first.id, blockId, { name: "N".repeat(200), quote: "q".repeat(900) }),
        reader
      );
      expect(long.readerName).toHaveLength(60);
      expect(long.quote).toHaveLength(500);
    });

    it("rate-limits one reader, then the link as a whole", async () => {
      const { user, project, first } = await author("ada@example.com");
      await write(first.id, user, "<p>The hall was cold.</p>");
      const link = await createShareLink(project.id, user, {});
      const blockId = await blockIdOf(first.id, "cold");
      const now = new Date();

      for (let i = 0; i < COMMENT_LIMITS.burst.max; i++) {
        await postReaderComment(link.token, comment(first.id, blockId), reader, now);
      }
      await expect(
        postReaderComment(link.token, comment(first.id, blockId), reader, now)
      ).rejects.toMatchObject({ status: 429 });
      // Another reader is not held up by the first one's burst.
      await postReaderComment(link.token, comment(first.id, blockId), { address: "198.51.100.1" }, now);
      // A minute later the first reader may comment again.
      await postReaderComment(
        link.token,
        comment(first.id, blockId),
        reader,
        new Date(now.getTime() + COMMENT_LIMITS.burst.windowMs + 1000)
      );

      // Many addresses together still hit the link's hourly budget.
      await prisma.shareComment.createMany({
        data: Array.from({ length: COMMENT_LIMITS.linkHourly.max }, (_, i) => ({
          shareLinkId: link.id,
          projectId: project.id,
          chapterId: first.id,
          readerName: "Bot",
          body: "spam",
          blockId,
          quote: "cold",
          clientHash: `bot-${i}`,
          createdAt: now,
        })),
      });
      await expect(
        postReaderComment(link.token, comment(first.id, blockId), { address: "192.0.2.99" }, now)
      ).rejects.toMatchObject({ status: 429 });
    });

    it("stops taking comments at the link's lifetime cap", async () => {
      const { user, project, first } = await author("ada@example.com");
      await write(first.id, user, "<p>The hall was cold.</p>");
      const link = await createShareLink(project.id, user, {});
      const blockId = await blockIdOf(first.id, "cold");
      await prisma.shareComment.createMany({
        data: Array.from({ length: COMMENT_LIMITS.linkTotal }, (_, i) => ({
          shareLinkId: link.id,
          projectId: project.id,
          chapterId: first.id,
          readerName: "Old",
          body: "old",
          blockId,
          quote: "cold",
          clientHash: `old-${i}`,
          createdAt: new Date(Date.now() - 30 * DAY_MS),
        })),
      });
      await expect(postReaderComment(link.token, comment(first.id, blockId), reader)).rejects.toMatchObject({
        status: 429,
      });
    });

    it("follows the passage as the author edits around it", async () => {
      const { user, project, first } = await author("ada@example.com");
      await write(first.id, user, "<p>The hall was cold.</p><p>She waited.</p>");
      const link = await createShareLink(project.id, user, {});
      const blockId = await blockIdOf(first.id, "cold");
      await postReaderComment(link.token, comment(first.id, blockId, { quote: "cold", offset: 13 }), reader);

      const { content } = await prisma.chapter.findUniqueOrThrow({ where: { id: first.id } });
      await write(first.id, user, content.replace("The hall", "The long stone hall"));
      expect((await listShareComments(project.id, user))[0].anchor).toEqual({ blockId, offset: 24, length: 4 });

      const moved = (await prisma.chapter.findUniqueOrThrow({ where: { id: first.id } })).content;
      await write(first.id, user, moved.replace("was cold", "was freezing"));
      expect((await listShareComments(project.id, user))[0].anchor).toMatchObject({ blockId, length: 0 });

      await write(first.id, user, '<p data-block-id="fresh">Entirely new.</p>');
      expect((await listShareComments(project.id, user))[0].anchor).toBeNull();
    });

    it("lets the author resolve, reopen, filter, and delete comments", async () => {
      const { user, project, first } = await author("ada@example.com");
      await write(first.id, user, "<p>The hall was cold.</p>");
      const second = await addChapter(project.id, "Two", '<p data-block-id="b2">Warm cold.</p>', 1);
      const link = await createShareLink(project.id, user, {});
      const blockId = await blockIdOf(first.id, "cold");
      const a = await postReaderComment(link.token, comment(first.id, blockId), reader);
      await postReaderComment(link.token, comment(second.id, "b2"), reader);

      const resolved = await setShareCommentStatus(a.id, user, "resolved");
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolvedAt).toBeTruthy();
      expect(await listShareComments(project.id, user, { status: "open" })).toHaveLength(1);
      expect(await listShareComments(project.id, user, { chapterId: first.id })).toHaveLength(1);
      await expect(setShareCommentStatus(a.id, user, "done")).rejects.toMatchObject({ status: 400 });

      const reopened = await setShareCommentStatus(a.id, user, "open");
      expect(reopened.resolvedAt).toBeNull();
      await deleteShareComment(a.id, user);
      expect(await listShareComments(project.id, user)).toHaveLength(1);

      await deleteShareLink(link.id, user);
      expect(await listShareComments(project.id, user)).toHaveLength(0);
    });
  });

  describe("author-only management", () => {
    it("keeps another author out of links and comments", async () => {
      const ada = await author("ada@example.com");
      await write(ada.first.id, ada.user, "<p>The hall was cold.</p>");
      const link = await createShareLink(ada.project.id, ada.user, {});
      const blockId = await blockIdOf(ada.first.id, "cold");
      const note = await postReaderComment(link.token, comment(ada.first.id, blockId), reader);
      const { user: mallory } = await author("mallory@example.com");

      await expect(listShareLinks(ada.project.id, mallory)).rejects.toMatchObject({ status: 403 });
      await expect(createShareLink(ada.project.id, mallory, {})).rejects.toMatchObject({ status: 403 });
      await expect(updateShareLink(link.id, mallory, { revoke: true })).rejects.toMatchObject({ status: 403 });
      await expect(deleteShareLink(link.id, mallory)).rejects.toMatchObject({ status: 403 });
      await expect(listShareComments(ada.project.id, mallory)).rejects.toMatchObject({ status: 403 });
      await expect(setShareCommentStatus(note.id, mallory, "resolved")).rejects.toMatchObject({ status: 403 });
      await expect(deleteShareComment(note.id, mallory)).rejects.toMatchObject({ status: 403 });
      expect((await openSharedManuscript(link.token)).chapters).toHaveLength(1);
    });

    it("never lets a link's token act as a session", async () => {
      const ada = await author("ada@example.com");
      const link = await createShareLink(ada.project.id, ada.user, {});
      const prev = process.env.CICIRO_REQUIRE_AUTH;
      process.env.CICIRO_REQUIRE_AUTH = "true";
      try {
        const headers = { [SESSION_HEADER]: link.token };
        const listed = await listLinksRoute(
          new NextRequest(`http://localhost/api/projects/${ada.project.id}/shares`, { headers }),
          { params: Promise.resolve({ id: ada.project.id }) }
        );
        expect(listed.status).toBe(401);
        const comments = await listCommentsRoute(
          new NextRequest(`http://localhost/api/projects/${ada.project.id}/share-comments`, { headers }),
          { params: Promise.resolve({ id: ada.project.id }) }
        );
        expect(comments.status).toBe(401);
      } finally {
        if (prev === undefined) delete process.env.CICIRO_REQUIRE_AUTH;
        else process.env.CICIRO_REQUIRE_AUTH = prev;
      }
    });
  });

  describe("routes", () => {
    const prev = process.env.CICIRO_REQUIRE_AUTH;
    beforeEach(() => {
      process.env.CICIRO_REQUIRE_AUTH = "true";
    });
    afterEach(() => {
      if (prev === undefined) delete process.env.CICIRO_REQUIRE_AUTH;
      else process.env.CICIRO_REQUIRE_AUTH = prev;
    });

    function commentRequest(token: string, body: unknown, headers: Record<string, string> = {}) {
      const raw = typeof body === "string" ? body : JSON.stringify(body);
      return postCommentRoute(
        new NextRequest(`http://localhost/api/read/${token}/comments`, {
          method: "POST",
          body: raw,
          headers: { "content-type": "application/json", ...headers },
        }),
        { params: Promise.resolve({ token }) }
      );
    }

    it("lets the owner make and revoke links over HTTP, and nobody else", async () => {
      const ada = await author("ada@example.com");
      const mallory = await author("mallory@example.com");
      const adaSession = await createSession(ada.user.id);
      const mallorySession = await createSession(mallory.user.id);
      const params = { params: Promise.resolve({ id: ada.project.id }) };
      const create = (session: string | null) =>
        createLinkRoute(
          new NextRequest(`http://localhost/api/projects/${ada.project.id}/shares`, {
            method: "POST",
            body: JSON.stringify({ label: "Sam", expiresInDays: 30 }),
            headers: session ? { [SESSION_HEADER]: session } : {},
          }),
          params
        );

      expect((await create(null)).status).toBe(401);
      expect((await create(mallorySession)).status).toBe(403);
      const made = await create(adaSession);
      expect(made.status).toBe(201);
      const link = await made.json();
      expect(link).toMatchObject({ label: "Sam", status: "active", path: `/read/${link.token}` });

      const revoke = (session: string) =>
        patchLinkRoute(
          new NextRequest(`http://localhost/api/shares/${link.id}`, {
            method: "PATCH",
            body: JSON.stringify({ revoke: true }),
            headers: { [SESSION_HEADER]: session },
          }),
          { params: Promise.resolve({ id: link.id }) }
        );
      expect((await revoke(mallorySession)).status).toBe(403);
      expect((await openSharedManuscript(link.token)).chapters).toHaveLength(1);
      expect((await revoke(adaSession)).status).toBe(200);
      await expect(openSharedManuscript(link.token)).rejects.toMatchObject({ status: 404 });
    });

    it("takes a reader's comment without a session and rate-limits by address", async () => {
      const { user, project, first } = await author("ada@example.com");
      await write(first.id, user, "<p>The hall was cold.</p>");
      const link = await createShareLink(project.id, user, {});
      const blockId = await blockIdOf(first.id, "cold");

      const ok = await commentRequest(link.token, comment(first.id, blockId), { "cf-connecting-ip": "203.0.113.1" });
      expect(ok.status).toBe(201);
      expect(ok.headers.get("cache-control")).toBe("no-store");
      for (let i = 1; i < COMMENT_LIMITS.burst.max; i++) {
        await commentRequest(link.token, comment(first.id, blockId), { "cf-connecting-ip": "203.0.113.1" });
      }
      const limited = await commentRequest(link.token, comment(first.id, blockId), {
        "cf-connecting-ip": "203.0.113.1",
      });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");
      const other = await commentRequest(link.token, comment(first.id, blockId), {
        "cf-connecting-ip": "203.0.113.2",
      });
      expect(other.status).toBe(201);
    });

    it("rejects oversized and malformed comment requests", async () => {
      const { user, project, first } = await author("ada@example.com");
      await write(first.id, user, "<p>The hall was cold.</p>");
      const link = await createShareLink(project.id, user, {});
      const blockId = await blockIdOf(first.id, "cold");
      const huge = await commentRequest(link.token, comment(first.id, blockId, { body: "x".repeat(20_000) }));
      expect(huge.status).toBe(413);
      expect((await commentRequest(link.token, "not json")).status).toBe(400);
      expect((await commentRequest(link.token, [1, 2])).status).toBe(400);
      const revoked = await updateShareLink(link.id, user, { revoke: true });
      const gone = await commentRequest(revoked.token, comment(first.id, blockId));
      expect(gone.status).toBe(404);
      expect(await gone.json()).toEqual({
        error: "This link is not available. It may have expired or been revoked.",
      });
    });

    it("resolves a comment only for the owner", async () => {
      const ada = await author("ada@example.com");
      await write(ada.first.id, ada.user, "<p>The hall was cold.</p>");
      const link = await createShareLink(ada.project.id, ada.user, {});
      const note = await postReaderComment(link.token, comment(ada.first.id, await blockIdOf(ada.first.id, "cold")), reader);
      const mallory = await author("mallory@example.com");
      const patch = async (session: string) =>
        patchCommentRoute(
          new NextRequest(`http://localhost/api/share-comments/${note.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "resolved" }),
            headers: { [SESSION_HEADER]: session },
          }),
          { params: Promise.resolve({ id: note.id }) }
        );
      expect((await patch(await createSession(mallory.user.id))).status).toBe(403);
      expect((await patch(await createSession(ada.user.id))).status).toBe(200);
    });

    it("lets readers through the auth gate only on reader paths", () => {
      const gate = (path: string, method = "GET") =>
        middleware(new NextRequest(`http://localhost${path}`, { method }));
      expect(gate("/read/abc").status).toBe(200);
      expect(gate("/api/read/abc/comments", "POST").status).toBe(200);
      expect(gate("/api/projects/p1/shares").status).toBe(401);
      expect(gate("/api/share-comments/c1", "PATCH").status).toBe(401);
      expect(gate("/api/shares/s1", "DELETE").status).toBe(401);
      expect(gate("/reader").status).toBe(307);
    });
  });
});
