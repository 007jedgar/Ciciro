"use client";

import { useCallback, useEffect, useState } from "react";
import { writingDayKey } from "@/lib/writing-day";
import {
  formatActiveTime,
  formatWeekRange,
  reviewDue,
  type WeeklyReview as Review,
} from "@/lib/weekly-review-view";

type Props = { projectId: string };

function ReviewBody({ review }: { review: Review }) {
  const { stats, content } = review;
  const max = Math.max(1, ...stats.days.map((d) => d.words));
  const active = formatActiveTime(stats.activeMs);
  return (
    <div className="weekly-review">
      <p className="weekly-scope">Across all your writing this week</p>
      <div className="weekly-stats">
        <div>
          <strong>{stats.words.toLocaleString()}</strong> words
        </div>
        <div>
          <strong>{stats.daysWritten}</strong> of {stats.days.length || 7} days
        </div>
        {active && (
          <div>
            <strong>{active}</strong> typing
          </div>
        )}
      </div>
      <div className="weekly-bars" role="img" aria-label="Words written each day, across all your writing">
        {stats.days.map((d) => (
          <span
            key={d.date}
            className="weekly-bar"
            title={`${d.date}: ${d.words} words`}
            style={{ height: `${Math.max(4, Math.round((d.words / max) * 100))}%` }}
            data-empty={d.words === 0}
          />
        ))}
      </div>
      <p className="weekly-summary">{content.summary}</p>
      <h3>Chapters touched</h3>
      {stats.chaptersTouched.length === 0 ? (
        <p className="scratch-hint">None this week.</p>
      ) : (
        <ul>
          {stats.chaptersTouched.map((c) => (
            <li key={c.id}>
              {c.title} <span className="scratch-hint">({c.wordCount.toLocaleString()} words)</span>
            </li>
          ))}
        </ul>
      )}
      <h3>Loose ends</h3>
      {content.looseEnds.length === 0 ? (
        <p className="scratch-hint">Nothing dangling. Nicely tied up.</p>
      ) : (
        <ul>
          {content.looseEnds.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}
      <h3>What to write next</h3>
      <ul>
        {content.nextSteps.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

// The weekly review: how the week went, what is still dangling in the story and
// what to write next. The button carries a dot once a new review is due; opening
// the panel shows the newest review and the past ones to reread.
export default function WeeklyReview({ projectId }: Props) {
  const base = `/api/projects/${projectId}/weekly-reviews`;
  const [open, setOpen] = useState(false);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [due, setDue] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setReviews(data.reviews as Review[]);
      setDue(Boolean(data.due));
    } catch {
      // The dot is a convenience; the panel retries when opened.
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: writingDayKey(), tzOffset: new Date().getTimezoneOffset() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't write the review.");
      const review = data as Review;
      setReviews((prev) => [review, ...(prev ?? [])]);
      setSelectedId(review.id);
      setDue(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't write the review.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(review: Review) {
    if (!window.confirm("Delete this review?")) return;
    try {
      const res = await fetch(`${base}/${review.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't delete the review.");
      const next = (reviews ?? []).filter((r) => r.id !== review.id);
      setReviews(next);
      setDue(reviewDue(next));
      setSelectedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the review.");
    }
  }

  const selected = reviews?.find((r) => r.id === selectedId) ?? reviews?.[0] ?? null;

  return (
    <>
      <button
        className="btn small"
        onClick={() => {
          setOpen(true);
          void load();
        }}
        title="How your week went, loose ends, and what to write next"
      >
        Weekly review
        {due && <span className="weekly-dot" aria-label="A new review is ready to write" />}
      </button>
      {open && (
        <>
          <div className="drawer-overlay" onClick={() => setOpen(false)} />
          <div className="drawer weekly-drawer" role="dialog" aria-label="Weekly review">
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <h2>Weekly review</h2>
              <button className="btn ghost small" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <p className="scratch-hint">
              Ciciro looks back over your week: what you wrote, what is still open in the story,
              and what to write next. Past reviews are kept here.
            </p>
            {error && (
              <div className="scratch-error" role="alert">
                {error}
              </div>
            )}
            <button className="btn primary small" onClick={generate} disabled={busy}>
              {busy ? "Reviewing your week…" : due ? "Review this week" : "Write a new review"}
            </button>
            <div style={{ marginTop: 14 }}>
              {reviews === null && <div className="empty">Loading…</div>}
              {reviews?.length === 0 && (
                <div className="empty">No reviews yet. Write one when the week feels done.</div>
              )}
              {selected && (
                <>
                  <div className="scratch-bar">
                    <strong>{formatWeekRange(selected.weekStart, selected.weekEnd)}</strong>
                    <button className="btn ghost small" onClick={() => void remove(selected)}>
                      Delete
                    </button>
                  </div>
                  <ReviewBody review={selected} />
                </>
              )}
              {reviews && reviews.length > 1 && (
                <>
                  <hr className="hr" />
                  <h3>Past reviews</h3>
                  {reviews.map((r) => (
                    <div
                      key={r.id}
                      role="button"
                      tabIndex={0}
                      className="bible-item scratch-item-main"
                      aria-current={r.id === selected?.id}
                      onClick={() => setSelectedId(r.id)}
                      onKeyDown={(e) => e.key === "Enter" && setSelectedId(r.id)}
                    >
                      <div style={{ fontWeight: 600, fontSize: 13 }}>
                        {formatWeekRange(r.weekStart, r.weekEnd)}
                      </div>
                      <div className="scratch-excerpt">
                        {r.stats.words.toLocaleString()} words across all your writing
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
