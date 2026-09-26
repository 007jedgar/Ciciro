"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BrandMark from "@/components/BrandMark";
import {
  COMMENT_BODY_MAX,
  COMMENT_QUOTE_MAX,
  READER_NAME_MAX,
  type ReaderCommentReceipt,
  type SharedManuscript,
} from "@/lib/share-view";

type Passage = {
  chapterId: string;
  blockId: string;
  offset: number;
  quote: string;
  /** Viewport position of the selection's last line, for the Comment button. */
  x: number;
  y: number;
};

const NAME_KEY = "ciciro-reader-name";
const commentsKey = (token: string) => `ciciro-reader-comments:${token}`;

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows can refuse storage; the comment itself is already sent.
  }
}

/**
 * Visible text as the server counts it: text as-is, a line break as one
 * character, and nothing between paragraphs of a quote or list item.
 */
function visibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeName === "BR") return "\n";
  let out = "";
  node.childNodes.forEach((child) => {
    out += visibleText(child);
  });
  return out;
}

/** The manuscript block holding `node`: its outermost ancestor with a block id. */
function blockOf(node: Node, chapterEl: Element): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (let el = node instanceof Element ? node : node.parentElement; el && el !== chapterEl; el = el.parentElement) {
    if (el.hasAttribute("data-block-id")) found = el as HTMLElement;
  }
  return found;
}

/** The selected passage, cut to the paragraph it starts in, or null. */
function passageFromSelection(root: HTMLElement): Passage | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const chapterEl = (
    range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  )?.closest("[data-chapter-id]");
  if (!chapterEl || !root.contains(chapterEl)) return null;
  const block = blockOf(range.startContainer, chapterEl);
  if (!block) return null;

  const clipped = range.cloneRange();
  if (!block.contains(range.endContainer)) clipped.setEnd(block, block.childNodes.length);
  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(clipped.startContainer, clipped.startOffset);

  const quote = visibleText(clipped.cloneContents()).replace(/ /g, " ").slice(0, COMMENT_QUOTE_MAX);
  if (!quote.trim()) return null;
  const rects = clipped.getClientRects();
  const last = rects[rects.length - 1] ?? clipped.getBoundingClientRect();
  return {
    chapterId: chapterEl.getAttribute("data-chapter-id") ?? "",
    blockId: block.getAttribute("data-block-id") ?? "",
    offset: visibleText(before.cloneContents()).length,
    quote,
    x: last.left + last.width / 2,
    y: last.bottom,
  };
}

function formatExpiry(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

export default function ReaderView({ token, manuscript }: { token: string; manuscript: SharedManuscript }) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Passage | null>(null);
  const [draft, setDraft] = useState<Passage | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mine, setMine] = useState<ReaderCommentReceipt[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const chapter = manuscript.chapters[index] ?? null;
  const count = manuscript.chapters.length;

  useEffect(() => {
    setName(readStored(NAME_KEY, ""));
    setMine(readStored<ReaderCommentReceipt[]>(commentsKey(token), []));
  }, [token]);

  useEffect(() => {
    function onSelection() {
      const root = rootRef.current;
      setSelected(root ? passageFromSelection(root) : null);
    }
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const goTo = useCallback((next: number) => {
    setIndex(next);
    setSelected(null);
    window.scrollTo({ top: 0 });
  }, []);

  function startComment() {
    if (!selected) return;
    setDraft(selected);
    setError(null);
    window.getSelection()?.removeAllRanges();
    setSelected(null);
    requestAnimationFrame(() => bodyRef.current?.focus());
  }

  async function send() {
    if (!draft || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/read/${encodeURIComponent(token)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chapterId: draft.chapterId,
          blockId: draft.blockId,
          offset: draft.offset,
          quote: draft.quote,
          body,
          name,
        }),
      });
      const data = (await res.json().catch(() => null)) as (ReaderCommentReceipt & { error?: string }) | null;
      if (!res.ok || !data) {
        setError(data?.error || "Could not send your comment. Try again.");
        return;
      }
      const next = [...mine, data];
      setMine(next);
      writeStored(commentsKey(token), next);
      writeStored(NAME_KEY, name.trim());
      setDraft(null);
      setBody("");
      setNotice("Sent. The author will see it next to this passage.");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  const mineHere = useMemo(
    () => (chapter ? mine.filter((c) => c.chapterId === chapter.id) : []),
    [chapter, mine]
  );

  const heading = (c: { number: number; title: string }) =>
    c.title.trim() ? c.title : `Chapter ${c.number}`;

  return (
    <div className="reader" ref={rootRef}>
      <header className="reader-head">
        <BrandMark size={28} />
        <div className="reader-head-text">
          <div className="reader-book">{manuscript.title}</div>
          <div className="reader-byline">
            {manuscript.author ? `by ${manuscript.author} · ` : ""}Shared for beta reading
            {manuscript.expiresAt ? ` until ${formatExpiry(manuscript.expiresAt)}` : ""}
          </div>
        </div>
        {count > 1 ? (
          <select
            className="reader-toc"
            aria-label="Chapter"
            value={index}
            onChange={(e) => goTo(Number(e.target.value))}
          >
            {manuscript.chapters.map((c, i) => (
              <option key={c.id} value={i}>
                {heading(c)}
              </option>
            ))}
          </select>
        ) : null}
      </header>

      <p className="reader-hint">Select any passage to leave the author a comment.</p>

      {chapter ? (
        <article className="reader-chapter" data-chapter-id={chapter.id}>
          <h1 className="reader-chapter-title">{heading(chapter)}</h1>
          <div className="reader-prose" dangerouslySetInnerHTML={{ __html: chapter.html }} />
        </article>
      ) : (
        <div className="empty">There is nothing to read here yet.</div>
      )}

      {mineHere.length > 0 ? (
        <section className="reader-mine" aria-label="Your comments on this chapter">
          <h2>Your comments on this chapter</h2>
          {mineHere.map((c) => (
            <div className="reader-mine-item" key={c.id}>
              <blockquote>{c.quote}</blockquote>
              <p>{c.body}</p>
            </div>
          ))}
        </section>
      ) : null}

      {count > 1 ? (
        <nav className="reader-pager" aria-label="Chapters">
          <button className="btn" disabled={index === 0} onClick={() => goTo(index - 1)}>
            &larr; Previous
          </button>
          <span>
            {index + 1} of {count}
          </span>
          <button className="btn" disabled={index >= count - 1} onClick={() => goTo(index + 1)}>
            Next &rarr;
          </button>
        </nav>
      ) : null}

      {selected && !draft ? (
        <button
          className="btn primary reader-comment-cta"
          style={{ left: selected.x, top: selected.y + 10 }}
          // Keep the selection: a mousedown on the button would collapse it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={startComment}
        >
          Comment
        </button>
      ) : null}

      {draft ? (
        <div className="reader-composer" role="dialog" aria-label="Comment on this passage">
          <blockquote className="reader-composer-quote">{draft.quote}</blockquote>
          <input
            aria-label="Your name"
            placeholder="Your name"
            value={name}
            maxLength={READER_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            ref={bodyRef}
            aria-label="Comment"
            placeholder="What did you think?"
            rows={4}
            value={body}
            maxLength={COMMENT_BODY_MAX}
            onChange={(e) => setBody(e.target.value)}
          />
          {error ? (
            <div className="reader-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="reader-composer-actions">
            <span className="reader-count">
              {body.length}/{COMMENT_BODY_MAX}
            </span>
            <button className="btn ghost" onClick={() => setDraft(null)} disabled={sending}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={() => void send()}
              disabled={sending || !name.trim() || !body.trim()}
            >
              {sending ? "Sending..." : "Send to author"}
            </button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="reader-notice" role="status">
          {notice}
        </div>
      ) : null}
    </div>
  );
}
