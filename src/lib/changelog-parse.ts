import { createHash } from "node:crypto";

// Parses docs/CHANGELOG.md's "## Unreleased" section into entries the
// product-update email and the /changelog page both read. Pure text
// parsing, no fs: scripts/generate-changelog-data.ts is the only caller that
// touches disk, so this stays safe to import from a client component or the
// Worker runtime.

export type ChangelogEntry = {
  /** Stable across regenerations as long as the entry's wording doesn't change: a hash of its text. */
  id: string;
  /** The entry's first sentence (or the whole thing, if short), for the email teaser. */
  summary: string;
  /** The full entry, for the /changelog page. */
  text: string;
};

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
    const text = joinBullet(lines);
    return { id: entryId(text), summary: summarize(text), text };
  });
}
