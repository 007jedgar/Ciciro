import { API_URL } from "./api/client";
import type { ShareComment, ShareLinkSummary } from "./api/types";

// Beta readers on the phone: pure helpers the screens render from. Mirrors
// src/lib/share-view.ts on the web. Readers open links in a browser; the phone
// is where the author makes links and reads what came back.

/** Longest name an author can give a link. */
export const SHARE_LABEL_MAX = 80;
/** Expiry choices, in days. `null` never expires. */
export const SHARE_EXPIRY_PRESETS = [7, 30, 90, null] as const;
export type ShareExpiryPreset = (typeof SHARE_EXPIRY_PRESETS)[number];

/** The link to hand a reader: the reader page on this app's Ciciro server. */
export function shareLinkUrl(link: Pick<ShareLinkSummary, "path">, base: string = API_URL): string {
  return `${base.replace(/\/$/, "")}${link.path}`;
}

export function betaReadersHref(projectId: string, chapterId?: string): string {
  const base = `/project/${projectId}/beta-readers`;
  return chapterId ? `${base}?chapterId=${encodeURIComponent(chapterId)}` : base;
}

export function shareLinksHref(projectId: string): string {
  return `/project/${projectId}/share-links`;
}

export type CommentGroup = {
  chapterId: string;
  /** 1-based position among the manuscript's chapters; 0 when it is not one of them. */
  number: number;
  title: string;
  comments: ShareComment[];
};

/** Comments grouped by chapter, in manuscript order, newest first within each. */
export function groupCommentsByChapter(
  comments: ShareComment[],
  chapters: { id: string; title: string }[]
): CommentGroup[] {
  const order = new Map(chapters.map((c, i) => [c.id, i]));
  const groups = new Map<string, CommentGroup>();
  for (const comment of comments) {
    let group = groups.get(comment.chapterId);
    if (!group) {
      const index = order.get(comment.chapterId);
      group = {
        chapterId: comment.chapterId,
        number: index === undefined ? 0 : index + 1,
        title: index === undefined ? comment.chapterTitle : chapters[index].title,
        comments: [],
      };
      groups.set(comment.chapterId, group);
    }
    group.comments.push(comment);
  }
  return [...groups.values()].sort(
    (a, b) => (a.number || Number.MAX_SAFE_INTEGER) - (b.number || Number.MAX_SAFE_INTEGER)
  );
}

/** How many comments each chapter has. */
export function commentCountsByChapter(comments: ShareComment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of comments) counts.set(c.chapterId, (counts.get(c.chapterId) ?? 0) + 1);
  return counts;
}
