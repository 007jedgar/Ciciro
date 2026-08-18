import { prisma } from "@/lib/db";
import { indexChapter, formatSceneIndex, parsePassageId } from "@/lib/passages";

// Decide how to rearrange manuscript text: a cheap index loop, one targeted
// move, or a full-chapter read. First-time users should not have to write
// expert prompts - this runs on the author's words + chapter shape.
//
// Opus still executes (and may override with a reason). The plan never hides
// read_chapter; it says when that read is wasteful.

export type ReorgKind = "not_reorg" | "targeted" | "index_loop" | "full_read";
export type ReadStrategy = "skip" | "index" | "full_read";
export type DestPlacement = "end" | "seam" | "ask";

export type ChapterShape = {
  number: number;
  title: string;
  revision: number;
  wordCount: number;
  sceneCount: number;
  paragraphCount: number;
  index: string;
};

export type ReorgPlan = {
  kind: ReorgKind;
  sourceChapter: number | null;
  destChapter: number | null;
  sourceRead: ReadStrategy;
  destRead: ReadStrategy;
  destPlacement: DestPlacement;
  loop: boolean;
  reasons: string[];
  instructions: string;
};

const MOVE_RE =
  /\b(move|relocate|rearrange|reorder|misplaced|poorly inserted|wrongly inserted|badly inserted|wrong place|doesn't belong|does not belong|doesnt belong|don't belong|do not belong|unrelated|throughline|put this|take this|park this|add (?:it|this|that|the (?:passage|scene|text)) to|belongs in|belong in|insert(?:ed)? in the wrong|landed in the wrong|fix misplaced|wrong chapter|other chapter)\b/i;

const SEAM_RE =
  /\b(right spot|where it belongs|where it fits|find the (?:spot|place|seam)|into the (?:scene|throughline)|after the|before the)\b/i;

const END_RE =
  /\b(at the end|to the end|end of|append|bottom of)\b/i;

const THROUGHLINE_RE =
  /\b(throughline|anything that (?:doesn'?t|does not) belong|doesn'?t belong in this chapter|unrelated|fix (?:the )?(?:order|structure|misplaced)|passages? that don'?t|wrong place)\b/i;

function hasSelection(selection: string | undefined | null): boolean {
  return Boolean(selection && selection.trim().length > 0);
}

export function looksLikeReorg(message: string, selection?: string): boolean {
  const m = message.trim();
  if (MOVE_RE.test(m) || THROUGHLINE_RE.test(m) || SEAM_RE.test(m)) return true;
  if (hasSelection(selection) && /\b(move|belong|wrong|put|take|park|relocate)\b/i.test(m)) {
    return true;
  }
  return false;
}

function chapterReferencePattern(chapters: ChapterShape[]): RegExp {
  const titles = chapters
    .filter((chapter) => chapter.title.trim())
    .sort((a, b) => b.title.length - a.title.length)
    .map((chapter) => chapter.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const titlePart = titles.length ? `|${titles.join("|")}` : "";
  return new RegExp(`(?:chapter|ch\\.?)\\s*\\d+${titlePart}`, "gi");
}

function resolveChapterReference(
  raw: string,
  chapters: ChapterShape[]
): number | null {
  const numbered = raw.match(/(?:chapter|ch\.?)\s*(\d+)/i);
  if (numbered) return Number(numbered[1]);
  const normalized = raw.trim().toLocaleLowerCase();
  return (
    chapters.find(
      (chapter) => chapter.title.trim().toLocaleLowerCase() === normalized
    )?.number ?? null
  );
}

export function parseChapterDirections(
  message: string,
  chapters: ChapterShape[] = []
): {
  source: number | null;
  dest: number | null;
  all: number[];
} {
  const all: number[] = [];
  const seen = new Set<number>();
  const add = (n: number) => {
    if (!Number.isFinite(n) || n < 1) return;
    if (!seen.has(n)) {
      seen.add(n);
      all.push(n);
    }
  };

  const refSource = chapterReferencePattern(chapters).source;
  const sourcePattern = new RegExp(
    `(?:from|read|(?:poorly|wrongly|badly)\\s+inserted\\s+in|misplaced\\s+in|does(?:n'?t| not)\\s+belong\\s+in)\\s+(${refSource})`,
    "i"
  );
  const destPattern = new RegExp(
    `(?:add|move|put|place|relocate|insert|send)(?:\\s+(?:it|this|that|the\\s+(?:passage|scene|text)))?\\s+(?:to|into)\\s+(${refSource})|belongs?\\s+in\\s+(${refSource})`,
    "i"
  );
  const sourceMatch = message.match(sourcePattern);
  const destMatch = message.match(destPattern);
  const source = sourceMatch
    ? resolveChapterReference(sourceMatch[1], chapters)
    : null;
  const destRef = destMatch?.[1] || destMatch?.[2];
  const dest = destRef ? resolveChapterReference(destRef, chapters) : null;
  if (source != null) add(source);
  if (dest != null) add(dest);

  const re = chapterReferencePattern(chapters);
  let m: RegExpExecArray | null;
  while ((m = re.exec(message))) {
    const number = resolveChapterReference(m[0], chapters);
    if (number != null) add(number);
  }

  const idRe = /\bch(\d+)\.(?:s|p)\d+/gi;
  while ((m = idRe.exec(message))) add(Number(m[1]));

  return { source, dest, all };
}

function namedPassageId(message: string): string | null {
  const m = message.match(/\bch\d+\.(?:s\d+(?:-s\d+)?|p\d+(?:-p\d+)?)\b/i);
  return m ? m[0] : null;
}

function isSceneRich(ch: ChapterShape | undefined): boolean {
  return Boolean(ch && ch.sceneCount >= 2);
}

function isBlob(ch: ChapterShape | undefined): boolean {
  return Boolean(ch && ch.sceneCount <= 1 && ch.paragraphCount > 12);
}

export function decideReorg(input: {
  message: string;
  selection?: string;
  openChapter: number | null;
  chapters: ChapterShape[];
}): ReorgPlan {
  const message = input.message.trim();
  const selected = hasSelection(input.selection);
  const mentions = parseChapterDirections(message, input.chapters);
  const namedId = namedPassageId(message);
  const open = input.openChapter;
  const byNum = new Map(input.chapters.map((c) => [c.number, c]));

  let sourceChapter =
    mentions.source ??
    (namedId ? parsePassageId(namedId)?.chapter ?? null : null) ??
    null;
  let destChapter = mentions.dest ?? null;

  if (sourceChapter == null || destChapter == null) {
    const rest = mentions.all.filter(
      (n) => n !== sourceChapter && n !== destChapter
    );
    if (sourceChapter == null && destChapter == null && rest.length >= 2) {
      sourceChapter = rest[0];
      destChapter = rest[1];
    } else if (sourceChapter == null && rest.length === 1) {
      if (selected || namedId) destChapter = destChapter ?? rest[0];
      else if (THROUGHLINE_RE.test(message)) sourceChapter = rest[0];
      else if (open != null && rest[0] !== open) destChapter = rest[0];
      else sourceChapter = rest[0];
    } else if (destChapter == null && rest.length === 1 && rest[0] !== sourceChapter) {
      destChapter = rest[0];
    }
  }

  if (sourceChapter == null) sourceChapter = open;
  if (destChapter != null && destChapter === sourceChapter) {
    // "clean up chapter 2" with no dest
    destChapter = null;
  }

  const source = sourceChapter != null ? byNum.get(sourceChapter) : undefined;
  const dest = destChapter != null ? byNum.get(destChapter) : undefined;

  const reasons: string[] = [];
  const targeted = Boolean(selected || namedId);
  const throughline = THROUGHLINE_RE.test(message);
  const wantSeam = SEAM_RE.test(message);
  const wantEnd = END_RE.test(message);

  let kind: ReorgKind;
  let sourceRead: ReadStrategy;
  let destRead: ReadStrategy;
  let destPlacement: DestPlacement;
  let loop: boolean;

  if (targeted) {
    kind = "targeted";
    sourceRead = "skip";
    loop = false;
    reasons.push(
      selected
        ? "Author highlighted the passage - move that, do not reread the source chapter."
        : `Author named ${namedId} - move that id, do not reread the source chapter.`
    );
  } else if (isBlob(source) && (throughline || looksLikeReorg(message))) {
    kind = "full_read";
    sourceRead = "full_read";
    loop = true;
    reasons.push(
      `Chapter ${sourceChapter} is one block (${source?.paragraphCount ?? 0} paragraphs, no useful scene breaks). Scene gists are not enough to judge the throughline - read it once, then move ranges by id.`
    );
  } else if (isSceneRich(source) && (throughline || looksLikeReorg(message))) {
    kind = "index_loop";
    sourceRead = "index";
    loop = true;
    reasons.push(
      `Chapter ${sourceChapter} has ${source?.sceneCount} scenes. Judge from the scene index and plot.md; only read a chapter if a gist is too thin.`
    );
  } else if (looksLikeReorg(message)) {
    kind = "index_loop";
    sourceRead = "index";
    loop = true;
    reasons.push("Rearrange from the passage index first.");
  } else {
    return {
      kind: "not_reorg",
      sourceChapter,
      destChapter,
      sourceRead: "skip",
      destRead: "skip",
      destPlacement: "ask",
      loop: false,
      reasons: [],
      instructions: "",
    };
  }

  if (destChapter == null) {
    destPlacement = "ask";
    destRead = "skip";
    reasons.push(
      "No destination chapter named. If plot.md makes the home obvious, use it; otherwise ask which chapter - one question."
    );
  } else if (wantEnd || (targeted && !wantSeam)) {
    destPlacement = "end";
    destRead = "skip";
    reasons.push(
      `Park at the end of chapter ${destChapter}. No need to read that chapter to find a seam.`
    );
  } else if (wantSeam && isBlob(dest)) {
    destPlacement = "seam";
    destRead = "full_read";
    reasons.push(
      `Chapter ${destChapter} has no useful scene breaks. Read it once to pick a seam.`
    );
  } else if (wantSeam) {
    destPlacement = "seam";
    destRead = isSceneRich(dest) ? "index" : "full_read";
    reasons.push(
      destRead === "index"
        ? `Chapter ${destChapter} has ${dest?.sceneCount} scenes - pick after/before from the index.`
        : `Read chapter ${destChapter} once to pick a seam.`
    );
  } else if (throughline && isSceneRich(dest)) {
    destPlacement = "seam";
    destRead = "index";
    reasons.push(
      `Chapter ${destChapter} has ${dest?.sceneCount} scenes - match from the index, or use position end if nothing fits.`
    );
  } else {
    destPlacement = "end";
    destRead = "skip";
    reasons.push(
      `Move into chapter ${destChapter} at the end unless a scene gist is an obvious match.`
    );
  }

  const instructions = formatInstructions({
    kind,
    sourceChapter,
    destChapter,
    sourceRead,
    destRead,
    destPlacement,
    loop,
    namedId,
    selected,
  });

  return {
    kind,
    sourceChapter,
    destChapter,
    sourceRead,
    destRead,
    destPlacement,
    loop,
    reasons,
    instructions,
  };
}

function formatInstructions(p: {
  kind: ReorgKind;
  sourceChapter: number | null;
  destChapter: number | null;
  sourceRead: ReadStrategy;
  destRead: ReadStrategy;
  destPlacement: DestPlacement;
  loop: boolean;
  namedId: string | null;
  selected: boolean;
}): string {
  const lines: string[] = [];
  const src = p.sourceChapter != null ? `chapter ${p.sourceChapter}` : "the open chapter";
  const dst =
    p.destChapter != null ? `chapter ${p.destChapter}` : "a chapter the author names";

  if (p.kind === "targeted") {
    lines.push(
      `TARGETED MOVE. Source is the ${p.selected ? "selected text" : `named id ${p.namedId}`}. Do not call read_chapter on ${src}.`
    );
    lines.push(
      `move_text: ${p.selected ? "text = the selection (quote fallback is fine for a unique passage)" : `from = ${p.namedId}`}.`
    );
  } else if (p.kind === "index_loop") {
    lines.push(
      `INDEX LOOP. Call survey_structure on ${src}${p.destChapter != null ? ` and chapter ${p.destChapter}` : ""}. Do not read_chapter unless a gist is too thin to judge.`
    );
    lines.push(
      "Prefer whole scenes (chN.sK). If a scene is mixed, move a paragraph range, not one paragraph at a time."
    );
  } else {
    lines.push(
      `FULL READ of ${src} once (read_chapter). Identify the clumps that do not belong, then move by id. Do not quote prose in move_text.`
    );
    lines.push(
      "Prefer whole scenes. If mixed, use paragraph ranges (chN.pA-pB)."
    );
  }

  if (p.destPlacement === "ask") {
    lines.push(
      "Destination unknown. If plot.md / the chapter index makes the home obvious, go there; otherwise ask which chapter - one question - then move."
    );
  } else if (p.destPlacement === "end") {
    lines.push(`Destination: ${dst}, position end. Do not read that chapter to place it.`);
  } else if (p.destRead === "full_read") {
    lines.push(`Destination: ${dst}. Read it once, then after/before a passage id.`);
  } else {
    lines.push(
      `Destination: ${dst}. Use survey_structure / list_passages to pick after: chN.sK (or position end if nothing matches).`
    );
  }

  if (p.loop) {
    lines.push(
      "LOOP: one move_text per clump, then survey_structure again (ids shift). Never fire two move_text calls against the same chapter in one turn."
    );
  }

  lines.push(
    "Tell the author what you moved (scene/paragraph ids + destination), in one short report. If a move comes back NOT FOUND, stop and say so - do not claim it worked."
  );
  return lines.join("\n");
}

export function formatReorgPlan(plan: ReorgPlan): string {
  if (plan.kind === "not_reorg") return "";
  const label =
    plan.kind === "targeted"
      ? "targeted move (no full-chapter read)"
      : plan.kind === "index_loop"
        ? "index loop (pick from scene list, move one at a time)"
        : "full read once, then move by id";
  return [
    `# REORG PLAN - ${label}`,
    "Computed from the author's request and chapter shape. Follow it unless you have a concrete reason not to (say the reason in one line). Do not ignore it to be more thorough.",
    "",
    plan.instructions,
    "",
    plan.reasons.map((r) => `- ${r}`).join("\n"),
  ].join("\n");
}

export async function loadChapterShapes(
  projectId: string
): Promise<ChapterShape[]> {
  const chapters = await prisma.chapter.findMany({
    where: { projectId },
    orderBy: { order: "asc" },
  });
  return chapters.map((ch, i) => {
    const n = i + 1;
    const indexed = indexChapter(ch.content, n);
    return {
      number: n,
      title: ch.title,
      revision: ch.revision,
      wordCount: ch.wordCount,
      sceneCount: indexed.scenes.length,
      paragraphCount: indexed.paragraphs.length,
      index: formatSceneIndex(indexed),
    };
  });
}

export async function buildReorgPlan(opts: {
  projectId: string;
  message: string;
  selection?: string;
  activeChapterId?: string | null;
}): Promise<ReorgPlan> {
  if (!looksLikeReorg(opts.message, opts.selection)) {
    return {
      kind: "not_reorg",
      sourceChapter: null,
      destChapter: null,
      sourceRead: "skip",
      destRead: "skip",
      destPlacement: "ask",
      loop: false,
      reasons: [],
      instructions: "",
    };
  }
  const chapters = await loadChapterShapes(opts.projectId);
  const rows = await prisma.chapter.findMany({
    where: { projectId: opts.projectId },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  const openIdx = rows.findIndex((c) => c.id === opts.activeChapterId);
  return decideReorg({
    message: opts.message,
    selection: opts.selection,
    openChapter: openIdx >= 0 ? openIdx + 1 : null,
    chapters,
  });
}

export function formatSurvey(opts: {
  plan: ReorgPlan;
  shapes: ChapterShape[];
  sourceChapter?: number | null;
  destChapter?: number | null;
}): string {
  const parts: string[] = [];
  const srcN = opts.sourceChapter ?? opts.plan.sourceChapter;
  const dstN = opts.destChapter ?? opts.plan.destChapter;
  const show = (n: number | null | undefined, label: string) => {
    if (n == null) return;
    const ch = opts.shapes.find((s) => s.number === n);
    if (!ch) {
      parts.push(`${label}: no chapter ${n}.`);
      return;
    }
    parts.push(
      `## ${label}: ${n}. ${ch.title} (revision ${ch.revision}, ${ch.wordCount}w, ${ch.sceneCount} scene${
        ch.sceneCount === 1 ? "" : "s"
      }, ${ch.paragraphCount} paragraphs)`
    );
    parts.push(ch.index || "(empty)");
  };
  show(srcN, "SOURCE");
  if (dstN != null && dstN !== srcN) show(dstN, "DESTINATION");
  const planBlock = formatReorgPlan({
    ...opts.plan,
    sourceChapter: srcN ?? opts.plan.sourceChapter,
    destChapter: dstN ?? opts.plan.destChapter,
  });
  if (planBlock) parts.push("\n" + planBlock);
  return parts.join("\n") || "(no chapters)";
}

