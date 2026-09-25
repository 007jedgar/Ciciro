// Shared intermediate form for every import format. Parsers produce a flat run
// of blocks; `chapterize` decides where chapters begin and renders the HTML the
// editor stores (p, h2/h3, blockquote, hr for scene breaks).

export type ImportBlock =
  | { kind: "heading"; level: number; html: string; text: string }
  | { kind: "paragraph"; html: string; text: string }
  | { kind: "quote"; html: string; text: string }
  | { kind: "break" };

export type ImportedChapter = { title: string; html: string };

export type ImportedManuscript = {
  /** A title the file itself carried (a lone top heading, front matter, filename). */
  title: string;
  chapters: ImportedChapter[];
};

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A run of styled text, before it is folded into inline HTML. */
export type Run = { text: string; bold?: boolean; italic?: boolean; strike?: boolean };

/** Fold runs into inline HTML, merging neighbours that share formatting. */
export function runsToHtml(runs: Run[]): string {
  const merged: Run[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = merged[merged.length - 1];
    if (last && !!last.bold === !!run.bold && !!last.italic === !!run.italic && !!last.strike === !!run.strike) {
      last.text += run.text;
    } else {
      merged.push({ ...run });
    }
  }
  return merged
    .map((run) => {
      let html = escapeHtml(run.text).replace(/\n/g, "<br>");
      // Whitespace-only runs stay unstyled so we never emit <strong> </strong>.
      if (!run.text.trim()) return html;
      if (run.strike) html = `<s>${html}</s>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      return html;
    })
    .join("");
}

/** Paragraph text made only of scene-break glyphs: `#`, `* * *`, `---`, `~`. */
export function isBreakText(text: string): boolean {
  const t = text.replace(/[\s ]+/g, "");
  if (!t) return false;
  return /^[#*~⁂•·]{1,7}$/.test(t) || /^[-–—_=]{3,}$/.test(t);
}

export function paragraphBlock(runs: Run[]): ImportBlock | null {
  const text = runs.map((r) => r.text).join("").replace(/[ \t ]+/g, " ").trim();
  if (!text) return null;
  if (isBreakText(text)) return { kind: "break" };
  // Trim outer whitespace on the first and last run only.
  const trimmed = runs.map((r) => ({ ...r }));
  while (trimmed.length && !trimmed[0].text.trim()) trimmed.shift();
  while (trimmed.length && !trimmed[trimmed.length - 1].text.trim()) trimmed.pop();
  if (trimmed.length) {
    trimmed[0].text = trimmed[0].text.replace(/^[\s ]+/, "");
    trimmed[trimmed.length - 1].text = trimmed[trimmed.length - 1].text.replace(/[\s ]+$/, "");
  }
  return { kind: "paragraph", html: runsToHtml(trimmed), text };
}

export function headingBlock(level: number, runs: Run[]): ImportBlock | null {
  const text = runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return { kind: "heading", level, html: escapeHtml(text), text };
}

function renderBlock(block: ImportBlock, chapterLevel: number): string {
  switch (block.kind) {
    case "break":
      return "<hr>";
    case "paragraph":
      return `<p>${block.html}</p>`;
    case "quote":
      return `<blockquote><p>${block.html}</p></blockquote>`;
    case "heading": {
      // Headings deeper than the chapter level stay as in-chapter subheadings.
      const depth = Math.min(3, Math.max(2, block.level - chapterLevel + 1));
      return `<h${depth}>${block.html}</h${depth}>`;
    }
  }
}

function renderBlocks(blocks: ImportBlock[], chapterLevel: number): string {
  // A break at either end of a chapter, or two in a row, is noise.
  const trimmed: ImportBlock[] = [];
  for (const block of blocks) {
    if (block.kind === "break" && (trimmed.length === 0 || trimmed[trimmed.length - 1].kind === "break")) continue;
    trimmed.push(block);
  }
  while (trimmed.length && trimmed[trimmed.length - 1].kind === "break") trimmed.pop();
  return trimmed.map((b) => renderBlock(b, chapterLevel)).join("");
}

const CHAPTER_LINE = /^(chapter|part|prologue|epilogue|interlude|book)\b/i;

/**
 * Split blocks into chapters on headings. The chapter level is the shallowest
 * heading used, except when a single top heading opens the document (a book
 * title above its chapters), which is lifted out as the manuscript title.
 */
export function chapterize(blocks: ImportBlock[], fallbackTitle: string): ImportedManuscript {
  let title = "";
  let work = blocks;

  // Level 0 marks a document's own title (Word's Title style), never a chapter.
  const titled = work.findIndex((b) => b.kind === "heading" && b.level === 0);
  if (titled >= 0) {
    title = (work[titled] as { text: string }).text;
    work = work.filter((b) => !(b.kind === "heading" && b.level === 0));
  }

  const levels = work.filter((b) => b.kind === "heading").map((b) => (b as { level: number }).level);
  let chapterLevel = levels.length ? Math.min(...levels) : 0;

  if (levels.length > 1) {
    const top = work.filter((b) => b.kind === "heading" && b.level === chapterLevel);
    const firstHeadingIndex = work.findIndex((b) => b.kind === "heading");
    const before = work.slice(0, firstHeadingIndex).some((b) => b.kind === "paragraph" || b.kind === "quote");
    if (!title && top.length === 1 && firstHeadingIndex >= 0 && !before) {
      title = (work[firstHeadingIndex] as { text: string }).text;
      work = work.filter((_, i) => i !== firstHeadingIndex);
      chapterLevel = Math.min(...work.filter((b) => b.kind === "heading").map((b) => (b as { level: number }).level));
    }
  }

  if (!levels.length) {
    // No heading styles at all: fall back to "Chapter N" style lines.
    const isChapterLine = (b: ImportBlock) =>
      b.kind === "paragraph" && b.text.length <= 60 && CHAPTER_LINE.test(b.text) && !/[.!?]$/.test(b.text);
    if (work.some(isChapterLine)) {
      work = work.map((b) => (isChapterLine(b) ? { kind: "heading", level: 1, html: (b as { html: string }).html, text: (b as { text: string }).text } : b));
      chapterLevel = 1;
    }
  }

  const chapters: ImportedChapter[] = [];
  let current: { title: string; blocks: ImportBlock[] } | null = null;
  const preamble: ImportBlock[] = [];
  const flush = () => {
    if (current) chapters.push({ title: current.title, html: renderBlocks(current.blocks, chapterLevel) });
  };

  for (const block of work) {
    if (block.kind === "heading" && block.level === chapterLevel) {
      flush();
      current = { title: block.text, blocks: [] };
    } else if (current) {
      current.blocks.push(block);
    } else {
      preamble.push(block);
    }
  }
  flush();

  if (preamble.some((b) => b.kind !== "break")) {
    const html = renderBlocks(preamble, chapterLevel);
    if (chapters.length === 0) {
      chapters.push({ title: fallbackTitle || "Chapter 1", html });
    } else {
      chapters.unshift({ title: "Front matter", html });
    }
  }

  return { title, chapters: chapters.filter((c) => c.html || c.title) };
}
