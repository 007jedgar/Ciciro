"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createShareLink,
  deleteShareComment,
  deleteShareLink,
  fetchShareComments,
  fetchShareLinks,
  revokeShareLink,
  setShareCommentStatus,
  shareUrl,
} from "@/lib/share-client";
import {
  SHARE_EXPIRY_PRESETS,
  SHARE_LABEL_MAX,
  type ShareCommentStatus,
  type ShareCommentView,
  type ShareLinkSummary,
} from "@/lib/share-view";

export type BetaReadersTab = "comments" | "links";

type ChapterRef = { id: string; title: string };

type Props = {
  projectId: string;
  /** Live chapters in manuscript order. */
  chapters: ChapterRef[];
  activeChapterId: string | null;
  tab: BetaReadersTab;
  onTabChange: (tab: BetaReadersTab) => void;
  /** Scroll to and flash this comment (a marked passage was clicked). */
  focusCommentId: string | null;
  onJump: (comment: ShareCommentView) => void;
  /** Something changed that the editor's marks and the topbar count show. */
  onCommentsChanged: () => void;
  onClose: () => void;
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function expiryLabel(days: number | null): string {
  return days === null ? "Never" : `In ${days} days`;
}

// Beta readers: the links the author has handed out, and what readers said.
export default function BetaReaders({
  projectId,
  chapters,
  activeChapterId,
  tab,
  onTabChange,
  focusCommentId,
  onJump,
  onCommentsChanged,
  onClose,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Claim the key so focus mode, which listens on window, does not also exit.
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chapterName = useCallback(
    (id: string, fallback = "") => {
      const index = chapters.findIndex((c) => c.id === id);
      if (index < 0) return fallback || "Archived chapter";
      return chapters[index].title.trim() || `Chapter ${index + 1}`;
    },
    [chapters]
  );

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer beta-readers" role="dialog" aria-label="Beta readers">
        <div className="beta-head">
          <h2>Beta readers</h2>
          <button className="btn ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="beta-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "comments"}
            className={`btn small ${tab === "comments" ? "primary" : "ghost"}`}
            onClick={() => onTabChange("comments")}
          >
            Comments
          </button>
          <button
            role="tab"
            aria-selected={tab === "links"}
            className={`btn small ${tab === "links" ? "primary" : "ghost"}`}
            onClick={() => onTabChange("links")}
          >
            Share links
          </button>
        </div>
        {tab === "comments" ? (
          <CommentsTab
            projectId={projectId}
            activeChapterId={activeChapterId}
            chapterName={chapterName}
            focusCommentId={focusCommentId}
            onJump={onJump}
            onChanged={onCommentsChanged}
            onShare={() => onTabChange("links")}
          />
        ) : (
          <LinksTab projectId={projectId} chapters={chapters} chapterName={chapterName} />
        )}
      </div>
    </>
  );
}

function CommentsTab({
  projectId,
  activeChapterId,
  chapterName,
  focusCommentId,
  onJump,
  onChanged,
  onShare,
}: {
  projectId: string;
  activeChapterId: string | null;
  chapterName: (id: string, fallback?: string) => string;
  focusCommentId: string | null;
  onJump: (comment: ShareCommentView) => void;
  onChanged: () => void;
  onShare: () => void;
}) {
  const [status, setStatus] = useState<ShareCommentStatus>("open");
  const [onlyThisChapter, setOnlyThisChapter] = useState(Boolean(focusCommentId));
  const [comments, setComments] = useState<ShareCommentView[] | null>(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setComments(await fetchShareComments(projectId, status));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [projectId, status]);

  useEffect(() => {
    setComments(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (!focusCommentId || !comments) return;
    listRef.current
      ?.querySelector(`[data-comment-id="${CSS.escape(focusCommentId)}"]`)
      ?.scrollIntoView({ block: "center" });
  }, [focusCommentId, comments]);

  async function act(comment: ShareCommentView, run: () => Promise<unknown>) {
    setBusyId(comment.id);
    try {
      await run();
      setComments((list) => list?.filter((c) => c.id !== comment.id) ?? null);
      setError("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  const shown = (comments ?? []).filter((c) => !onlyThisChapter || c.chapterId === activeChapterId);
  const groups: { chapterId: string; title: string; comments: ShareCommentView[] }[] = [];
  for (const c of shown) {
    let group = groups.find((g) => g.chapterId === c.chapterId);
    if (!group) {
      group = { chapterId: c.chapterId, title: chapterName(c.chapterId, c.chapterTitle), comments: [] };
      groups.push(group);
    }
    group.comments.push(c);
  }

  return (
    <div className="beta-comments">
      <div className="beta-filters">
        <div className="view-toggle">
          <button
            className={`btn small ${status === "open" ? "primary" : "ghost"}`}
            onClick={() => setStatus("open")}
          >
            Open
          </button>
          <button
            className={`btn small ${status === "resolved" ? "primary" : "ghost"}`}
            onClick={() => setStatus("resolved")}
          >
            Resolved
          </button>
        </div>
        <label className="beta-check">
          <input
            type="checkbox"
            checked={onlyThisChapter}
            disabled={!activeChapterId}
            onChange={(e) => setOnlyThisChapter(e.target.checked)}
          />
          This chapter only
        </label>
      </div>
      {error ? (
        <div className="beta-error" role="alert">
          {error}
        </div>
      ) : null}
      {comments === null && !error ? <div className="empty">Loading...</div> : null}
      {comments !== null && shown.length === 0 ? (
        <div className="empty">
          {status === "open" ? (
            <>
              No open comments{onlyThisChapter ? " on this chapter" : ""}.{" "}
              <button className="btn ghost small" onClick={onShare}>
                Share a link
              </button>
            </>
          ) : (
            "Nothing resolved yet."
          )}
        </div>
      ) : null}
      <div ref={listRef}>
        {groups.map((group) => (
          <section key={group.chapterId} className="beta-group">
            {!onlyThisChapter ? <h3 className="beta-group-title">{group.title}</h3> : null}
            {group.comments.map((c) => (
              <article
                key={c.id}
                data-comment-id={c.id}
                className={`beta-comment${c.id === focusCommentId ? " focused" : ""}`}
              >
                <blockquote className="beta-quote">{c.quote}</blockquote>
                <p className="beta-body">{c.body}</p>
                <div className="beta-meta">
                  <strong>{c.readerName}</strong>
                  {c.linkLabel ? <span> · {c.linkLabel}</span> : null}
                  <span> · {shortDate(c.createdAt)}</span>
                </div>
                <div className="beta-actions">
                  {c.anchor ? (
                    <button className="btn ghost small" onClick={() => onJump(c)}>
                      {c.anchor.length > 0 ? "Show in text" : "Show paragraph"}
                    </button>
                  ) : (
                    <span className="beta-gone">Passage no longer in the chapter</span>
                  )}
                  <span className="spacer" />
                  <button
                    className="btn small"
                    disabled={busyId === c.id}
                    onClick={() =>
                      void act(c, () => setShareCommentStatus(c.id, status === "open" ? "resolved" : "open"))
                    }
                  >
                    {status === "open" ? "Resolve" : "Reopen"}
                  </button>
                  <button
                    className="btn ghost small"
                    disabled={busyId === c.id}
                    onClick={() => {
                      if (window.confirm("Delete this comment? It can't be brought back.")) {
                        void act(c, () => deleteShareComment(c.id));
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function LinksTab({
  projectId,
  chapters,
  chapterName,
}: {
  projectId: string;
  chapters: ChapterRef[];
  chapterName: (id: string) => string;
}) {
  const [links, setLinks] = useState<ShareLinkSummary[] | null>(null);
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<"all" | "some">("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expiry, setExpiry] = useState<number | null>(30);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchShareLinks(projectId)
      .then((list) => !cancelled && setLinks(list))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!copiedId) return;
    const timer = setTimeout(() => setCopiedId(null), 2000);
    return () => clearTimeout(timer);
  }, [copiedId]);

  async function copy(link: ShareLinkSummary) {
    try {
      await navigator.clipboard.writeText(shareUrl(link));
      setCopiedId(link.id);
    } catch {
      setError("Couldn't copy. Select the link and copy it yourself.");
    }
  }

  async function create() {
    if (creating) return;
    if (scope === "some" && picked.size === 0) {
      setError("Pick at least one chapter to share.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const link = await createShareLink(projectId, {
        label,
        chapterIds: scope === "some" ? chapters.filter((c) => picked.has(c.id)).map((c) => c.id) : [],
        expiresInDays: expiry,
      });
      setLinks((list) => [link, ...(list ?? [])]);
      setLabel("");
      setPicked(new Set());
      setScope("all");
      void copy(link);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function revoke(link: ShareLinkSummary) {
    if (!window.confirm("Turn off this link? Anyone who has it will no longer be able to read. Their comments stay.")) {
      return;
    }
    setBusyId(link.id);
    try {
      const next = await revokeShareLink(link.id);
      setLinks((list) => list?.map((l) => (l.id === link.id ? next : l)) ?? null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(link: ShareLinkSummary) {
    const comments = link.commentCount
      ? ` and its ${link.commentCount} ${link.commentCount === 1 ? "comment" : "comments"}`
      : "";
    if (!window.confirm(`Delete this link${comments}? This can't be undone.`)) return;
    setBusyId(link.id);
    try {
      await deleteShareLink(link.id);
      setLinks((list) => list?.filter((l) => l.id !== link.id) ?? null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="beta-links">
      <p className="beta-intro">
        A link opens a read-only copy of what you share. Readers add their name and comment on passages; they see
        nothing else of yours, and you can turn a link off at any time.
      </p>
      <div className="beta-create">
        <div className="field">
          <label htmlFor="beta-label">Who is it for?</label>
          <input
            id="beta-label"
            placeholder="e.g. Writing group"
            value={label}
            maxLength={SHARE_LABEL_MAX}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="field">
          <label>What to share</label>
          <div className="beta-scope">
            <label className="beta-check">
              <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />
              Whole manuscript
            </label>
            <label className="beta-check">
              <input type="radio" checked={scope === "some"} onChange={() => setScope("some")} />
              Chosen chapters
            </label>
          </div>
          {scope === "some" ? (
            <div className="beta-chapter-picks">
              {chapters.map((c) => (
                <label key={c.id} className="beta-check">
                  <input
                    type="checkbox"
                    checked={picked.has(c.id)}
                    onChange={(e) =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      })
                    }
                  />
                  {chapterName(c.id)}
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="beta-expiry">Link stops working</label>
          <select
            id="beta-expiry"
            value={expiry === null ? "never" : String(expiry)}
            onChange={(e) => setExpiry(e.target.value === "never" ? null : Number(e.target.value))}
          >
            {SHARE_EXPIRY_PRESETS.map((days) => (
              <option key={days ?? "never"} value={days === null ? "never" : String(days)}>
                {expiryLabel(days)}
              </option>
            ))}
          </select>
        </div>
        <button className="btn primary" disabled={creating} onClick={() => void create()}>
          {creating ? "Making link..." : "Make link and copy"}
        </button>
      </div>

      {error ? (
        <div className="beta-error" role="alert">
          {error}
        </div>
      ) : null}

      <hr className="hr" />
      {links === null && !error ? <div className="empty">Loading...</div> : null}
      {links !== null && links.length === 0 ? <div className="empty">No links yet.</div> : null}
      {(links ?? []).map((link) => (
        <article key={link.id} className={`beta-link ${link.status}`}>
          <div className="beta-link-head">
            <strong>{link.label || "Untitled link"}</strong>
            <span className={`pill ${link.status === "active" ? "resolved" : ""}`}>
              {link.status === "active" ? "Active" : link.status === "expired" ? "Expired" : "Turned off"}
            </span>
          </div>
          <div className="beta-meta">
            {link.chapterIds.length === 0
              ? "Whole manuscript"
              : `${link.chapterIds.length} ${link.chapterIds.length === 1 ? "chapter" : "chapters"}`}
            {" · "}
            {link.status === "revoked"
              ? `Turned off ${shortDate(link.revokedAt!)}`
              : link.expiresAt
                ? `${link.status === "expired" ? "Expired" : "Expires"} ${shortDate(link.expiresAt)}`
                : "Never expires"}
            {" · "}
            {link.commentCount} {link.commentCount === 1 ? "comment" : "comments"}
            {link.openCommentCount ? ` (${link.openCommentCount} open)` : ""}
          </div>
          {link.status === "active" ? (
            <input
              className="beta-url"
              readOnly
              value={shareUrl(link)}
              aria-label="Share link"
              onFocus={(e) => e.currentTarget.select()}
            />
          ) : null}
          <div className="beta-actions">
            {link.status === "active" ? (
              <>
                <button className="btn small" onClick={() => void copy(link)}>
                  {copiedId === link.id ? "Copied" : "Copy link"}
                </button>
                <a className="btn ghost small" href={link.path} target="_blank" rel="noreferrer">
                  Preview
                </a>
              </>
            ) : null}
            <span className="spacer" />
            {link.status === "active" ? (
              <button className="btn ghost small" disabled={busyId === link.id} onClick={() => void revoke(link)}>
                Turn off
              </button>
            ) : null}
            <button className="btn ghost small" disabled={busyId === link.id} onClick={() => void remove(link)}>
              Delete
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
