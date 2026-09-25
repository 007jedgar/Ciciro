"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/components/SettingsProvider";
import {
  fetchWritingDays,
  getWritingDaySnapshot,
  hydrateWritingDay,
  subscribeWritingDay,
} from "@/lib/writing-day-client";
import {
  bucketWritingDays,
  formatActiveDuration,
  overlayWritingDay,
  shiftWritingDayKey,
  summarizeWritingHistory,
  writingDayKey,
  type WritingDayTotals,
} from "@/lib/writing-day";

const HEATMAP_DAYS = 28;
/** Far enough back for all-time totals without mirroring into SQLite. */
const ALL_TIME_FROM = "2018-01-01";

function heatOpacity(words: number, maxWords: number): number {
  if (words <= 0 || maxWords <= 0) return 0;
  return 0.18 + 0.82 * Math.min(1, words / maxWords);
}

export default function WritingMeter() {
  const { settings } = useSettings();
  const [day, setDay] = useState(getWritingDaySnapshot);
  const [open, setOpen] = useState(false);
  const [rangeDays, setRangeDays] = useState<WritingDayTotals[] | null>(null);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void hydrateWritingDay();
    return subscribeWritingDay(() => setDay(getWritingDaySnapshot()));
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const today = writingDayKey();
    void (async () => {
      try {
        const rows = await fetchWritingDays(ALL_TIME_FROM, today);
        if (cancelled) return;
        setRangeDays(rows ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, day.date, day.words, day.activeMs]);

  const today = day.date || writingDayKey();
  const merged = useMemo(() => {
    const base = rangeDays ?? [];
    return overlayWritingDay(base, {
      date: day.date,
      words: day.words,
      activeMs: day.activeMs,
    });
  }, [rangeDays, day.date, day.words, day.activeMs]);

  const summary = useMemo(() => summarizeWritingHistory(merged, today), [merged, today]);
  const heatFrom = shiftWritingDayKey(today, -(HEATMAP_DAYS - 1));
  const buckets = useMemo(
    () => bucketWritingDays(merged, heatFrom, today),
    [merged, heatFrom, today]
  );
  const maxWords = useMemo(
    () => buckets.reduce((max, row) => Math.max(max, row.words), 0),
    [buckets]
  );

  if (!settings.showDailyGoal) return null;

  const ratio = settings.dailyWordGoal > 0 ? Math.min(1, day.words / settings.dailyWordGoal) : 0;
  const weekLabel = `${summary.daysInLast7} of the last 7 days`;

  return (
    <div className="writing-meter-wrap" ref={rootRef}>
      <button
        type="button"
        className="writing-meter-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${day.words} of ${settings.dailyWordGoal} words today. ${weekLabel}. Open writing history.`}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="writing-meter"
          role="meter"
          aria-hidden="true"
          aria-valuemin={0}
          aria-valuemax={settings.dailyWordGoal}
          aria-valuenow={Math.min(day.words, settings.dailyWordGoal)}
        >
          <span className="writing-meter-fill" style={{ width: `${ratio * 100}%` }} />
        </span>
        <span className="writing-meter-week">{weekLabel}</span>
      </button>
      {open ? (
        <div className="writing-history-menu" role="dialog" aria-label="Writing history">
          <div className="theme-menu-label">Last 28 days</div>
          <div className="writing-heatmap" aria-hidden={loading}>
            {buckets.map((row) => (
              <span
                key={row.date}
                className="writing-heat-cell"
                title={`${row.date}: ${row.words} words`}
                style={{
                  opacity: row.words > 0 ? heatOpacity(row.words, maxWords) : 0.12,
                  background: row.words > 0 ? "var(--accent)" : "var(--line)",
                }}
              />
            ))}
          </div>
          {loading && rangeDays == null ? (
            <p className="settings-hint">Loading history…</p>
          ) : (
            <dl className="writing-history-stats">
              <div>
                <dt>This week</dt>
                <dd>{summary.weekWords.toLocaleString()} words</dd>
              </div>
              <div>
                <dt>This month</dt>
                <dd>{summary.monthWords.toLocaleString()} words</dd>
              </div>
              <div>
                <dt>All time</dt>
                <dd>{summary.allTimeWords.toLocaleString()} words</dd>
              </div>
              <div>
                <dt>Best day</dt>
                <dd>
                  {summary.bestDay
                    ? `${summary.bestDay.words.toLocaleString()} on ${summary.bestDay.date}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt>Time at the keys</dt>
                <dd>
                  {summary.avgActiveMs == null
                    ? "—"
                    : `${formatActiveDuration(summary.avgActiveMs)} avg`}
                </dd>
              </div>
              <div>
                <dt>Last 7 days</dt>
                <dd>{weekLabel}</dd>
              </div>
            </dl>
          )}
        </div>
      ) : null}
    </div>
  );
}
