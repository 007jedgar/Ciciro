import { createHash } from "node:crypto";

// Parses docs/CHANGELOG.md's "## Unreleased" section into entries the
// product-update email and the /changelog page both read. Pure text
// parsing, no fs: scripts/generate-changelog-data.ts is the only caller that
// touches disk, so this stays safe to import from a client component or the
// Worker runtime.
//
// Each bullet is dated by a leading `<!-- YYYY-MM-DD -->` HTML comment (never
// rendered: stripped here before the entry's text is used). A bullet missing
// one is backfilled automatically by generate-changelog-data.ts, which writes
// the derived date back into docs/CHANGELOG.md — see that script for how.

export type ChangelogEntry = {
  /** Stable across regenerations as long as the entry's wording doesn't change: a hash of its text. */
  id: string;
  /** YYYY-MM-DD the entry was added, from its leading `<!-- YYYY-MM-DD -->` comment. */
  date: string;
  /** The entry's first sentence (or the whole thing, if short), for the email teaser. */
  summary: string;
  /** The full entry (markdown, date comment stripped), for the /changelog page. */
  text: string;
};

const DATE_COMMENT = /^<!--\s*(\d{4}-\d{2}-\d{2})\s*-->\s*/;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-10-09" -> "October 9, 2026". Fixed English format: a server-rendered date must not depend on a request's locale. */
export function formatChangelogDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function entryId(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

/** The entry's first sentence, capped so a long one still fits an email line. */
function summarize(text: string, maxLength = 160): string {
  const match = text.match(/^.+?[.!?](?=\s|$)/);
  const first = match ? match[0] : text;
  if (first.length <= maxLength) return first;
  return `${first.slice(0, maxLength - 1).trimEnd()}…`;
}

/** One `- ...` top-level bullet, its continuation lines dedented and joined. */
function joinBullet(lines: string[]): string {
  return lines
    .map((line, index) => (index === 0 ? line.replace(/^- /, "") : line.replace(/^ {2}/, "")))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every top-level `- ` bullet directly under `## Unreleased`, newest first (the file's own order). */
export function parseChangelogEntries(markdown: string): ChangelogEntry[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === "## Unreleased");
  if (start === -1) return [];
  const end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  const section = lines.slice(start + 1, end === -1 ? undefined : end);

  const bullets: string[][] = [];
  for (const line of section) {
    if (/^- /.test(line)) bullets.push([line]);
    else if (bullets.length && (line.trim() === "" ? false : /^ {2}/.test(line))) {
      bullets[bullets.length - 1].push(line);
    }
  }

  return bullets.map((lines) => {
    const joined = joinBullet(lines);
    const dateMatch = joined.match(DATE_COMMENT);
    const text = dateMatch ? joined.slice(dateMatch[0].length) : joined;
    const date = dateMatch ? dateMatch[1] : "";
    return { id: entryId(text), date, summary: summarize(text), text };
  });
}
