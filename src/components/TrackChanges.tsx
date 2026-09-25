"use client";

import { useEffect, useState } from "react";
import type { SuggestionAuthor, SuggestionSummary } from "@/lib/suggestions";

// Review chrome for tracked changes: the bar above the prose (mode switch,
// count, previous/next, accept or reject everything) and the card that opens
// on the change under the caret.

export type SuggestionDetail = SuggestionAuthor & {
  id: string;
  createdAt: string;
  inserted: string;
  deleted: string;
};

export function relativeTime(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const min = Math.round((now - at) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function clip(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Who the author is when they suggest: their account, else the byline. */
export function useSuggestionAuthor(byline: string): SuggestionAuthor {
  const fallbackName = byline.trim() || "Author";
  const [author, setAuthor] = useState<SuggestionAuthor>({ authorId: "author", authorName: fallbackName });
  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: { id: string; name?: string; email?: string } | null } | null) => {
        const user = d?.user;
        if (!active || !user) return;
        const name = user.name?.trim() || user.email?.split("@")[0] || fallbackName;
        setAuthor({ authorId: user.id, authorName: name });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [fallbackName]);
  return author;
}

export function SuggestModeToggle({
  suggesting,
  onChange,
}: {
  suggesting: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={suggesting}
      className={`btn small suggest-toggle${suggesting ? " on" : " ghost"}`}
      onClick={() => onChange(!suggesting)}
      title={
        suggesting
          ? "Suggesting: your edits are tracked for review. Click to edit directly."
          : "Editing directly. Click to track your edits as suggestions."
      }
    >
      <span className="suggest-dot" aria-hidden="true" />
      {suggesting ? "Suggesting" : "Suggest"}
    </button>
  );
}

export function SuggestionBar({
  suggestions,
  activeId,
  onReveal,
  onAcceptAll,
  onRejectAll,
}: {
  suggestions: SuggestionSummary[];
  activeId: string | null;
  onReveal: (id: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}) {
  const count = suggestions.length;
  if (count === 0) return null;
  const index = activeId ? suggestions.findIndex((s) => s.id === activeId) : -1;
  const step = (delta: number) => {
    const from = index < 0 ? (delta > 0 ? -1 : 0) : index;
    const next = (from + delta + count) % count;
    onReveal(suggestions[next].id);
  };
  const authors = [...new Set(suggestions.map((s) => s.authorName || "Someone"))];
  return (
    <div className="suggestion-bar" role="region" aria-label="Suggestions">
      <span className="suggestion-bar-count">
        {index >= 0 ? `${index + 1} of ${count}` : `${count} ${count === 1 ? "suggestion" : "suggestions"}`}
        <span className="suggestion-bar-who"> from {authors.join(", ")}</span>
      </span>
      <button type="button" className="btn ghost small" aria-label="Previous suggestion" onClick={() => step(-1)}>
        &#8249;
      </button>
      <button type="button" className="btn ghost small" aria-label="Next suggestion" onClick={() => step(1)}>
        &#8250;
      </button>
      <span className="spacer" />
      <button type="button" className="btn ghost small" onClick={onRejectAll}>
        Reject all
      </button>
      <button type="button" className="btn small primary" onClick={onAcceptAll}>
        Accept all
      </button>
    </div>
  );
}

function describe(detail: SuggestionDetail) {
  const deleted = clip(detail.deleted);
  const inserted = clip(detail.inserted);
  if (deleted && inserted) {
    return (
      <>
        Replace <del className="suggestion-quote">{deleted}</del> with{" "}
        <ins className="suggestion-quote">{inserted}</ins>
      </>
    );
  }
  if (inserted) {
    return (
      <>
        Add <ins className="suggestion-quote">{inserted}</ins>
      </>
    );
  }
  return (
    <>
      Delete <del className="suggestion-quote">{deleted}</del>
    </>
  );
}

export function SuggestionCard({
  detail,
  top,
  left,
  onAccept,
  onReject,
}: {
  detail: SuggestionDetail;
  top: number;
  left: number;
  onAccept: () => void;
  onReject: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div
      className="suggestion-card"
      style={{ top, left }}
      role="dialog"
      aria-label={`Suggestion from ${detail.authorName || "someone"}`}
      // Keep the caret where it is while the author clicks a button.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="suggestion-card-head">
        <span className="suggestion-card-who">{detail.authorName || "Someone"}</span>
        <span className="suggestion-card-when">{relativeTime(detail.createdAt, now)}</span>
      </div>
      <div className="suggestion-card-body">{describe(detail)}</div>
      <div className="suggestion-card-actions">
        <button type="button" className="btn small" onClick={onReject}>
          Reject
        </button>
        <button type="button" className="btn small primary" onClick={onAccept}>
          Accept
        </button>
      </div>
    </div>
  );
}
