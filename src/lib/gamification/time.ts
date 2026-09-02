import { DEFAULT_TIMEZONE } from "./constants";

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Civil YYYY-MM-DD in an IANA timezone. Falls back to UTC on a bad zone. */
export function localDateISO(now: Date, timeZone: string): string {
  try {
    return now.toLocaleDateString("en-CA", { timeZone });
  } catch {
    return now.toLocaleDateString("en-CA", { timeZone: DEFAULT_TIMEZONE });
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function localWeekday(isoDate: string, timeZone: string): number {
  const noon = dateAtUtcNoon(isoDate);
  try {
    const short = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone,
    }).format(noon);
    return WEEKDAY_SHORT[short] ?? noon.getUTCDay();
  } catch {
    return noon.getUTCDay();
  }
}

/** Add days on the civil calendar (YYYY-MM-DD), not by UTC-of-now. */
export function addLocalDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = dateAtUtcNoon(fromIso).getTime();
  const b = dateAtUtcNoon(toIso).getTime();
  return Math.round((b - a) / 86_400_000);
}

function dateAtUtcNoon(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidHhMm(value: string): boolean {
  return HH_MM.test(value);
}

export function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  );
}
