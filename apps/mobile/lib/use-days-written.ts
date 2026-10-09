import { useMemo } from "react";
import { useWritingDaysQuery } from "./api";
import {
  countWritingDaysInWindow,
  overlayWritingDay,
  shiftWritingDayKey,
  writingDayKey,
} from "./writing-day";
import { useWritingDay } from "./writing-day-session";

/**
 * How many of the last 7 days (today included) have words, today's unsynced
 * count laid over the server's. Null until the server has answered, so a row
 * shows nothing rather than a count that is about to change.
 */
export function useDaysWrittenInLast7(options: { enabled: boolean }): number | null {
  const day = useWritingDay();
  const today = day.date || writingDayKey();
  const from = shiftWritingDayKey(today, -6);
  const range = useWritingDaysQuery(from, today, { enabled: options.enabled });
  const days = range.data?.days;
  const count = useMemo(() => {
    const base = (days ?? []).map((row) => ({
      date: row.date,
      words: row.words,
      activeMs: row.activeMs,
    }));
    const merged = overlayWritingDay(base, {
      date: day.date,
      words: day.words,
      activeMs: day.activeMs,
    });
    return countWritingDaysInWindow(merged, today);
  }, [days, day.date, day.words, day.activeMs, today]);
  return days ? count : null;
}
