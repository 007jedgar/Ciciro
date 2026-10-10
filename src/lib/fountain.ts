/**
 * Fountain (https://fountain.io, spec 1.1) in and out of a script's blocks.
 *
 * Fountain is an interchange format, never the stored one: a script stays flat
 * element-tagged blocks (see screenplay.ts). The writer derives capitals at the
 * edge and adds a forced marker (`!` `@` `.` `>`) wherever the plain line would
 * be read back as another element. The reader honours those markers, splits
 * sequences at `#` sections, and drops what a block cannot hold (notes,
 * boneyard, synopses, page breaks, the title page past its title and author).
 *
 * Fountain has no shot, no unbroken dialogue across a blank line and no way to
 * say a parenthetical or a line of dialogue has no cue above it; those are
 * written as the nearest thing and read back as such (docs/screenplay.md). Dual
 * dialogue is the `^` after the second cue, centered text is `> text <`, and a
 * scene number is `#n#` after the heading; the title page is the `Key: value`
 * block at the top.
 * Pure: no DOM, no I/O.
 */

import { isShotLine } from "./manuscript-kind";
import {
  EMPTY_TITLE_PAGE,
  TITLE_PAGE_FIELDS,
  dualPairs,
  isNumberedScene,
  normalizeElement,
  normalizeTitlePage,
  runsText,
  withDual,
  withElement,
  type ScreenplayElement,
  type StyledBlock,
  type StyledRun,
  type TitlePage,
} from "./screenplay";

export type FountainSequence = { title: string; blocks: StyledBlock[] };

export type FountainScript = {
  title: string;
  author: string;
  /**
   * The title page as it is to be written, blanks already filled in
   * (`resolveTitlePage`); on a read, the one the file carried. `title` and
   * `author` stand in for a title page left out.
   */
  titlePage?: TitlePage;
  sequences: FountainSequence[];
  /** On a read: the file numbered its scenes. */
  sceneNumbers?: boolean;
};

export type FountainWriteOptions = {
  /** Write each scene heading's number as `#n#`, counting on across sequences. */
  sceneNumbers?: boolean;
};

// --- Shapes ------------------------------------------------------------------

const SCENE_HEADING = /^(?:(?:int|i)\.?\/(?:ext|e)|int|ext|est)[. ].+/i;
const TRANSITION = /^(?:(?:FADE (?:TO BLACK|OUT)|CUT TO BLACK)\.|.+ TO:)$/;
const SCENE_NUMBER = /\s*#([\w.-]+?)#\s*$/;
const TITLE_KEY = /^\s*(title|credit|authors?|source|notes|draft ?date|date|contact|copyright|revisions?)\s*:/i;
const FORCE_MARKS = /^[.@!>~=#]/;

/** Entirely capitals, with at least one letter that has a case. */
function isAllCaps(text: string): boolean {
  return text === text.toUpperCase() && text !== text.toLowerCase();
}

// --- Inline marks ------------------------------------------------------------

const ESCAPABLE = "@#!*_$~`+=.><\\/";

function escapeInline(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "*" || ch === "_") out += `\\${ch}`;
    else if (ch === "\\" && i + 1 < text.length && ESCAPABLE.includes(text[i + 1])) out += "\\\\";
    else out += ch;
  }
  return out;
}

/** Runs as Fountain emphasis: `**bold**`, `*italic*`, `***both***`, `_underline_`. */
function runsToFountain(runs: readonly StyledRun[], caps: boolean, marks: boolean): string {
  let out = "";
  for (const run of runs) {
    const text = caps ? run.text.toUpperCase() : run.text;
    if (!marks || !(run.bold || run.italic || run.underline)) {
      out += escapeInline(text);
      continue;
    }
    // Delimiters hug the words: spaces and line breaks stay outside them.
    const pieces = text.split(/(\s+)/);
    for (const piece of pieces) {
      if (!piece || /^\s+$/.test(piece)) {
        out += piece;
        continue;
      }
      let wrapped = escapeInline(piece);
      const stars = run.bold && run.italic ? "***" : run.bold ? "**" : run.italic ? "*" : "";
      if (stars) wrapped = `${stars}${wrapped}${stars}`;
      if (run.underline) wrapped = `_${wrapped}_`;
      out += wrapped;
    }
  }
  return out;
}

/** The runs of a block as one Fountain line; line breaks inside it are folded to spaces. */
function oneLine(runs: readonly StyledRun[], caps: boolean, marks: boolean): string {
  return runsToFountain(runs, caps, marks).replace(/\s*\n\s*/g, " ").trim();
}

/** The runs of a block as Fountain lines; an empty line inside it is two spaces, which Fountain keeps. */
function manyLines(runs: readonly StyledRun[], caps: boolean): string[] {
  return runsToFountain(runs, caps, true)
    .split("\n")
    .map((line) => (line.trim() === "" ? "  " : line.replace(/\s+$/, "")));
}

// --- Writing -----------------------------------------------------------------

function cueIsPlain(cue: string): boolean {
  // One trailing extension, "(V.O.)", is read as part of the name.
  const name = cue.replace(/\s*\([^()]*\)\s*$/, "");
  if (/[()^]/.test(name) || !isAllCaps(name)) return false;
  if (FORCE_MARKS.test(cue) || /^[\s0-9_*]/.test(cue)) return false;
  return !SCENE_HEADING.test(cue) && !TRANSITION.test(cue);
}

function bareParenthetical(runs: readonly StyledRun[]): string {
  return oneLine(runs, false, true).replace(/^\(\s*/, "").replace(/\s*\)$/, "");
}

function actionChunk(runs: readonly StyledRun[], text: string, caps = false): string {
  const lines = manyLines(runs, caps);
  const first = text.split("\n")[0].trim();
  const upper = caps ? first.toUpperCase() : first;
  const multi = lines.length > 1;
  const risky =
    SCENE_HEADING.test(upper) ||
    TRANSITION.test(upper) ||
    FORCE_MARKS.test(upper) ||
    upper.startsWith("[[") ||
    upper.startsWith("/*") ||
    /^={3,}$/.test(upper) ||
    (isAllCaps(upper) && (multi || cueIsPlain(upper)));
  if (risky) lines[0] = `!${lines[0]}`;
  return lines.join("\n");
}

type Chunk = string;

/** Scene numbers handed out so far in a script: they run on from one sequence to the next. */
type Numbering = { enabled: boolean; count: number };

function blocksToChunks(blocks: readonly StyledBlock[], numbering: Numbering): Chunk[] {
  const chunks: Chunk[] = [];
  const present = blocks.filter((b) => runsText(b.runs).trim() !== "");
  // The cues that open the second speech of a pair; a flag with nothing above it is dropped.
  const seconds = new Set(
    dualPairs(present.map((b) => ({ element: b.element, text: "", dual: b.dual }))).map((pair) => pair.right.character)
  );
  for (let i = 0; i < present.length; i++) {
    const block = present[i];
    const text = runsText(block.runs);
    const element = normalizeElement(block.element);
    switch (element) {
      case "scene-heading": {
        const line = oneLine(block.runs, true, false);
        const forced = SCENE_HEADING.test(line) && !SCENE_NUMBER.test(line) ? line : `.${line}`;
        numbering.count++;
        chunks.push(numbering.enabled ? `${forced} #${numbering.count}#` : forced);
        break;
      }
      case "centered": {
        // Each line is centered on its own.
        chunks.push(manyLines(block.runs, false).map((line) => `> ${line.trim()} <`).join("\n"));
        break;
      }
      case "transition": {
        const line = oneLine(block.runs, true, false);
        chunks.push(TRANSITION.test(line) && !line.endsWith("<") ? line : `>${line}`);
        break;
      }
      case "shot": {
        // Fountain has no shot: it is an all-caps action line, read back as a shot.
        chunks.push(`!${oneLine(block.runs, true, false)}`);
        break;
      }
      case "character": {
        const cue = oneLine(block.runs, true, false);
        const lines: string[] = [];
        let previous: ScreenplayElement | null = null;
        let j = i + 1;
        for (; j < present.length; j++) {
          const next = normalizeElement(present[j].element);
          if (next !== "parenthetical" && next !== "dialogue") break;
          if (next === "parenthetical") {
            lines.push(`(${bareParenthetical(present[j].runs)})`);
          } else {
            // Two dialogue blocks in one speech are kept apart by a line of two spaces.
            if (previous === "dialogue") lines.push("  ");
            lines.push(...manyLines(present[j].runs, false));
          }
          previous = next;
        }
        const second = seconds.has(i);
        i = j - 1;
        const head = cueIsPlain(cue) && lines.length > 0 ? cue : `@${cue}`;
        chunks.push([second ? `${head} ^` : head, ...lines].join("\n"));
        break;
      }
      case "parenthetical":
        // No cue above it: Fountain cannot say so, so it is an action line in brackets.
        chunks.push(`!(${bareParenthetical(block.runs)})`);
        break;
      case "dialogue":
        chunks.push(actionChunk(block.runs, text));
        break;
      default:
        chunks.push(actionChunk(block.runs, text));
    }
  }
  return chunks;
}

function oneLineMeta(value: string): string {
  return value.replace(/\s*\n\s*/g, " ").trim();
}

/** The title page's keys, in the order a Fountain file writes them. */
const TITLE_KEYS: readonly [keyof TitlePage, string][] = [
  ["title", "Title"],
  ["credit", "Credit"],
  ["author", "Author"],
  ["source", "Source"],
  ["draftDate", "Draft date"],
  ["contact", "Contact"],
];

/** The title block: one `Key: value` line a field, a several-line one (the contact) indented under its key. */
function titleBlock(page: TitlePage): string {
  const lines: string[] = [];
  for (const [field, key] of TITLE_KEYS) {
    const value = page[field];
    if (!value.trim()) continue;
    const rows = value
      .split("\n")
      .map((row) => row.trim())
      .filter(Boolean);
    if (rows.length === 1) lines.push(`${key}: ${rows[0]}`);
    else lines.push(`${key}:`, ...rows.map((row) => `    ${row}`));
  }
  return lines.join("\n");
}

/**
 * A script as Fountain text. More than one sequence is written as `#` sections
 * (their titles), so reading it back finds the same sequences; one sequence is
 * written bare. The title page leads, in its keys.
 */
export function fountainFromScript(script: FountainScript, opts: FountainWriteOptions = {}): string {
  const parts: string[] = [];
  const page = script.titlePage ?? {
    ...EMPTY_TITLE_PAGE,
    title: oneLineMeta(script.title),
    author: oneLineMeta(script.author),
  };
  const head = titleBlock(page);
  if (head) parts.push(head);
  const numbering: Numbering = { enabled: opts.sceneNumbers === true, count: 0 };
  const sectioned = script.sequences.length > 1;
  script.sequences.forEach((sequence, index) => {
    if (sectioned) {
      const name = oneLineMeta(sequence.title) || `Sequence ${index + 1}`;
      parts.push(`# ${name.replace(/^#+\s*/, "")}`);
    }
    parts.push(...blocksToChunks(sequence.blocks, numbering));
  });
  return parts.length > 0 ? `${parts.join("\n\n")}\n` : "";
}

// --- Reading -----------------------------------------------------------------

type Delim = { type: "delim"; d: string; before: string; after: string };
type Piece = { type: "text"; s: string } | Delim;

/** Inline Fountain emphasis to runs; an unmatched or stray delimiter stays as text. */
export function runsFromFountain(source: string): StyledRun[] {
  const pieces: Piece[] = [];
  let buf = "";
  const flush = () => {
    if (buf) pieces.push({ type: "text", s: buf });
    buf = "";
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\" && i + 1 < source.length && ESCAPABLE.includes(source[i + 1])) {
      buf += source[i + 1];
      i++;
    } else if (ch === "*") {
      let n = 1;
      while (n < 3 && source[i + n] === "*") n++;
      flush();
      pieces.push({ type: "delim", d: "*".repeat(n), before: source[i - 1] ?? "", after: source[i + n] ?? "" });
      i += n - 1;
    } else if (ch === "_") {
      flush();
      pieces.push({ type: "delim", d: "_", before: source[i - 1] ?? "", after: source[i + 1] ?? "" });
    } else {
      buf += ch;
    }
  }
  flush();

  const isSpace = (c: string) => c === "" || /\s/.test(c);
  const isWord = (c: string) => /[\p{L}\p{N}]/u.test(c);
  const open: number[] = [];
  const paired = new Map<number, number>(); // opener index -> closer index
  pieces.forEach((piece, at) => {
    if (piece.type !== "delim") return;
    const canClose = !isSpace(piece.before) && (piece.d !== "_" || !isWord(piece.after));
    const canOpen = !isSpace(piece.after) && (piece.d !== "_" || !isWord(piece.before));
    const opener = canClose ? open.findLastIndex((p) => (pieces[p] as Delim).d === piece.d) : -1;
    if (opener >= 0) {
      paired.set(open[opener], at);
      open.length = opener; // anything opened inside and never closed is dropped to text
    } else if (canOpen) {
      open.push(at);
    }
  });
  const closers = new Set(paired.values());

  const runs: StyledRun[] = [];
  let bold = 0;
  let italic = 0;
  let underline = 0;
  const add = (text: string) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && !!last.bold === bold > 0 && !!last.italic === italic > 0 && !!last.underline === underline > 0) {
      last.text += text;
      return;
    }
    const run: StyledRun = { text };
    if (bold > 0) run.bold = true;
    if (italic > 0) run.italic = true;
    if (underline > 0) run.underline = true;
    runs.push(run);
  };
  const apply = (d: string, step: 1 | -1) => {
    if (d === "_") underline += step;
    else if (d === "***") {
      bold += step;
      italic += step;
    } else if (d === "**") bold += step;
    else italic += step;
  };
  pieces.forEach((piece, at) => {
    if (piece.type === "text") add(piece.s);
    else if (paired.has(at)) apply(piece.d, 1);
    else if (closers.has(at)) apply(piece.d, -1);
    else add(piece.d);
  });
  return runs;
}

/** Plain text of a Fountain line (emphasis markers read, then dropped). */
function plainOf(source: string): string {
  return runsText(runsFromFountain(source));
}

const NOTE_OR_BONEYARD = /\/\*[\s\S]*?\*\/|\[\[[\s\S]*?\]\]/g;
const REMOVED = "\u0001";

type Raw = { lines: string[] };

function splitParagraphs(text: string): Raw[] {
  // A removed note or boneyard leaves no line behind unless text surrounds it.
  const cleaned = text.replace(NOTE_OR_BONEYARD, (m) => REMOVED.repeat(Math.max(1, m.split("\n").length)));
  const paragraphs: Raw[] = [];
  let lines: string[] = [];
  const end = () => {
    if (lines.length > 0) paragraphs.push({ lines });
    lines = [];
  };
  for (const raw of cleaned.split("\n")) {
    const line = raw.replace(/\u0001/g, "");
    if (raw.includes(REMOVED) && line.trim() === "") continue;
    if (line === "  ") lines.push(line);
    else if (line.trim() === "") end();
    else lines.push(line);
  }
  end();
  return paragraphs;
}

const TITLE_FIELD_OF_KEY: Record<string, keyof TitlePage> = {
  title: "title",
  credit: "credit",
  author: "author",
  authors: "author",
  source: "source",
  "draft date": "draftDate",
  draftdate: "draftDate",
  date: "draftDate",
  contact: "contact",
};

function takeTitlePage(text: string): { page: TitlePage; found: boolean; rest: string } {
  const first = text.split("\n", 1)[0];
  if (!TITLE_KEY.test(first)) return { page: EMPTY_TITLE_PAGE, found: false, rest: text };
  const lines = text.split("\n");
  let end = lines.findIndex((l) => l.trim() === "");
  if (end < 0) end = lines.length;
  let key = "";
  const values: Record<string, string[]> = {};
  for (const line of lines.slice(0, end)) {
    const m = line.match(/^\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.*)$/);
    if (m && !/^\s/.test(line)) {
      key = m[1].toLowerCase();
      values[key] = m[2] ? [m[2]] : [];
    } else if (key) {
      values[key].push(line.trim());
    }
  }
  const fields: Partial<Record<keyof TitlePage, string>> = {};
  for (const [name, rows] of Object.entries(values)) {
    const field = TITLE_FIELD_OF_KEY[name];
    // A key given twice (Date after Draft date) keeps the first.
    if (!field || fields[field]) continue;
    const plain = rows.map((row) => plainOf(row).trim()).filter(Boolean);
    fields[field] = field === "contact" ? plain.join("\n") : plain.join(" ");
  }
  return { page: normalizeTitlePage(fields), found: true, rest: lines.slice(end).join("\n") };
}

type Section = { depth: number; title: string };
type Item = { block: StyledBlock } | { section: Section };

const textBlock = (element: string, source: string): StyledBlock => ({ element, runs: runsFromFountain(source) });

/** What the reader noticed on the way that is not a block: the file numbered its scenes. */
type Notes = { sceneNumbers: boolean };

function readParagraph(lines: string[], out: Item[], notes: Notes): void {
  const first = lines[0].trim();

  const section = first.match(/^(#+)\s*(.*)$/);
  if (section) {
    out.push({ section: { depth: section[1].length, title: plainOf(section[2]).trim() } });
    if (lines.length > 1) readParagraph(lines.slice(1), out, notes);
    return;
  }
  if (/^=(?!=)/.test(first)) {
    if (lines.length > 1) readParagraph(lines.slice(1), out, notes);
    return;
  }
  if (lines.length === 1 && /^={3,}$/.test(first)) return;

  const rest = (from: number, element = "action") => {
    const body = lines.slice(from).map((l) => l.trim());
    if (body.some(Boolean)) out.push({ block: textBlock(element, body.join("\n").replace(/^\n+|\n+$/g, "")) });
  };

  if (first.startsWith("!")) {
    // A forced action; an all-caps camera direction is a shot.
    const body = [first.slice(1).trim(), ...lines.slice(1).map((l) => l.trim())].join("\n");
    const caps = isAllCaps(body) && isShotLine(body.split("\n")[0]);
    out.push({ block: textBlock(caps ? "shot" : "action", body) });
    return;
  }
  if (first.startsWith(".") && !first.startsWith("..")) {
    const heading = first.slice(1).trim();
    if (SCENE_NUMBER.test(heading)) notes.sceneNumbers = true;
    out.push({ block: textBlock("scene-heading", heading.replace(SCENE_NUMBER, "")) });
    rest(1);
    return;
  }
  if (first.startsWith(">")) {
    if (first.endsWith("<")) {
      const centered = lines.map((l) => l.trim().replace(/^>\s*/, "").replace(/\s*<$/, "")).join("\n");
      out.push({ block: textBlock("centered", centered) });
    } else {
      out.push({ block: textBlock("transition", first.slice(1).trim()) });
      rest(1);
    }
    return;
  }
  if (first.startsWith("~")) {
    const sung = lines.map((l) => l.trim().replace(/^~\s*/, "")).join("\n");
    out.push({ block: { element: "action", runs: runsFromFountain(sung).map((r) => ({ ...r, italic: true })) } });
    return;
  }
  if (lines.length === 1 && SCENE_HEADING.test(first)) {
    if (SCENE_NUMBER.test(first)) notes.sceneNumbers = true;
    out.push({ block: textBlock("scene-heading", first.replace(SCENE_NUMBER, "")) });
    return;
  }
  if (lines.length === 1 && isAllCaps(first) && TRANSITION.test(first)) {
    out.push({ block: textBlock("transition", first) });
    return;
  }

  // A cue: forced with @, or a line of capitals with something under it.
  const forcedCue = first.startsWith("@");
  const dual = /\s*\^$/.test(first);
  const cueText = (forcedCue ? first.slice(1) : first).replace(/\s*\^$/, "").trim();
  const bare = cueText.replace(/\s*\([^()]*\)\s*$/, "");
  const plainCue =
    lines.length > 1 &&
    isAllCaps(bare) &&
    !FORCE_MARKS.test(first) &&
    !/^[\s0-9_*]/.test(first) &&
    !SCENE_HEADING.test(first);
  if (forcedCue || plainCue) {
    out.push({ block: { ...textBlock("character", cueText), ...(dual ? { dual: true } : {}) } });
    let dialogue: string[] = [];
    const endDialogue = () => {
      if (dialogue.length > 0) out.push({ block: textBlock("dialogue", dialogue.join("\n")) });
      dialogue = [];
    };
    for (const raw of lines.slice(1)) {
      if (raw === "  ") {
        endDialogue();
        continue;
      }
      const line = raw.trim();
      if (/^\(.*\)$/.test(line)) {
        endDialogue();
        out.push({ block: textBlock("parenthetical", line.slice(1, -1).trim()) });
      } else {
        dialogue.push(line);
      }
    }
    endDialogue();
    return;
  }

  // Action. A line of two spaces is an empty line inside it.
  const body = lines.map((l) => (l === "  " ? "" : l.trim())).join("\n");
  const caps = isAllCaps(body) && isShotLine(body.split("\n")[0]);
  out.push({ block: textBlock(caps ? "shot" : "action", body) });
}

/**
 * Fountain text as a script. Sequences split at the shallowest `#` section
 * depth in the file (one sequence when there are none); text ahead of the first
 * section is a sequence of its own with no title. `titlePage: false` reads the
 * first lines as script even when they look like `Title:` (pasted text).
 */
export function scriptFromFountain(source: string, opts: { titlePage?: boolean } = {}): FountainScript {
  const normalized = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const taken =
    opts.titlePage === false
      ? { page: EMPTY_TITLE_PAGE, found: false, rest: normalized }
      : takeTitlePage(normalized);
  const { page, rest } = taken;
  const items: Item[] = [];
  const notes: Notes = { sceneNumbers: false };
  for (const paragraph of splitParagraphs(rest)) readParagraph(paragraph.lines, items, notes);

  const depths = items.flatMap((item) => ("section" in item ? [item.section.depth] : []));
  const splitDepth = depths.length > 0 ? Math.min(...depths) : 0;
  const sequences: FountainSequence[] = [];
  let current: FountainSequence | null = null;
  for (const item of items) {
    if ("section" in item) {
      if (item.section.depth !== splitDepth) continue;
      current = { title: item.section.title, blocks: [] };
      sequences.push(current);
    } else {
      if (!current) {
        current = { title: "", blocks: [] };
        sequences.push(current);
      }
      current.blocks.push(item.block);
    }
  }
  if (sequences.length === 0) sequences.push({ title: "", blocks: [] });
  return {
    title: page.title,
    author: page.author,
    ...(taken.found ? { titlePage: page } : {}),
    sequences,
    sceneNumbers: notes.sceneNumbers,
  };
}

// --- Blocks as HTML ------------------------------------------------------------

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Runs as inline HTML: `<strong>`, `<em>`, `<u>`, and `<br>` for a line break. */
export function runsToHtml(runs: readonly StyledRun[]): string {
  return runs
    .map((run) => {
      let html = escapeHtml(run.text).replace(/\n/g, "<br>");
      if (!run.text.trim()) return html;
      if (run.underline) html = `<u>${html}</u>`;
      if (run.italic) html = `<em>${html}</em>`;
      if (run.bold) html = `<strong>${html}</strong>`;
      return html;
    })
    .join("");
}

/** Styled blocks as chapter HTML, one `<p data-sp>` per block. */
export function scriptBlocksToHtml(blocks: readonly StyledBlock[]): string {
  return blocks
    .map((block) => {
      const html = withElement(`<p>${runsToHtml(block.runs)}</p>`, block.element);
      return block.dual && normalizeElement(block.element) === "character" ? withDual(html, true) : html;
    })
    .join("");
}

// --- Detecting ---------------------------------------------------------------

/** Whether pasted text is laid out as a script: paragraphs split by blank lines. */
export function looksLikeFountain(text: string): boolean {
  return /\n[ \t]*\r?\n/.test(text.trim());
}
