import type {
  ShareCommentStatus,
  ShareCommentView,
  ShareLinkCreateRequest,
  ShareLinkSummary,
} from "@/lib/share-view";

// The author's side of beta reader sharing, as the browser calls it.

async function failure(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return new Error(body?.error || fallback);
}

async function send<T>(url: string, method: string, body: unknown, fallback: string): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res, fallback);
  return (await res.json()) as T;
}

export async function fetchShareLinks(projectId: string): Promise<ShareLinkSummary[]> {
  const res = await fetch(`/api/projects/${projectId}/shares`, { cache: "no-store" });
  if (!res.ok) throw await failure(res, "Could not load your links.");
  return ((await res.json()) as { links: ShareLinkSummary[] }).links;
}

export function createShareLink(projectId: string, body: ShareLinkCreateRequest): Promise<ShareLinkSummary> {
  return send(`/api/projects/${projectId}/shares`, "POST", body, "Could not make the link.");
}

export function revokeShareLink(linkId: string): Promise<ShareLinkSummary> {
  return send(`/api/shares/${linkId}`, "PATCH", { revoke: true }, "Could not turn off the link.");
}

export function deleteShareLink(linkId: string): Promise<{ ok: true }> {
  return send(`/api/shares/${linkId}`, "DELETE", undefined, "Could not delete the link.");
}

export async function fetchShareComments(
  projectId: string,
  status?: ShareCommentStatus
): Promise<ShareCommentView[]> {
  const query = status ? `?status=${status}` : "";
  const res = await fetch(`/api/projects/${projectId}/share-comments${query}`, { cache: "no-store" });
  if (!res.ok) throw await failure(res, "Could not load reader comments.");
  return ((await res.json()) as { comments: ShareCommentView[] }).comments;
}

export function setShareCommentStatus(
  commentId: string,
  status: ShareCommentStatus
): Promise<{ id: string; status: ShareCommentStatus; resolvedAt: string | null }> {
  return send(`/api/share-comments/${commentId}`, "PATCH", { status }, "Could not update the comment.");
}

export function deleteShareComment(commentId: string): Promise<{ ok: true }> {
  return send(`/api/share-comments/${commentId}`, "DELETE", undefined, "Could not delete the comment.");
}

/** The full link to hand a reader, on whatever origin the author is using. */
export function shareUrl(link: Pick<ShareLinkSummary, "path">, origin = window.location.origin): string {
  return `${origin}${link.path}`;
}
