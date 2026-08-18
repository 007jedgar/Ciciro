import { countWords, htmlToText } from "@/lib/text";

// Addressable units for the manuscript. The editor points at ids
// (ch3.s2, ch3.p12-p18); tools copy HTML bytes. Quote matching is fallback.
//
// IDs are valid for the current chapter snapshot and shift after a structural
// edit - list_passages (or the index returned by move_text) refreshes them.
// Scene breaks match export: a lone # or * line (see docx.ts).

export type HtmlBlock = {
  start: number;
  end: number;
  text: string;
  index: number;
};

export type PassageId = {
  raw: string;
  chapter: number;
  kind: "scene" | "paragraphs";
  from: number;
  to: number;
};

export type Passage = {
  id: string;
  kind: "scene" | "paragraph";
  gist: string;
  wordCount: number;
  startIdx: number;
  endIdx: number;
  start: number;
  end: number;
  fromPara: number;
  toPara: number;
};

export type BlockRun = {
  startIdx: number;
  endIdx: number;
  start: number;
  end: number;
};

export type ResolveOk = BlockRun & {
  id: string;
  wordCount: number;
  gist: string;
};

export type PassageDeletion = {
  content: string;
  deletedHtml: string;
  passage: ResolveOk;
  index: ChapterPassages;
};

export type ChapterSplit = {
  sourceContent: string;
  destinationContent: string;
  boundary: string;
  sourceIndex: ChapterPassages;
  destinationIndex: ChapterPassages;
};

export type ChapterPassages = {
  chapterNumber: number;
  blocks: HtmlBlock[];
  scenes: Passage[];
  paragraphs: Passage[];
};

const ID_RE =
  /^ch(\d+)\.(s(\d+)(?:-s(\d+))?|p(\d+)(?:-p(\d+))?)$/i;

export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Normalize prose for duplicate checks without depending on stored HTML bytes. */
export function normalizePassageComparison(s: string): string {
  return normalizeWhitespace(htmlToText(s))
    .normalize("NFKC")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .toLocaleLowerCase();
}

export function isSceneBreak(text: string): boolean {
  return /^[#*]{1,3}$/.test(normalizeWhitespace(text));
}

export function isPassageId(raw: string): boolean {
  return ID_RE.test(raw.trim());
}

export function parsePassageId(raw: string): PassageId | null {
  const m = raw.trim().match(ID_RE);
  if (!m) return null;
  const chapter = Number(m[1]);
  if (m[3] != null) {
    const from = Number(m[3]);
    const to = m[4] != null ? Number(m[4]) : from;
    if (to < from) return null;
    return { raw: raw.trim(), chapter, kind: "scene", from, to };
  }
  const from = Number(m[5]);
  const to = m[6] != null ? Number(m[6]) : from;
  if (to < from) return null;
  return { raw: raw.trim(), chapter, kind: "paragraphs", from, to };
}

export function formatPassageId(id: PassageId): string {
  if (id.kind === "scene") {
    return id.from === id.to
      ? `ch${id.chapter}.s${id.from}`
      : `ch${id.chapter}.s${id.from}-s${id.to}`;
  }
  return id.from === id.to
    ? `ch${id.chapter}.p${id.from}`
    : `ch${id.chapter}.p${id.from}-p${id.to}`;
}

export function gist(text: string, max = 88): string {
  const flat = normalizeWhitespace(text);
  if (!flat) return "(empty)";
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1) + "...";
}

export function getBlocks(html: string): HtmlBlock[] {
  const re =
    /<(p|h[1-6]|li|blockquote)\b[^>]*>[\s\S]*?<\/\1>|<hr\b[^>]*\/?>/gi;
  const blocks: HtmlBlock[] = [];
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = re.exec(html))) {
    const raw = m[0];
    const isHr = /^<hr/i.test(raw);
    blocks.push({
      start: m.index,
      end: m.index + raw.length,
      text: isHr ? "#" : normalizeWhitespace(htmlToText(raw)),
      index,
    });
    index++;
  }
  return blocks;
}

function findParas(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => normalizeWhitespace(p))
    .filter(Boolean);
}

/** Match a contiguous run of top-level blocks by plain text. */
export function findBlockRun(html: string, find: string): BlockRun | null {
  const paras = findParas(find);
  if (paras.length === 0) return null;
  const blocks = getBlocks(html);
  for (let i = 0; i + paras.length <= blocks.length; i++) {
    let matches = true;
    for (let j = 0; j < paras.length; j++) {
      if (blocks[i + j].text !== paras[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return {
        startIdx: i,
        endIdx: i + paras.length - 1,
        start: blocks[i].start,
        end: blocks[i + paras.length - 1].end,
      };
    }
  }
  return null;
}

/**
 * Quote fallback: exact block run, then a unique substring inside a single
 * block (or a unique contiguous run of blocks that each contain it). Multiple
 * hits return an error listing candidate ids so the model can pick one.
 */
export function findByQuote(
  html: string,
  chapterNumber: number,
  quote: string
): { run: BlockRun } | { error: string } {
  const exact = findBlockRun(html, quote);
  if (exact) return { run: exact };

  const needle = normalizeWhitespace(quote);
  if (!needle) return { error: "Empty quote." };

  const indexed = indexChapter(html, chapterNumber);
  const containing = indexed.paragraphs.filter((p) =>
    indexed.blocks[p.startIdx].text.includes(needle)
  );
  if (containing.length === 1) {
    const p = containing[0];
    return {
      run: {
        startIdx: p.startIdx,
        endIdx: p.endIdx,
        start: p.start,
        end: p.end,
      },
    };
  }
  if (containing.length > 1) {
    const ids = containing
      .slice(0, 8)
      .map((p) => `${p.id} (${p.gist})`)
      .join("; ");
    return {
      error: `Quote matched ${containing.length} paragraphs. Use a passage id instead: ${ids}`,
    };
  }

  const sceneHits = indexed.scenes.filter((s) => {
    const full = htmlToText(html.slice(s.start, s.end));
    return normalizeWhitespace(full).includes(needle);
  });
  if (sceneHits.length === 1) {
    const s = sceneHits[0];
    return {
      run: {
        startIdx: s.startIdx,
        endIdx: s.endIdx,
        start: s.start,
        end: s.end,
      },
    };
  }
  if (sceneHits.length > 1) {
    return {
      error: `Quote matched ${sceneHits.length} scenes. Use a passage id: ${sceneHits
        .map((s) => s.id)
        .join(", ")}`,
    };
  }

  return {
    error: `Passage not found in chapter ${chapterNumber}. Call list_passages and pass from: ch${chapterNumber}.sK (do not quote the prose).`,
  };
}

export function indexChapter(
  html: string,
  chapterNumber: number
): ChapterPassages {
  const blocks = getBlocks(html);
  const paragraphs: Passage[] = [];
  const paraNumberByBlock: number[] = new Array(blocks.length).fill(0);

  let pNum = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i].text || isSceneBreak(blocks[i].text)) continue;
    pNum += 1;
    paraNumberByBlock[i] = pNum;
    paragraphs.push({
      id: `ch${chapterNumber}.p${pNum}`,
      kind: "paragraph",
      gist: gist(blocks[i].text),
      wordCount: countWords(blocks[i].text),
      startIdx: i,
      endIdx: i,
      start: blocks[i].start,
      end: blocks[i].end,
      fromPara: pNum,
      toPara: pNum,
    });
  }

  const scenes: Passage[] = [];
  const breakIdxs: number[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (isSceneBreak(blocks[i].text)) breakIdxs.push(i);
  }

  const ranges: { startIdx: number; endIdx: number }[] = [];
  if (blocks.length === 0) {
    // empty
  } else if (breakIdxs.length === 0) {
    ranges.push({ startIdx: 0, endIdx: blocks.length - 1 });
  } else {
    if (breakIdxs[0] > 0) {
      ranges.push({ startIdx: 0, endIdx: breakIdxs[0] - 1 });
    }
    for (let b = 0; b < breakIdxs.length; b++) {
      const startIdx = breakIdxs[b];
      const endIdx =
        b + 1 < breakIdxs.length ? breakIdxs[b + 1] - 1 : blocks.length - 1;
      ranges.push({ startIdx, endIdx });
    }
  }

  for (let s = 0; s < ranges.length; s++) {
    const { startIdx, endIdx } = ranges[s];
    const slice = blocks.slice(startIdx, endIdx + 1);
    const prose = slice.filter((bl) => bl.text && !isSceneBreak(bl.text));
    const firstPara = paraNumberByBlock[prose[0] ? prose[0].index : startIdx] || 0;
    let lastPara = firstPara;
    for (const bl of prose) {
      const n = paraNumberByBlock[bl.index];
      if (n) lastPara = n;
    }
    const words = prose.reduce((n, bl) => n + countWords(bl.text), 0);
    scenes.push({
      id: `ch${chapterNumber}.s${s + 1}`,
      kind: "scene",
      gist: gist(prose[0]?.text || "(scene break)"),
      wordCount: words,
      startIdx,
      endIdx,
      start: blocks[startIdx].start,
      end: blocks[endIdx].end,
      fromPara: firstPara,
      toPara: lastPara,
    });
  }

  return { chapterNumber, blocks, scenes, paragraphs };
}

export function resolvePassageId(
  html: string,
  expectedChapter: number,
  raw: string
): ResolveOk | { error: string } {
  const parsed = parsePassageId(raw);
  if (!parsed) {
    return {
      error: `Not a passage id: "${raw}". Use ch${expectedChapter}.s2 or ch${expectedChapter}.p12-p18.`,
    };
  }
  if (parsed.chapter !== expectedChapter) {
    return {
      error: `${formatPassageId(parsed)} belongs to chapter ${parsed.chapter}, not ${expectedChapter}.`,
    };
  }

  const indexed = indexChapter(html, expectedChapter);
  if (parsed.kind === "scene") {
    if (parsed.from < 1 || parsed.to > indexed.scenes.length) {
      return {
        error: `${formatPassageId(parsed)} is out of range (chapter ${expectedChapter} has ${indexed.scenes.length} scene${
          indexed.scenes.length === 1 ? "" : "s"
        }).`,
      };
    }
    const first = indexed.scenes[parsed.from - 1];
    const last = indexed.scenes[parsed.to - 1];
    const words = indexed.scenes
      .slice(parsed.from - 1, parsed.to)
      .reduce((n, s) => n + s.wordCount, 0);
    return {
      id: formatPassageId(parsed),
      gist: first.gist,
      wordCount: words,
      startIdx: first.startIdx,
      endIdx: last.endIdx,
      start: first.start,
      end: last.end,
    };
  }

  const byNum = new Map(indexed.paragraphs.map((p) => [p.fromPara, p]));
  const first = byNum.get(parsed.from);
  const last = byNum.get(parsed.to);
  if (!first || !last) {
    return {
      error: `${formatPassageId(parsed)} is out of range (chapter ${expectedChapter} has ${indexed.paragraphs.length} paragraph${
        indexed.paragraphs.length === 1 ? "" : "s"
      }).`,
    };
  }
  const words = indexed.paragraphs
    .filter((p) => p.fromPara >= parsed.from && p.fromPara <= parsed.to)
    .reduce((n, p) => n + p.wordCount, 0);
  return {
    id: formatPassageId(parsed),
    gist: first.gist,
    wordCount: words,
    startIdx: first.startIdx,
    endIdx: last.endIdx,
    start: first.start,
    end: last.end,
  };
}

export function resolveSource(
  html: string,
  chapterNumber: number,
  spec: { from?: string; text?: string }
): ResolveOk | { error: string } {
  const from = spec.from?.trim() || "";
  const text = spec.text?.trim() || "";
  if (from) {
    const byId = resolvePassageId(html, chapterNumber, from);
    if ("error" in byId) return byId;
    return byId;
  }
  if (!text) {
    return {
      error: `Provide from (a passage id like ch${chapterNumber}.s2) or text (quote fallback).`,
    };
  }
  const quoted = findByQuote(html, chapterNumber, text);
  if ("error" in quoted) return quoted;
  const indexed = indexChapter(html, chapterNumber);
  const covering = indexed.scenes.find(
    (s) => s.startIdx <= quoted.run.startIdx && s.endIdx >= quoted.run.endIdx
  );
  const paras = indexed.paragraphs.filter(
    (p) => p.startIdx >= quoted.run.startIdx && p.endIdx <= quoted.run.endIdx
  );
  const id =
    covering &&
    covering.startIdx === quoted.run.startIdx &&
    covering.endIdx === quoted.run.endIdx
      ? covering.id
      : paras.length
        ? paras[0].fromPara === paras[paras.length - 1].fromPara
          ? paras[0].id
          : `ch${chapterNumber}.p${paras[0].fromPara}-p${paras[paras.length - 1].fromPara}`
        : `ch${chapterNumber} (quoted)`;
  const words = paras.reduce((n, p) => n + p.wordCount, 0);
  return {
    ...quoted.run,
    id,
    gist: paras[0]?.gist || covering?.gist || gist(text),
    wordCount: words,
  };
}

/** Delete one resolved scene/paragraph range from a chapter snapshot. */
export function deletePassageRange(
  html: string,
  chapterNumber: number,
  passageId: string
): PassageDeletion | { error: string } {
  const passage = resolvePassageId(html, chapterNumber, passageId);
  if ("error" in passage) return passage;
  const deletedHtml = html.slice(passage.start, passage.end);
  const content = html.slice(0, passage.start) + html.slice(passage.end);
  return {
    content,
    deletedHtml,
    passage,
    index: indexChapter(content, chapterNumber),
  };
}

/**
 * Split a boundary token out of the top-level block that contains it. Both
 * halves retain the original block wrapper, which makes fused text such as
 * `<p>SurgeonCHAPTER 2Opening...</p>` safe to divide.
 */
export function splitChapterHtmlAt(
  html: string,
  boundary: string,
  sourceChapterNumber: number,
  destinationChapterNumber: number
): ChapterSplit | { error: string } {
  const marker = boundary.trim();
  if (!marker) return { error: "Boundary text is required." };
  if (/[<>]/.test(marker)) {
    return { error: "Boundary must be plain text, not HTML." };
  }

  const candidates: { block: HtmlBlock; offset: number }[] = [];
  for (const block of getBlocks(html)) {
    const raw = html.slice(block.start, block.end);
    if (/^<hr/i.test(raw)) continue;
    let from = 0;
    while (from <= raw.length) {
      const offset = raw.indexOf(marker, from);
      if (offset === -1) break;
      candidates.push({ block, offset });
      from = offset + marker.length;
    }
  }
  if (candidates.length !== 1) {
    return {
      error:
        candidates.length === 0
          ? `Boundary "${marker}" was not found in a top-level text block.`
          : `Boundary "${marker}" matched ${candidates.length} locations; provide a unique boundary.`,
    };
  }

  const { block, offset } = candidates[0];
  const raw = html.slice(block.start, block.end);
  const opening = raw.match(/^<([a-z][\w-]*)\b[^>]*>/i)?.[0];
  const closing = raw.match(/<\/([a-z][\w-]*)>\s*$/i)?.[0];
  if (!opening || !closing) {
    return { error: "Boundary block could not be split safely." };
  }
  const innerStart = opening.length;
  const innerEnd = raw.length - closing.length;
  if (offset < innerStart || offset + marker.length > innerEnd) {
    return { error: "Boundary matched markup rather than chapter prose." };
  }

  const leftInner = raw.slice(innerStart, offset);
  const rightInner = raw.slice(offset + marker.length, innerEnd);
  const keepBlock = (inner: string) => {
    const wrapped = opening + inner + closing;
    return normalizeWhitespace(htmlToText(wrapped)) ? wrapped : "";
  };
  const sourceContent =
    html.slice(0, block.start) + keepBlock(leftInner);
  const destinationContent =
    keepBlock(rightInner) + html.slice(block.end);

  return {
    sourceContent,
    destinationContent,
    boundary: marker,
    sourceIndex: indexChapter(sourceContent, sourceChapterNumber),
    destinationIndex: indexChapter(destinationContent, destinationChapterNumber),
  };
}

/** Count normalized, non-overlapping occurrences of a passage in one chapter. */
export function countPassageOccurrences(chapterHtml: string, passage: string): number {
  const haystack = normalizePassageComparison(chapterHtml);
  const needle = normalizePassageComparison(passage);
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from <= haystack.length) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

export function formatSceneIndex(
  passages: ChapterPassages,
  opts?: { paragraphs?: boolean; paraCap?: number }
): string {
  const { scenes, paragraphs, chapterNumber } = passages;
  if (!scenes.length && !paragraphs.length) {
    return `(chapter ${chapterNumber} is empty)`;
  }
  const lines: string[] = [];
  for (const s of scenes) {
    const span =
      s.fromPara && s.toPara
        ? s.fromPara === s.toPara
          ? `p${s.fromPara}`
          : `p${s.fromPara}-p${s.toPara}`
        : "";
    lines.push(
      `- ${s.id} (${s.wordCount}w${span ? `, ${span}` : ""}) ${s.gist}`
    );
  }
  if (opts?.paragraphs && paragraphs.length) {
    const cap = opts.paraCap ?? paragraphs.length;
    const show =
      paragraphs.length <= cap
        ? paragraphs
        : [
            ...paragraphs.slice(0, Math.ceil(cap / 2)),
            ...paragraphs.slice(paragraphs.length - Math.floor(cap / 2)),
          ];
    if (paragraphs.length > cap) {
      lines.push(
        `(${paragraphs.length} paragraphs; showing first and last. list_passages chapter ${chapterNumber} for all.)`
      );
    }
    let skipped = false;
    for (const p of paragraphs) {
      if (!show.includes(p)) {
        if (!skipped) {
          lines.push("- ...");
          skipped = true;
        }
        continue;
      }
      skipped = false;
      lines.push(`- ${p.id} (${p.wordCount}w) ${p.gist}`);
    }
  }
  return lines.join("\n");
}

/** Scene-boundary annotations so the model can address without quoting. */
export function renderAnnotatedChapter(
  html: string,
  chapterNumber: number,
  title?: string
): string {
  const indexed = indexChapter(html, chapterNumber);
  const head = title ? `# ${title}\n\n` : "";
  if (!indexed.scenes.length) {
    return `${head}(empty)`;
  }
  const parts: string[] = [];
  for (const s of indexed.scenes) {
    const body = htmlToText(html.slice(s.start, s.end)) || "(empty)";
    parts.push(`[${s.id} · ${s.wordCount}w]\n${body}`);
  }
  return head + parts.join("\n\n");
}

export function compactOpenChapterIndex(
  html: string,
  chapterNumber: number
): string {
  const indexed = indexChapter(html, chapterNumber);
  const manyParas = indexed.paragraphs.length > 24;
  const singleScene = indexed.scenes.length <= 1;
  return formatSceneIndex(indexed, {
    paragraphs: singleScene,
    paraCap: manyParas ? 8 : 24,
  });
}
