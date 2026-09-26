import { createHash, randomBytes } from "node:crypto";
import type { ShareComment, ShareLink } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { stampBlockIds } from "@/lib/manuscript";
import { commentableBlockIds, commentAnchorLocator, sanitizeReaderHtml } from "@/lib/share-html";
import {
  cleanLine,
  COMMENT_BODY_MAX,
  COMMENT_LIMITS,
  COMMENT_QUOTE_MAX,
  isShareTokenShape,
  READER_NAME_MAX,
  SHARE_EXPIRY_MAX_DAYS,
  SHARE_LABEL_MAX,
  sharePath,
  shareLinkStatus,
  type ReaderCommentReceipt,
  type ShareCommentStatus,
  type ShareCommentView,
  type ShareLinkCreateRequest,
  type ShareLinkPatchRequest,
  type ShareLinkSummary,
  type SharedManuscript,
} from "@/lib/share-view";

// Beta reader links. The author side is ordinary owner-checked project access.
// The reader side has no session at all: the token is the only credential, so
// every reader entry point resolves it through activeLink() and scopes every
// read and write to that link's project and chapters. A token that is unknown,
// revoked or expired gets the same 404, so a guess learns nothing.

const DAY_MS = 24 * 60 * 60 * 1000;

const UNAVAILABLE = "This link is not available. It may have expired or been revoked.";

type LinkRow = ShareLink & { comments?: Pick<ShareComment, "status">[] };

function parseChapterIds(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toSummary(row: LinkRow, now = new Date()): ShareLinkSummary {
  const comments = row.comments ?? [];
  return {
    id: row.id,
    projectId: row.projectId,
    label: row.label,
    path: sharePath(row.token),
    token: row.token,
    chapterIds: parseChapterIds(row.chapterIds),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    status: shareLinkStatus(row, now),
    commentCount: comments.length,
    openCommentCount: comments.filter((c) => c.status === "open").length,
    createdAt: row.createdAt.toISOString(),
  };
}

const WITH_COMMENT_STATUS = { comments: { select: { status: true } } } as const;

/** The owned link, or a 404 when it is not in a project `user` may open. */
async function ownedLink(linkId: string, user: PublicUser | null): Promise<ShareLink> {
  const link = await prisma.shareLink.findUnique({ where: { id: linkId } });
  if (!link) throw new AuthError("Not found.", 404);
  await authorizeOwnedProject(link.projectId, user);
  return link;
}

function parseExpiry(value: unknown, now: Date): Date | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > SHARE_EXPIRY_MAX_DAYS) {
    throw new AuthError(`Expiry must be between 1 and ${SHARE_EXPIRY_MAX_DAYS} days.`, 400);
  }
  return new Date(now.getTime() + value * DAY_MS);
}

async function parseSharedChapters(projectId: string, value: unknown): Promise<string[]> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new AuthError("chapterIds must be a list of chapter ids.", 400);
  }
  const wanted = [...new Set(value as string[])];
  if (wanted.length === 0) return [];
  const found = await prisma.chapter.findMany({
    where: { id: { in: wanted }, projectId, archivedAt: null },
    select: { id: true },
  });
  if (found.length !== wanted.length) {
    throw new AuthError("Every shared chapter must be a live chapter of this manuscript.", 400);
  }
  return wanted;
}

export async function listShareLinks(
  projectId: string,
  user: PublicUser | null
): Promise<ShareLinkSummary[]> {
  await authorizeOwnedProject(projectId, user);
  const rows = await prisma.shareLink.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: WITH_COMMENT_STATUS,
  });
  const now = new Date();
  return rows.map((row) => toSummary(row, now));
}

export async function createShareLink(
  projectId: string,
  user: PublicUser | null,
  input: ShareLinkCreateRequest,
  now: Date = new Date()
): Promise<ShareLinkSummary> {
  await authorizeOwnedProject(projectId, user);
  const expiresAt = parseExpiry(input.expiresInDays, now);
  const chapterIds = await parseSharedChapters(projectId, input.chapterIds);
  const row = await prisma.shareLink.create({
    data: {
      projectId,
      token: randomBytes(32).toString("base64url"),
      label: cleanLine(input.label, SHARE_LABEL_MAX),
      chapterIds: JSON.stringify(chapterIds),
      expiresAt,
    },
    include: WITH_COMMENT_STATUS,
  });
  return toSummary(row, now);
}

/** Rename a link or revoke it. A revoked link never works again. */
export async function updateShareLink(
  linkId: string,
  user: PublicUser | null,
  input: ShareLinkPatchRequest
): Promise<ShareLinkSummary> {
  const link = await ownedLink(linkId, user);
  const data: { label?: string; revokedAt?: Date } = {};
  if (input.label !== undefined) data.label = cleanLine(input.label, SHARE_LABEL_MAX);
  if (input.revoke === true && !link.revokedAt) data.revokedAt = new Date();
  const row = await prisma.shareLink.update({
    where: { id: link.id },
    data,
    include: WITH_COMMENT_STATUS,
  });
  return toSummary(row);
}

/** Delete a link and every comment left through it. */
export async function deleteShareLink(linkId: string, user: PublicUser | null): Promise<{ ok: true }> {
  const link = await ownedLink(linkId, user);
  await prisma.shareLink.delete({ where: { id: link.id } });
  return { ok: true };
}

// --- Reader side: the token is the only credential ---

/** The live link a token names, or the uniform 404. */
async function activeLink(token: unknown, now: Date): Promise<ShareLink> {
  if (!isShareTokenShape(token)) throw new AuthError(UNAVAILABLE, 404);
  const link = await prisma.shareLink.findUnique({ where: { token } });
  if (!link || shareLinkStatus(link, now) !== "active") throw new AuthError(UNAVAILABLE, 404);
  return link;
}

/** Live chapters the link shares, in manuscript order. */
async function sharedChapters(link: ShareLink) {
  const picked = parseChapterIds(link.chapterIds);
  return prisma.chapter.findMany({
    where: {
      projectId: link.projectId,
      archivedAt: null,
      ...(picked.length > 0 ? { id: { in: picked } } : {}),
    },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true, content: true },
  });
}

/** Everything a reader page shows for `token`, and nothing more. */
export async function openSharedManuscript(
  token: unknown,
  now: Date = new Date()
): Promise<SharedManuscript> {
  const link = await activeLink(token, now);
  const project = await prisma.project.findUnique({
    where: { id: link.projectId },
    select: { title: true, author: true },
  });
  if (!project) throw new AuthError(UNAVAILABLE, 404);
  const chapters = await sharedChapters(link);
  return {
    title: project.title,
    author: project.author,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    chapters: chapters.map((chapter, i) => ({
      id: chapter.id,
      title: chapter.title,
      number: i + 1,
      html: sanitizeReaderHtml(stampBlockIds(chapter.content)),
    })),
  };
}

/** Rate-limit key for one reader on one link. The address itself is not kept. */
export function readerClientHash(linkId: string, address: string): string {
  return createHash("sha256").update(`${linkId}\u0000${address}`).digest("hex");
}

async function enforceCommentLimits(linkId: string, clientHash: string, now: Date): Promise<void> {
  const since = (ms: number) => new Date(now.getTime() - ms);
  const tooMany = new AuthError("You are commenting too quickly. Wait a moment and try again.", 429);
  const [burst, readerHour, linkHour, total] = await Promise.all([
    prisma.shareComment.count({
      where: { shareLinkId: linkId, clientHash, createdAt: { gt: since(COMMENT_LIMITS.burst.windowMs) } },
    }),
    prisma.shareComment.count({
      where: { shareLinkId: linkId, clientHash, createdAt: { gt: since(COMMENT_LIMITS.readerHourly.windowMs) } },
    }),
    prisma.shareComment.count({
      where: { shareLinkId: linkId, createdAt: { gt: since(COMMENT_LIMITS.linkHourly.windowMs) } },
    }),
    prisma.shareComment.count({ where: { shareLinkId: linkId } }),
  ]);
  if (total >= COMMENT_LIMITS.linkTotal) {
    throw new AuthError("This link is not taking more comments.", 429);
  }
  if (
    burst >= COMMENT_LIMITS.burst.max ||
    readerHour >= COMMENT_LIMITS.readerHourly.max ||
    linkHour >= COMMENT_LIMITS.linkHourly.max
  ) {
    throw tooMany;
  }
}

function field(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Save a reader's comment on a passage of a chapter `token` shares. The
 * chapter must be one the link shows and the block must hold prose in it now.
 */
export async function postReaderComment(
  token: unknown,
  input: Record<string, unknown>,
  client: { address: string },
  now: Date = new Date()
): Promise<ReaderCommentReceipt> {
  const link = await activeLink(token, now);

  const name = cleanLine(input.name, READER_NAME_MAX);
  if (!name) throw new AuthError("Add your name so the author knows who wrote this.", 400);
  const rawBody = field(input.body).trim();
  if (!rawBody) throw new AuthError("Write a comment first.", 400);
  if (rawBody.length > COMMENT_BODY_MAX) {
    throw new AuthError(`Comments can be up to ${COMMENT_BODY_MAX} characters.`, 400);
  }
  const quote = field(input.quote).slice(0, COMMENT_QUOTE_MAX);
  if (!quote.trim()) throw new AuthError("Select the passage you are commenting on.", 400);
  const offset = input.offset;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset > 1_000_000) {
    throw new AuthError("Invalid passage position.", 400);
  }

  const chapterId = field(input.chapterId);
  const blockId = field(input.blockId);
  const chapter = (await sharedChapters(link)).find((c) => c.id === chapterId);
  // Same answer for "not shared" and "does not exist": a reader learns only
  // what the link already shows them.
  if (!chapter) throw new AuthError("That chapter is not part of this link.", 404);
  if (!commentableBlockIds(chapter.content).has(blockId)) {
    throw new AuthError("That passage has changed since you opened the page. Reload and try again.", 409);
  }

  const clientHash = readerClientHash(link.id, client.address);
  await enforceCommentLimits(link.id, clientHash, now);

  const row = await prisma.shareComment.create({
    data: {
      shareLinkId: link.id,
      projectId: link.projectId,
      chapterId: chapter.id,
      readerName: name,
      body: rawBody,
      blockId,
      quote,
      offset,
      clientHash,
      createdAt: now,
    },
  });
  return {
    id: row.id,
    chapterId: row.chapterId,
    blockId: row.blockId,
    quote: row.quote,
    offset: row.offset,
    body: row.body,
    readerName: row.readerName,
    createdAt: row.createdAt.toISOString(),
  };
}

// --- Author side: reader comments ---

function isCommentStatus(value: unknown): value is ShareCommentStatus {
  return value === "open" || value === "resolved";
}

export async function listShareComments(
  projectId: string,
  user: PublicUser | null,
  filter: { chapterId?: string; status?: string } = {}
): Promise<ShareCommentView[]> {
  await authorizeOwnedProject(projectId, user);
  const rows = await prisma.shareComment.findMany({
    where: {
      projectId,
      ...(filter.chapterId ? { chapterId: filter.chapterId } : {}),
      ...(isCommentStatus(filter.status) ? { status: filter.status } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      shareLink: { select: { label: true } },
      chapter: { select: { title: true } },
    },
  });
  // Anchors are found in each chapter's current text, parsed once per chapter.
  const chapterIds = [...new Set(rows.map((row) => row.chapterId))];
  const locators = new Map(
    (
      await prisma.chapter.findMany({
        where: { id: { in: chapterIds } },
        select: { id: true, content: true },
      })
    ).map((c) => [c.id, commentAnchorLocator(stampBlockIds(c.content))])
  );
  return rows.map((row) => ({
    id: row.id,
    shareLinkId: row.shareLinkId,
    linkLabel: row.shareLink.label,
    chapterId: row.chapterId,
    chapterTitle: row.chapter.title,
    readerName: row.readerName,
    body: row.body,
    quote: row.quote,
    status: isCommentStatus(row.status) ? row.status : "open",
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    anchor: locators.get(row.chapterId)?.(row) ?? null,
  }));
}

async function ownedComment(commentId: string, user: PublicUser | null): Promise<ShareComment> {
  const comment = await prisma.shareComment.findUnique({ where: { id: commentId } });
  if (!comment) throw new AuthError("Not found.", 404);
  await authorizeOwnedProject(comment.projectId, user);
  return comment;
}

/** Resolve a comment, or reopen a resolved one. */
export async function setShareCommentStatus(
  commentId: string,
  user: PublicUser | null,
  status: unknown
): Promise<{ id: string; status: ShareCommentStatus; resolvedAt: string | null }> {
  if (!isCommentStatus(status)) throw new AuthError("status must be open or resolved.", 400);
  const comment = await ownedComment(commentId, user);
  const row = await prisma.shareComment.update({
    where: { id: comment.id },
    data: { status, resolvedAt: status === "resolved" ? new Date() : null },
  });
  return { id: row.id, status, resolvedAt: row.resolvedAt?.toISOString() ?? null };
}

export async function deleteShareComment(commentId: string, user: PublicUser | null): Promise<{ ok: true }> {
  const comment = await ownedComment(commentId, user);
  await prisma.shareComment.delete({ where: { id: comment.id } });
  return { ok: true };
}
