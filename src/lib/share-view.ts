// Beta reader sharing, the parts the server, the reader page and the author's
// panels all need. No database access here, so client components can import it.

/** Longest name an author can give a share link. */
export const SHARE_LABEL_MAX = 80;
/** Longest name a reader can sign a comment with. */
export const READER_NAME_MAX = 60;
/** Longest comment a reader can leave. */
export const COMMENT_BODY_MAX = 2000;
/** Longest passage a comment can quote. Longer selections are cut to this. */
export const COMMENT_QUOTE_MAX = 500;
/** Longest expiry an author can set. */
export const SHARE_EXPIRY_MAX_DAYS = 365;
/** Largest reader comment request the server will read, in bytes. */
export const COMMENT_REQUEST_MAX_BYTES = 16 * 1024;

/**
 * Comment rate limits. A reader (one IP on one link) gets a short burst and an
 * hourly budget; the link as a whole gets an hourly budget, so rotating
 * addresses cannot flood the author; and a link stops taking comments at a
 * lifetime cap.
 */
export const COMMENT_LIMITS = {
  burst: { max: 5, windowMs: 60 * 1000 },
  readerHourly: { max: 30, windowMs: 60 * 60 * 1000 },
  linkHourly: { max: 200, windowMs: 60 * 60 * 1000 },
  linkTotal: 2000,
} as const;

/** Expiry choices offered when creating a link, in days. `null` never expires. */
export const SHARE_EXPIRY_PRESETS = [7, 30, 90, null] as const;

export type ShareLinkStatus = "active" | "expired" | "revoked";

/** One share link as the author sees it. */
export type ShareLinkSummary = {
  id: string;
  projectId: string;
  label: string;
  /** Path of the reader page; prefix the app's origin to get the link. */
  path: string;
  token: string;
  /** Empty means the whole manuscript. */
  chapterIds: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  status: ShareLinkStatus;
  commentCount: number;
  openCommentCount: number;
  createdAt: string;
};

export type ShareLinkCreateRequest = {
  label?: string;
  /** Omit or leave empty to share the whole manuscript. */
  chapterIds?: string[];
  /** Days until the link stops working. Omit or null for never. */
  expiresInDays?: number | null;
};

export type ShareLinkPatchRequest = {
  label?: string;
  /** Revoking is permanent. */
  revoke?: true;
};

export type ShareCommentStatus = "open" | "resolved";

/** Where a comment's passage is in the chapter's current text. */
export type CommentAnchor = {
  blockId: string;
  offset: number;
  /** 0 when the quoted text is gone and only its paragraph is left. */
  length: number;
};

/** A reader comment as the author sees it. */
export type ShareCommentView = {
  id: string;
  shareLinkId: string;
  linkLabel: string;
  chapterId: string;
  chapterTitle: string;
  readerName: string;
  body: string;
  quote: string;
  status: ShareCommentStatus;
  createdAt: string;
  resolvedAt: string | null;
  /** Null when neither the passage nor its paragraph is in the chapter now. */
  anchor: CommentAnchor | null;
};

export type ShareCommentListResponse = { comments: ShareCommentView[] };

/** What a reader sends to comment on a passage. */
export type ReaderCommentRequest = {
  chapterId: string;
  blockId: string;
  quote: string;
  offset: number;
  body: string;
  name: string;
};

/** A reader's own comment, echoed back after it is saved. */
export type ReaderCommentReceipt = {
  id: string;
  chapterId: string;
  blockId: string;
  quote: string;
  offset: number;
  body: string;
  readerName: string;
  createdAt: string;
};

/** A shared chapter as the reader page renders it. `html` is sanitized. */
export type SharedChapter = {
  id: string;
  title: string;
  number: number;
  html: string;
};

export type SharedManuscript = {
  title: string;
  author: string;
  expiresAt: string | null;
  chapters: SharedChapter[];
};

export function sharePath(token: string): string {
  return `/read/${token}`;
}

/** Tokens are 32 random bytes in base64url. Anything else is not worth a lookup. */
export function isShareTokenShape(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function shareLinkStatus(
  link: { expiresAt: Date | string | null; revokedAt: Date | string | null },
  now: Date = new Date()
): ShareLinkStatus {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}

/** Collapse whitespace and bound a single-line field. Non-strings become "". */
export function cleanLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * The occurrence of `quote` in `text` whose start is closest to `offset`, the
 * place the reader saw it. -1 when the text no longer contains it.
 */
export function nearestOccurrence(text: string, quote: string, offset: number): number {
  if (!quote) return -1;
  // A non-breaking space reads as a space (browsers and the editor disagree
  // about which one a stored &nbsp; is). One code unit for one: offsets hold.
  const haystack = text.replace(/\u00a0/g, " ");
  const needle = quote.replace(/\u00a0/g, " ");
  let best = -1;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    if (best < 0 || Math.abs(at - offset) < Math.abs(best - offset)) best = at;
    if (at > offset) break;
  }
  return best;
}
