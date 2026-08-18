import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, DRAFTER_MODEL, DRAFTER_FAST_MODEL } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import {
  listBible,
  readBibleFile,
  writeBibleFile,
  appendCanon,
} from "@/lib/bible";
import { DRAFTER_SYSTEM } from "@/lib/prompts";
import { htmlToText, countWords } from "@/lib/text";
import {
  countPassageOccurrences,
  deletePassageRange,
  findBlockRun,
  formatSceneIndex,
  indexChapter,
  isPassageId,
  parsePassageId,
  renderAnnotatedChapter,
  resolvePassageId,
  resolveSource,
  splitChapterHtmlAt,
} from "@/lib/passages";
import {
  decideReorg,
  formatSurvey,
  loadChapterShapes,
} from "@/lib/reorg";
import { backstageLine } from "@/lib/backstage";
import { runRanker } from "@/lib/fast-lane";
import type { ClientUiEvent } from "@/lib/types";

export type { ClientUiEvent };

// Tool definitions the editor (Opus) can call. The author never invokes these;
// the editor uses them to retrieve context, capture decisions, and dispatch prose
// to the lighter drafting model.
export const EDITOR_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_bible",
    description:
      "List every story-bible file with a one-line summary. Use to find which file holds what before reading it.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "read_bible",
    description:
      "Read a story-bible file in full (e.g. 'characters/mara.md', 'world.md'). Use when a task needs details beyond the always-loaded canon/plot/style.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Bible-relative path, ending in .md" },
      },
      required: ["path"],
    },
  },
  {
    name: "read_chapter",
    description:
      "Read a chapter by its 1-based number. Returns scene-annotated plain text ([chN.sK] markers) so you can address passages without quoting them. Use to check continuity; use list_passages when you only need the index.",
    input_schema: {
      type: "object",
      properties: {
        number: { type: "integer", description: "1-based chapter number" },
      },
      required: ["number"],
    },
  },
  {
    name: "list_passages",
    description:
      "Index of addressable passages in a chapter: scene ids (chN.sK) and paragraph ids (chN.pA). Each line is id, word count, and a one-line gist. For rearrange/move tasks prefer survey_structure, which returns indexes plus a read-vs-loop plan. IDs shift after a move.",
    input_schema: {
      type: "object",
      properties: {
        chapterNumber: {
          type: "integer",
          description:
            "1-based chapter number. Omit to list scenes for every chapter.",
        },
      },
    },
  },
  {
    name: "delete_passages",
    description:
      "Delete one inclusive scene or paragraph range by passage id. Requires the revision returned by read_chapter/list_passages and rejects stale addresses without changing the chapter.",
    input_schema: {
      type: "object",
      properties: {
        passageId: {
          type: "string",
          description: "Range such as ch3.s2-s4 or ch3.p12-p18",
        },
        expectedRevision: {
          type: "integer",
          description: "Current chapter revision from the latest read/index",
        },
      },
      required: ["passageId", "expectedRevision"],
    },
  },
  {
    name: "split_chapter_at",
    description:
      "Preview or atomically split a fused inline chapter boundary out of a source chapter. The plain-text boundary token is removed; prose before it remains in source and prose after it is prepended to the destination. Existing destinations require their current revision.",
    input_schema: {
      type: "object",
      properties: {
        sourceChapter: { type: "integer", description: "1-based source chapter" },
        destinationChapter: {
          type: "integer",
          description:
            "1-based destination. May be the next existing chapter or one past the final chapter to create it.",
        },
        boundary: {
          type: "string",
          description: "Unique plain-text marker to remove, for example CHAPTER 2",
        },
        expectedSourceRevision: {
          type: "integer",
          description: "Current source revision",
        },
        expectedDestinationRevision: {
          type: "integer",
          description: "Current destination revision; required when it already exists",
        },
        destinationTitle: {
          type: "string",
          description: "Title when creating a new final chapter",
        },
        dryRun: {
          type: "boolean",
          description: "If true, report the split without writing either chapter",
        },
      },
      required: [
        "sourceChapter",
        "destinationChapter",
        "boundary",
        "expectedSourceRevision",
      ],
    },
  },
  {
    name: "passage_exists",
    description:
      "Count chapter-scoped occurrences of prose after normalizing HTML, whitespace, Unicode punctuation, and case. Use before/after moves to detect duplicates, missing passages, or an already-satisfied state.",
    input_schema: {
      type: "object",
      properties: {
        chapterNumber: { type: "integer", description: "1-based chapter number" },
        passage: {
          type: "string",
          description: "Plain text or passage HTML to compare",
        },
      },
      required: ["chapterNumber", "passage"],
    },
  },
  {
    name: "survey_structure",
    description:
      "Before rearranging: return the current passage index for a source (and optional destination) chapter PLUS a plan - targeted move, index loop, or one full read. Follow the plan: do not read_chapter unless it says full_read. Call again after each move_text (ids shift). Never parallelize moves in the same chapter.",
    input_schema: {
      type: "object",
      properties: {
        sourceChapter: {
          type: "integer",
          description: "1-based source chapter (defaults to the open chapter)",
        },
        destChapter: {
          type: "integer",
          description: "1-based destination chapter, if moving across chapters",
        },
        intent: {
          type: "string",
          description:
            "The author's request, or a short restatement (e.g. 'park selection at end of ch 5'). Used to pick the plan.",
        },
      },
    },
  },
  {
    name: "search_manuscript",
    description:
      "Search the whole manuscript for a word or phrase. Returns matching snippets with their chapter. Use to find where something was set up or last mentioned.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Word or phrase to find" },
      },
      required: ["query"],
    },
  },
  {
    name: "append_canon",
    description:
      "Record a durable author ruling or established fact to canon.md so it is never lost. Use whenever the author establishes or changes a fact, rule, or character truth.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "The fact or ruling, one sentence" },
      },
      required: ["note"],
    },
  },
  {
    name: "update_bible",
    description:
      "Overwrite a story-bible file with new content (e.g. update a character's Voice section or plot.md open loops). Read it first if you are editing, not replacing.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Bible-relative path, ending in .md" },
        content: { type: "string", description: "Full new file contents (markdown)" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "raise_question",
    description:
      "Log a standing question you did NOT stop to ask - a fork you resolved provisionally so you could keep writing. Record the question, what you went with, and where it lands. Do this instead of blocking on the author.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The open question" },
        provisional: {
          type: "string",
          description: "What you assumed / wrote so you could continue",
        },
        affects: {
          type: "string",
          description: "Where it lands (chapter, passage, character, bible file)",
        },
        chapterNumber: {
          type: "integer",
          description: "Primary affected chapter number, if one",
        },
      },
      required: ["question", "provisional"],
    },
  },
  {
    name: "list_open_questions",
    description:
      "List the currently open questions with their provisional answers, so you stay consistent with your own earlier choices and can reconcile when the author answers one.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "resolve_question",
    description:
      "Mark an open question resolved once the author has answered it. Call this AFTER you have made any needed corrections to the manuscript and bible. Record the answer and what you changed.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The open question id" },
        answer: { type: "string", description: "The author's answer" },
        resolution: {
          type: "string",
          description: "What you changed to reconcile (or 'no change needed')",
        },
      },
      required: ["id", "answer", "resolution"],
    },
  },
  {
    name: "edit_manuscript",
    description:
      "Apply precise find/replace corrections to a chapter's text - use when reconciling an answered question or when the author asks for a direct fix (e.g. a changed name or fact). Do NOT use this to rearrange or relocate passages - use move_text. For large new rewrites, hand the author a <draft> or use insert_text.",
    input_schema: {
      type: "object",
      properties: {
        chapterNumber: { type: "integer", description: "1-based chapter number" },
        expectedRevision: {
          type: "integer",
          description: "Current chapter revision from the latest read/index",
        },
        replacements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              find: { type: "string" },
              replace: { type: "string" },
            },
            required: ["find", "replace"],
          },
        },
      },
      required: ["chapterNumber", "expectedRevision", "replacements"],
    },
  },
  {
    name: "move_text",
    description:
      "Atomically cut a passage and paste it elsewhere (same chapter or another). Prefer passage ids from list_passages / the OPEN CHAPTER index: from: \"ch3.s2\", after: \"ch5.s1\". The tool copies the HTML; do not quote the prose. Quote matching (text) is a fallback only. Destination: after, before (id or short unique quote), or position start/end.",
    input_schema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description:
            "Passage id to move, e.g. ch3.s2, ch3.s2-s4, ch3.p12, ch3.p12-p18. Preferred over text.",
        },
        fromChapter: {
          type: "integer",
          description:
            "1-based chapter to cut from. Optional when `from` is an id (chapter is parsed from it). Required with `text`.",
        },
        text: {
          type: "string",
          description:
            "Quote fallback: exact passage or a unique sentence. Prefer `from` instead.",
        },
        toChapter: {
          type: "integer",
          description:
            "1-based chapter to paste into. Optional when after/before is an id (chapter is parsed from it). Defaults to the source chapter.",
        },
        expectedSourceRevision: {
          type: "integer",
          description: "Current source chapter revision from the latest read/index",
        },
        expectedDestinationRevision: {
          type: "integer",
          description:
            "Current destination revision when moving across chapters; omit for a same-chapter move",
        },
        after: {
          type: "string",
          description:
            "Paste immediately after this passage id (ch5.s1) or unique quote",
        },
        before: {
          type: "string",
          description:
            "Paste immediately before this passage id or unique quote",
        },
        position: {
          type: "string",
          enum: ["start", "end"],
          description: "Paste at chapter start or end (use when no after/before)",
        },
      },
      required: ["expectedSourceRevision"],
    },
  },
  {
    name: "insert_text",
    description:
      "Insert prose into a chapter at a precise location (after/before an anchor, or start/end) without relying on the author's cursor. Use for placing new or rewritten passages where they belong - especially in Auto mode, or when a <draft> would land in the wrong spot.",
    input_schema: {
      type: "object",
      properties: {
        chapterNumber: { type: "integer", description: "1-based chapter number" },
        expectedRevision: {
          type: "integer",
          description: "Current chapter revision from the latest read/index",
        },
        text: {
          type: "string",
          description: "Prose to insert, plain text. Separate paragraphs with a blank line.",
        },
        after: {
          type: "string",
          description:
            "Insert immediately after this passage id (ch3.s2) or unique quote",
        },
        before: {
          type: "string",
          description:
            "Insert immediately before this passage id or unique quote",
        },
        position: {
          type: "string",
          enum: ["start", "end"],
          description: "Insert at chapter start or end (use when no anchor)",
        },
      },
      required: ["chapterNumber", "expectedRevision", "text"],
    },
  },
  {
    name: "create_chapter",
    description:
      "Create a new chapter in the manuscript. Use when the story needs a new chapter break (including in Auto mode). Optionally place it after a given chapter and open it in the author's editor so subsequent drafts land there.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Chapter title (defaults to Chapter N)",
        },
        afterChapter: {
          type: "integer",
          description:
            "1-based chapter number to insert after. Omit to append at the end.",
        },
        open: {
          type: "boolean",
          description:
            "If true (default), switch the author's open chapter to the new one so Auto-mode drafts insert into it.",
        },
      },
      required: [],
    },
  },
  {
    name: "open_chapter",
    description:
      "Switch the author's open chapter in the editor. Call this before emitting a <draft> meant for a chapter other than the one currently marked OPEN - especially in Auto mode, where drafts insert into the open chapter automatically.",
    input_schema: {
      type: "object",
      properties: {
        chapterNumber: { type: "integer", description: "1-based chapter number to open" },
      },
      required: ["chapterNumber"],
    },
  },
  {
    name: "dispatch_draft",
    description:
      "Hand a complete drafting brief to the writing model and get prose back. The brief must be self-contained (POV, beat, canon constraints, voice notes, continuity excerpt, length, do-NOT list). Use for new or rewritten prose of any real length.",
    input_schema: {
      type: "object",
      properties: {
        brief: {
          type: "string",
          description: "The full, self-contained brief for the drafter.",
        },
        mode: {
          type: "string",
          enum: ["quality", "fast"],
          description: "quality = Sonnet (default), fast = Haiku for rough/bulk drafts.",
        },
      },
      required: ["brief"],
    },
  },
  {
    name: "read_blob",
    description:
      "Read the full text of a chat archive blob by id (tool_result, chat_excerpt, or transcript). Use when a stub in history points at a blob id and you need the exact wording.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ChatBlob id from a stub" },
      },
      required: ["id"],
    },
  },
  {
    name: "read_past_turn",
    description:
      "Read a past chat message by id - including soft-archived turns rolled out of the live window. Use when a stub or compact summary points at an earlier message you need verbatim.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ChatMessage id" },
      },
      required: ["id"],
    },
  },
  {
    name: "search_chat",
    description:
      "Search live and archived chat for a word or phrase. Returns matching snippets with message ids. Optional ranking hints may appear - treat them as non-binding suggestions; open what you need with read_past_turn / read_blob yourself.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Word or phrase to find" },
      },
      required: ["query"],
    },
  },
];

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function paragraphsToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// Fallback for edit_manuscript when a literal substring match fails. The
// editor composes `find` from the plain-text view of the chapter
// (read_chapter/search_manuscript both strip HTML), so a multi-paragraph
// find never appears verbatim in the stored HTML - paragraph breaks there
// are `</p><p>`, not blank lines. This matches `find` as a contiguous run of
// blocks by their plain text and splices `replace` in as new block(s).
function blockReplace(
  html: string,
  find: string,
  replace: string
): { html: string; count: number } {
  const run = findBlockRun(html, find);
  if (!run) return { html, count: 0 };
  return {
    html: html.slice(0, run.start) + paragraphsToHtml(replace) + html.slice(run.end),
    count: 1,
  };
}

type DestOpts = {
  after?: string;
  before?: string;
  position?: string;
};

type DestResolved = {
  at: number;
  start?: number;
  end?: number;
  error?: string;
};

function resolveDestination(
  html: string,
  chapterNumber: number,
  opts: DestOpts
): DestResolved {
  const after = opts.after?.trim() || "";
  const before = opts.before?.trim() || "";
  const position = opts.position === "start" || opts.position === "end" ? opts.position : "";

  const anchors = [after && "after", before && "before", position && "position"].filter(
    Boolean
  );
  if (anchors.length > 1) {
    return { at: -1, error: "Provide only one of after, before, or position." };
  }
  if (anchors.length === 0) {
    return {
      at: -1,
      error: "Provide a destination: after, before, or position (start|end).",
    };
  }

  if (position === "start") return { at: 0 };
  if (position === "end") return { at: html.length };

  const anchor = after || before;
  if (isPassageId(anchor)) {
    const run = resolvePassageId(html, chapterNumber, anchor);
    if ("error" in run) return { at: -1, error: run.error };
    return {
      at: after ? run.end : run.start,
      start: run.start,
      end: run.end,
    };
  }

  const run = findBlockRun(html, anchor);
  if (run) {
    return {
      at: after ? run.end : run.start,
      start: run.start,
      end: run.end,
    };
  }

  const quoted = resolveSource(html, chapterNumber, { text: anchor });
  if ("error" in quoted) {
    const label = after ? "after" : "before";
    return { at: -1, error: `Anchor for ${label}: ${quoted.error}` };
  }
  return {
    at: after ? quoted.end : quoted.start,
    start: quoted.start,
    end: quoted.end,
  };
}

function chapterFromIdOr(
  raw: string | undefined,
  fallback: number | null
): { n: number } | { error: string } {
  const s = raw?.trim() || "";
  if (s && isPassageId(s)) {
    const parsed = parsePassageId(s);
    if (!parsed) return { error: `Not a passage id: "${s}".` };
    if (fallback != null && fallback !== parsed.chapter) {
      return {
        error: `${parsed.raw} is in chapter ${parsed.chapter}, but chapter ${fallback} was also given.`,
      };
    }
    return { n: parsed.chapter };
  }
  if (fallback != null && Number.isFinite(fallback)) return { n: fallback };
  return { error: "Could not determine chapter." };
}

function sceneIndexReport(html: string, chapterNumber: number, title: string): string {
  const body = formatSceneIndex(indexChapter(html, chapterNumber));
  return `Chapter ${chapterNumber} (${title}) passages:\n${body}`;
}

function insertHtmlAt(html: string, insertHtml: string, at: number): string {
  if (!insertHtml) return html;
  if (at <= 0) return insertHtml + html;
  if (at >= html.length) return html + insertHtml;
  return html.slice(0, at) + insertHtml + html.slice(at);
}

export type ToolResult = {
  status: string;
  content: string;
  ui?: ClientUiEvent | ClientUiEvent[];
  /** Durable writes performed by this tool call (zero/omitted for reads and no-ops). */
  mutationCount?: number;
};

export function toolUiEvents(
  ui?: ClientUiEvent | ClientUiEvent[]
): ClientUiEvent[] {
  if (!ui) return [];
  return Array.isArray(ui) ? ui : [ui];
}

// Execute a tool call server-side. `status` is a short backstage label surfaced
// to the author; `content` is fed back to the editor model.
export async function executeEditorTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { projectId: string; activeChapterId?: string | null }
): Promise<ToolResult> {
  const { projectId } = ctx;

  switch (name) {
    case "list_bible": {
      const entries = await listBible(projectId);
      const content = entries.length
        ? entries.map((e) => `- ${e.path}: ${e.summary}`).join("\n")
        : "(bible is empty)";
      return { status: backstageLine("list_bible"), content };
    }

    case "read_bible": {
      const p = String(input.path || "");
      try {
        const text = await readBibleFile(projectId, p);
        return {
          status: backstageLine("read_bible", p),
          content: text || `(${p} is empty or does not exist)`,
        };
      } catch (e) {
        return { status: `read failed`, content: `Error: ${(e as Error).message}` };
      }
    }

    case "read_chapter": {
      const n = Number(input.number);
      const chapters = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
      const ch = chapters[n - 1];
      if (!ch) return { status: `chapter ${n} not found`, content: `No chapter ${n}.` };
      return {
        status: backstageLine("read_chapter", `ch. ${n}`),
        content:
          `Chapter revision: ${ch.revision}\n\n` +
          renderAnnotatedChapter(ch.content, n, ch.title),
      };
    }

    case "list_passages": {
      const chapters = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
      const n =
        input.chapterNumber != null && input.chapterNumber !== ""
          ? Number(input.chapterNumber)
          : null;
      if (n != null) {
        if (!Number.isFinite(n) || n < 1 || n > chapters.length) {
          return {
            status: "list failed",
            content: `No chapter ${n}.`,
          };
        }
        const ch = chapters[n - 1];
        const indexed = indexChapter(ch.content, n);
        const body = formatSceneIndex(indexed, { paragraphs: true });
        return {
          status: backstageLine("list_passages", `ch. ${n}`),
          content: `Chapter ${n} (${ch.title}), revision ${ch.revision}:\n${body}`,
        };
      }
      if (!chapters.length) {
        return { status: backstageLine("list_passages"), content: "(no chapters)" };
      }
      const parts = chapters.map((ch, i) => {
        const num = i + 1;
        return `## ${num}. ${ch.title} (revision ${ch.revision})\n${formatSceneIndex(indexChapter(ch.content, num))}`;
      });
      return {
        status: backstageLine("list_passages"),
        content: parts.join("\n\n"),
      };
    }

    case "delete_passages": {
      const passageId = String(input.passageId || "").trim();
      const parsed = parsePassageId(passageId);
      const expectedRevision = Number(input.expectedRevision);
      if (!parsed) {
        return { status: "delete failed", content: `Invalid passage id: "${passageId}".` };
      }
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        return {
          status: "delete failed",
          content: "expectedRevision must be a non-negative integer.",
        };
      }
      const chapters = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
      const chapter = chapters[parsed.chapter - 1];
      if (!chapter) {
        return {
          status: `chapter ${parsed.chapter} not found`,
          content: `No chapter ${parsed.chapter}.`,
        };
      }
      if (chapter.revision !== expectedRevision) {
        return {
          status: "revision conflict",
          content:
            `STALE REVISION: chapter ${parsed.chapter} is revision ${chapter.revision}, ` +
            `not ${expectedRevision}. No passages were deleted; read it again.`,
        };
      }
      const deletion = deletePassageRange(
        chapter.content,
        parsed.chapter,
        passageId
      );
      if ("error" in deletion) {
        return { status: "delete failed", content: deletion.error };
      }
      const wordCount = countWords(htmlToText(deletion.content));
      const committed = await prisma.$transaction(async (tx) => {
        const updated = await tx.chapter.updateMany({
          where: { id: chapter.id, revision: expectedRevision },
          data: {
            content: deletion.content,
            wordCount,
            revision: { increment: 1 },
          },
        });
        if (updated.count !== 1) return false;
        await tx.manuscriptEdit.create({
          data: { chapterId: chapter.id, find: deletion.passage.id, replace: "" },
        });
        return true;
      });
      if (!committed) {
        const current = await prisma.chapter.findUnique({ where: { id: chapter.id } });
        return {
          status: "revision conflict",
          content:
            `STALE REVISION: chapter ${parsed.chapter} changed to revision ` +
            `${current?.revision ?? "unknown"} before commit. No passages were deleted.`,
        };
      }
      const revision = expectedRevision + 1;
      return {
        status: backstageLine("delete_passages"),
        content:
          `Deleted ${deletion.passage.id} (${deletion.passage.wordCount}w) from ` +
          `chapter ${parsed.chapter}. Revision ${expectedRevision} -> ${revision}.\n\n` +
          formatSceneIndex(deletion.index, { paragraphs: true }),
        mutationCount: 1,
        ui: {
          type: "chapter_updated",
          chapterId: chapter.id,
          content: deletion.content,
          wordCount,
          revision,
        },
      };
    }

    case "passage_exists": {
      const n = Number(input.chapterNumber);
      const passage = String(input.passage || "").trim();
      if (!passage) {
        return { status: "passage check failed", content: "Passage text is required." };
      }
      const chapters = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
      const chapter = chapters[n - 1];
      if (!chapter) return { status: `chapter ${n} not found`, content: `No chapter ${n}.` };
      const count = countPassageOccurrences(chapter.content, passage);
      return {
        status: backstageLine("passage_exists", `ch. ${n}`),
        content: JSON.stringify({
          chapterNumber: n,
          chapterId: chapter.id,
          revision: chapter.revision,
          exists: count > 0,
          count,
        }),
      };
    }

    case "split_chapter_at": {
      const sourceNumber = Number(input.sourceChapter);
      const destinationNumber = Number(input.destinationChapter);
      const boundary = String(input.boundary || "").trim();
      const expectedSourceRevision = Number(input.expectedSourceRevision);
      const expectedDestinationRevision =
        input.expectedDestinationRevision == null
          ? null
          : Number(input.expectedDestinationRevision);
      const dryRun = input.dryRun === true;
      if (
        !Number.isInteger(sourceNumber) ||
        !Number.isInteger(destinationNumber) ||
        sourceNumber < 1 ||
        destinationNumber < 1 ||
        sourceNumber === destinationNumber
      ) {
        return {
          status: "split failed",
          content: "Source and destination must be different positive chapter numbers.",
        };
      }
      if (!Number.isInteger(expectedSourceRevision) || expectedSourceRevision < 0) {
        return {
          status: "split failed",
          content: "expectedSourceRevision must be a non-negative integer.",
        };
      }

      const chapters = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
      const source = chapters[sourceNumber - 1];
      const destination = chapters[destinationNumber - 1] ?? null;
      if (!source) {
        return {
          status: `chapter ${sourceNumber} not found`,
          content: `No chapter ${sourceNumber}.`,
        };
      }
      if (source.revision !== expectedSourceRevision) {
        return {
          status: "revision conflict",
          content:
            `STALE REVISION: source chapter ${sourceNumber} is revision ` +
            `${source.revision}, not ${expectedSourceRevision}. No split was applied.`,
        };
      }
      if (!destination && destinationNumber !== chapters.length + 1) {
        return {
          status: "split failed",
          content:
            `Chapter ${destinationNumber} does not exist. A split may only create ` +
            `chapter ${chapters.length + 1} at the end.`,
        };
      }
      if (
        destination &&
        (!Number.isInteger(expectedDestinationRevision) ||
          (expectedDestinationRevision as number) < 0)
      ) {
        return {
          status: "split failed",
          content: "expectedDestinationRevision is required for an existing destination.",
        };
      }
      if (
        destination &&
        destination.revision !== expectedDestinationRevision
      ) {
        return {
          status: "revision conflict",
          content:
            `STALE REVISION: destination chapter ${destinationNumber} is revision ` +
            `${destination.revision}, not ${expectedDestinationRevision}. No split was applied.`,
        };
      }

      const split = splitChapterHtmlAt(
        source.content,
        boundary,
        sourceNumber,
        destinationNumber
      );
      if ("error" in split) {
        return { status: "split failed", content: split.error };
      }
      const destinationContent =
        split.destinationContent + (destination?.content || "");
      const sourceWordCount = countWords(htmlToText(split.sourceContent));
      const destinationWordCount = countWords(htmlToText(destinationContent));
      const sourceIndex = formatSceneIndex(split.sourceIndex, { paragraphs: true });
      const destinationIndex = formatSceneIndex(
        indexChapter(destinationContent, destinationNumber),
        { paragraphs: true }
      );
      const preview =
        `Split boundary "${split.boundary}" from chapter ${sourceNumber} into ` +
        `chapter ${destinationNumber}.\n\nSOURCE AFTER:\n${sourceIndex}\n\n` +
        `DESTINATION AFTER:\n${destinationIndex}`;
      if (dryRun) {
        return {
          status: backstageLine("split_chapter_at", "dry run"),
          content:
            `DRY RUN - no chapters changed. Source revision ${source.revision}` +
            `${destination ? `; destination revision ${destination.revision}` : ""}.\n\n` +
            preview,
        };
      }

      type SplitCommit =
        | { created: false; destinationRevision: number; destinationId: string }
        | { created: true; chapter: Awaited<ReturnType<typeof prisma.chapter.create>> };
      let committed: SplitCommit;
      try {
        committed = await prisma.$transaction(async (tx) => {
          const sourceUpdate = await tx.chapter.updateMany({
            where: { id: source.id, revision: expectedSourceRevision },
            data: {
              content: split.sourceContent,
              wordCount: sourceWordCount,
              revision: { increment: 1 },
            },
          });
          if (sourceUpdate.count !== 1) throw new Error("SOURCE_REVISION_CONFLICT");

          if (destination) {
            const destinationUpdate = await tx.chapter.updateMany({
              where: {
                id: destination.id,
                revision: expectedDestinationRevision as number,
              },
              data: {
                content: destinationContent,
                wordCount: destinationWordCount,
                revision: { increment: 1 },
              },
            });
            if (destinationUpdate.count !== 1) {
              throw new Error("DESTINATION_REVISION_CONFLICT");
            }
            await tx.manuscriptEdit.createMany({
              data: [
                {
                  chapterId: source.id,
                  find: split.boundary,
                  replace: `[split to chapter ${destinationNumber}]`,
                },
                {
                  chapterId: destination.id,
                  find: "",
                  replace: `[split from chapter ${sourceNumber}]`,
                },
              ],
            });
            return {
              created: false as const,
              destinationRevision: (expectedDestinationRevision as number) + 1,
              destinationId: destination.id,
            };
          }

          const chapter = await tx.chapter.create({
            data: {
              projectId,
              title:
                String(input.destinationTitle || "").trim() ||
                `Chapter ${destinationNumber}`,
              order: chapters.length,
              content: destinationContent,
              wordCount: destinationWordCount,
            },
          });
          await tx.manuscriptEdit.create({
            data: {
              chapterId: source.id,
              find: split.boundary,
              replace: `[split to chapter ${destinationNumber}]`,
            },
          });
          return { created: true as const, chapter };
        });
      } catch (error) {
        if (
          (error as Error).message === "SOURCE_REVISION_CONFLICT" ||
          (error as Error).message === "DESTINATION_REVISION_CONFLICT"
        ) {
          const current = await prisma.chapter.findMany({
            where: { id: { in: [source.id, destination?.id || ""] } },
            select: { id: true, revision: true },
          });
          return {
            status: "revision conflict",
            content:
              "STALE REVISION during split commit. The transaction was rolled back; " +
              `current revisions: ${current
                .map((chapter) => `${chapter.id}=${chapter.revision}`)
                .join(", ")}.`,
          };
        }
        throw error;
      }

      const sourceRevision = expectedSourceRevision + 1;
      const destinationEvent: ClientUiEvent = committed.created
        ? {
            type: "chapter_created",
            chapter: {
              id: committed.chapter.id,
              projectId: committed.chapter.projectId,
              title: committed.chapter.title,
              order: committed.chapter.order,
              content: committed.chapter.content,
              summary: committed.chapter.summary,
              status: committed.chapter.status,
              wordCount: committed.chapter.wordCount,
              revision: committed.chapter.revision,
            },
            open: false,
          }
        : {
            type: "chapter_updated",
            chapterId: committed.destinationId,
            content: destinationContent,
            wordCount: destinationWordCount,
            revision: committed.destinationRevision,
          };
      return {
        status: backstageLine("split_chapter_at"),
        content:
          `${preview}\n\nCommitted source revision ${expectedSourceRevision} -> ` +
          `${sourceRevision}; destination ${
            committed.created
              ? "created at revision 0"
              : `revision ${expectedDestinationRevision} -> ${committed.destinationRevision}`
          }.`,
        mutationCount: 1,
        ui: [
          {
            type: "chapter_updated",
            chapterId: source.id,
            content: split.sourceContent,
            wordCount: sourceWordCount,
            revision: sourceRevision,
          },
          destinationEvent,
        ],
      };
    }

    case "survey_structure": {
      const shapes = await loadChapterShapes(projectId);
      const chapterRows = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
        select: { id: true },
      });
      const openNumber = ctx.activeChapterId
        ? chapterRows.findIndex((c) => c.id === ctx.activeChapterId) + 1
        : 0;
      const sourceChapter =
        input.sourceChapter != null && input.sourceChapter !== ""
          ? Number(input.sourceChapter)
          : openNumber || null;
      const destChapter =
        input.destChapter != null && input.destChapter !== ""
          ? Number(input.destChapter)
          : null;
      const intent = String(input.intent || "").trim();
      const plan = decideReorg({
        message:
          intent ||
          (destChapter
            ? `Move unrelated passages from chapter ${sourceChapter} to chapter ${destChapter}`
            : `Find misplaced passages in chapter ${sourceChapter}`),
        selection: /\bselection\b/i.test(intent) ? "(selection)" : "",
        openChapter: openNumber || null,
        chapters: shapes,
      });
      return {
        status: backstageLine("survey_structure"),
        content: formatSurvey({
          plan,
          shapes,
          sourceChapter,
          destChapter,
        }),
      };
    }

    case "search_manuscript": {
      const q = String(input.query || "").trim();
      if (!q) return { status: "search", content: "Empty query." };
      const chapters = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
      const hits: string[] = [];
      const needle = q.toLowerCase();
      for (let i = 0; i < chapters.length && hits.length < 8; i++) {
        const ch = chapters[i];
        const n = i + 1;
        const indexed = indexChapter(ch.content, n);
        for (const p of indexed.paragraphs) {
          const block = indexed.blocks[p.startIdx];
          if (!block.text.toLowerCase().includes(needle)) continue;
          const scene = indexed.scenes.find(
            (s) => s.startIdx <= p.startIdx && s.endIdx >= p.endIdx
          );
          const addr = scene ? `${p.id} in ${scene.id}` : p.id;
          hits.push(`[${addr} · ${ch.title}] ...${block.text}...`);
          if (hits.length >= 8) break;
        }
      }
      return {
        status: backstageLine("search_manuscript", `"${q}"`),
        content: hits.length ? hits.join("\n\n") : `No matches for "${q}".`,
      };
    }

    case "append_canon": {
      const note = String(input.note || "").trim();
      if (!note) return { status: "canon", content: "Empty note." };
      await appendCanon(projectId, note);
      return {
        status: "recording to canon",
        content: `Recorded to canon.md: ${note}`,
        mutationCount: 1,
      };
    }

    case "update_bible": {
      const p = String(input.path || "");
      const content = String(input.content ?? "");
      try {
        await writeBibleFile(projectId, p, content);
        return {
          status: `updating ${p}`,
          content: `Wrote ${p}.`,
          mutationCount: 1,
        };
      } catch (e) {
        return { status: "write failed", content: `Error: ${(e as Error).message}` };
      }
    }

    case "raise_question": {
      const question = String(input.question || "").trim();
      if (!question) return { status: "question", content: "Empty question." };
      let chapterId: string | null = null;
      if (input.chapterNumber != null) {
        const chapters = await prisma.chapter.findMany({
          where: { projectId },
          orderBy: { order: "asc" },
        });
        chapterId = chapters[Number(input.chapterNumber) - 1]?.id ?? null;
      }
      const q = await prisma.openQuestion.create({
        data: {
          projectId,
          question,
          provisional: String(input.provisional || "").trim(),
          affects: String(input.affects || "").trim(),
          chapterId,
        },
      });
      return {
        status: "logged an open question",
        content: `Logged open question ${q.id}: "${question}" (went with: ${q.provisional || "n/a"}).`,
        mutationCount: 1,
      };
    }

    case "list_open_questions": {
      const qs = await prisma.openQuestion.findMany({
        where: { projectId, status: "open" },
        orderBy: { createdAt: "desc" },
      });
      const content = qs.length
        ? qs
            .map(
              (q) =>
                `- [${q.id}] Q: ${q.question}\n  went with: ${q.provisional || "n/a"}${
                  q.affects ? `\n  affects: ${q.affects}` : ""
                }`
            )
            .join("\n")
        : "(no open questions)";
      return { status: "checking open questions", content };
    }

    case "resolve_question": {
      const id = String(input.id || "");
      try {
        const q = await prisma.openQuestion.update({
          where: { id },
          data: {
            status: "resolved",
            answer: String(input.answer || "").trim(),
            resolution: String(input.resolution || "").trim(),
          },
        });
        return {
          status: "resolved a question",
          content: `Resolved: ${q.question}`,
          mutationCount: 1,
        };
      } catch (e) {
        return { status: "resolve failed", content: `Error: ${(e as Error).message}` };
      }
    }

    case "edit_manuscript": {
      const n = Number(input.chapterNumber);
      const expectedRevision = Number(input.expectedRevision);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        return {
          status: "edit failed",
          content: "expectedRevision must be a non-negative integer.",
        };
      }
      const replacements = Array.isArray(input.replacements)
        ? (input.replacements as { find: string; replace: string }[])
        : [];
      const chapters = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
      const ch = chapters[n - 1];
      if (!ch) return { status: `chapter ${n} not found`, content: `No chapter ${n}.` };
      if (ch.revision !== expectedRevision) {
        return {
          status: "revision conflict",
          content:
            `STALE REVISION: chapter ${n} is revision ${ch.revision}, not ` +
            `${expectedRevision}. No replacements were applied.`,
        };
      }

      let content = ch.content;
      const report: string[] = [];
      const applied: { find: string; replace: string }[] = [];
      for (const r of replacements) {
        if (!r.find) continue;
        const literalCount = content.split(r.find).length - 1;
        if (literalCount > 0) {
          content = content.split(r.find).join(r.replace ?? "");
          report.push(`replaced "${r.find}" -> "${r.replace}" (${literalCount}x)`);
          applied.push({ find: r.find, replace: r.replace ?? "" });
          continue;
        }
        const { html: next, count } = blockReplace(content, r.find, r.replace ?? "");
        if (count > 0) {
          content = next;
          report.push(
            `replaced a paragraph-level match for "${r.find.slice(0, 60)}${
              r.find.length > 60 ? "..." : ""
            }"`
          );
          applied.push({ find: r.find, replace: r.replace ?? "" });
        } else {
          report.push(
            `"${r.find}" NOT FOUND - no change made. Tell the author this correction did not apply.`
          );
        }
      }
      const wordCount = countWords(htmlToText(content));
      if (content !== ch.content) {
        const committed = await prisma.$transaction(async (tx) => {
          const updated = await tx.chapter.updateMany({
            where: { id: ch.id, revision: expectedRevision },
            data: { content, wordCount, revision: { increment: 1 } },
          });
          if (updated.count !== 1) return false;
          await tx.manuscriptEdit.createMany({
            data: applied.map((a) => ({
              chapterId: ch.id,
              find: a.find,
              replace: a.replace,
            })),
          });
          return true;
        });
        if (!committed) {
          return {
            status: "revision conflict",
            content:
              `STALE REVISION: chapter ${n} changed before commit. ` +
              "No replacements were applied.",
          };
        }
      }
      const revision =
        content !== ch.content ? expectedRevision + 1 : expectedRevision;
      return {
        status: `correcting chapter ${n}`,
        content:
          `Chapter ${n} (${ch.title}), revision ${revision}:\n${report.join("\n")}`,
        mutationCount: content !== ch.content ? 1 : 0,
        ui:
          content !== ch.content
            ? {
                type: "chapter_updated",
                chapterId: ch.id,
                content,
                wordCount,
                revision,
              }
            : undefined,
      };
    }

    case "move_text": {
      const fromRaw = String(input.from || "").trim();
      const text = String(input.text || "").trim();
      const after = typeof input.after === "string" ? input.after : undefined;
      const before = typeof input.before === "string" ? input.before : undefined;
      const position = typeof input.position === "string" ? input.position : undefined;
      const fromChapterGiven =
        input.fromChapter != null && input.fromChapter !== ""
          ? Number(input.fromChapter)
          : null;
      const toChapterGiven =
        input.toChapter != null && input.toChapter !== ""
          ? Number(input.toChapter)
          : null;
      const expectedSourceRevision = Number(input.expectedSourceRevision);
      const expectedDestinationRevision =
        input.expectedDestinationRevision == null
          ? null
          : Number(input.expectedDestinationRevision);
      if (!Number.isInteger(expectedSourceRevision) || expectedSourceRevision < 0) {
        return {
          status: "move failed",
          content: "expectedSourceRevision must be a non-negative integer.",
        };
      }

      const fromChRes = chapterFromIdOr(fromRaw, fromChapterGiven);
      if ("error" in fromChRes) {
        return {
          status: "move failed",
          content:
            "Provide from (a passage id like ch3.s2) or fromChapter + text. " +
            fromChRes.error,
        };
      }
      const fromN = fromChRes.n;

      const destAnchor = (after || before || "").trim();
      let toFallback = toChapterGiven;
      if (toFallback == null) {
        if (destAnchor && isPassageId(destAnchor)) {
          toFallback = null;
        } else if (position || destAnchor) {
          toFallback = fromN;
        }
      }
      const toChRes = chapterFromIdOr(
        destAnchor && isPassageId(destAnchor) ? destAnchor : undefined,
        toFallback
      );
      if ("error" in toChRes) {
        return {
          status: "move failed",
          content:
            "Provide toChapter, or an after/before passage id, or position start/end. " +
            toChRes.error,
        };
      }
      const toN = toChRes.n;

      const chapters = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
      const fromCh = chapters[fromN - 1];
      const toCh = chapters[toN - 1];
      if (!fromCh) {
        return { status: `chapter ${fromN} not found`, content: `No chapter ${fromN}.` };
      }
      if (!toCh) {
        return { status: `chapter ${toN} not found`, content: `No chapter ${toN}.` };
      }
      if (fromCh.revision !== expectedSourceRevision) {
        return {
          status: "revision conflict",
          content:
            `STALE REVISION: source chapter ${fromN} is revision ${fromCh.revision}, ` +
            `not ${expectedSourceRevision}. No passage was moved.`,
        };
      }
      if (
        fromN !== toN &&
        (!Number.isInteger(expectedDestinationRevision) ||
          (expectedDestinationRevision as number) < 0)
      ) {
        return {
          status: "move failed",
          content:
            "expectedDestinationRevision is required for a cross-chapter move.",
        };
      }
      if (
        fromN !== toN &&
        toCh.revision !== expectedDestinationRevision
      ) {
        return {
          status: "revision conflict",
          content:
            `STALE REVISION: destination chapter ${toN} is revision ${toCh.revision}, ` +
            `not ${expectedDestinationRevision}. No passage was moved.`,
        };
      }

      const source = resolveSource(fromCh.content, fromN, { from: fromRaw, text });
      if ("error" in source) {
        return { status: "move failed", content: source.error };
      }

      const destOpts: DestOpts = { after, before, position };
      const destIsId = Boolean(destAnchor && isPassageId(destAnchor));
      const sourceLen = source.end - source.start;

      let destHtml = fromN === toN ? fromCh.content : toCh.content;
      let destAt: number;

      if (fromN === toN && destIsId) {
        const dest = resolveDestination(fromCh.content, fromN, destOpts);
        if (dest.error) return { status: "move failed", content: dest.error };
        if (
          dest.start != null &&
          dest.end != null &&
          dest.start < source.end &&
          dest.end > source.start
        ) {
          return {
            status: "move failed",
            content:
              "Destination anchor is inside the passage being moved. Choose an id outside it, or use position start/end.",
          };
        }
        if (dest.at > source.start && dest.at < source.end) {
          return {
            status: "move failed",
            content:
              "Destination lands inside the passage being moved. Choose an anchor outside it, or use position start/end.",
          };
        }
        destAt = dest.at >= source.end ? dest.at - sourceLen : dest.at;
        destHtml = fromCh.content.slice(0, source.start) + fromCh.content.slice(source.end);
      } else if (fromN === toN) {
        destHtml = fromCh.content.slice(0, source.start) + fromCh.content.slice(source.end);
        const dest = resolveDestination(destHtml, fromN, destOpts);
        if (dest.error) return { status: "move failed", content: dest.error };
        destAt = dest.at;
      } else {
        const dest = resolveDestination(toCh.content, toN, destOpts);
        if (dest.error) return { status: "move failed", content: dest.error };
        destAt = dest.at;
        destHtml = toCh.content;
      }

      const extractedHtml = fromCh.content.slice(source.start, source.end);
      const sourceWithout =
        fromN === toN
          ? destHtml
          : fromCh.content.slice(0, source.start) + fromCh.content.slice(source.end);
      const destWith = insertHtmlAt(destHtml, extractedHtml, destAt);
      const fromWordCount = countWords(htmlToText(fromN === toN ? destWith : sourceWithout));
      const toWordCount = countWords(htmlToText(destWith));
      const label = `${source.id} (${source.wordCount}w)`;

      if (fromN === toN) {
        const committed = await prisma.$transaction(async (tx) => {
          const updated = await tx.chapter.updateMany({
            where: { id: fromCh.id, revision: expectedSourceRevision },
            data: {
              content: destWith,
              wordCount: toWordCount,
              revision: { increment: 1 },
            },
          });
          if (updated.count !== 1) return false;
          await tx.manuscriptEdit.create({
            data: {
              chapterId: fromCh.id,
              find: source.id,
              replace: `[moved within chapter ${fromN}]`,
            },
          });
          return true;
        });
        if (!committed) {
          return {
            status: "revision conflict",
            content:
              `STALE REVISION: chapter ${fromN} changed before commit. ` +
              "No passage was moved.",
          };
        }
        const revision = expectedSourceRevision + 1;
        return {
          status: backstageLine("move_text"),
          content:
            `Moved ${label} within chapter ${fromN} (${fromCh.title}); ` +
            `revision ${expectedSourceRevision} -> ${revision}.\n\n` +
            sceneIndexReport(destWith, fromN, fromCh.title),
          mutationCount: 1,
          ui: {
            type: "chapter_updated",
            chapterId: fromCh.id,
            content: destWith,
            wordCount: toWordCount,
            revision,
          },
        };
      }

      try {
        await prisma.$transaction(async (tx) => {
          const sourceUpdate = await tx.chapter.updateMany({
            where: { id: fromCh.id, revision: expectedSourceRevision },
            data: {
              content: sourceWithout,
              wordCount: fromWordCount,
              revision: { increment: 1 },
            },
          });
          if (sourceUpdate.count !== 1) throw new Error("SOURCE_REVISION_CONFLICT");
          const destinationUpdate = await tx.chapter.updateMany({
            where: {
              id: toCh.id,
              revision: expectedDestinationRevision as number,
            },
            data: {
              content: destWith,
              wordCount: toWordCount,
              revision: { increment: 1 },
            },
          });
          if (destinationUpdate.count !== 1) {
            throw new Error("DESTINATION_REVISION_CONFLICT");
          }
          await tx.manuscriptEdit.createMany({
            data: [
              { chapterId: fromCh.id, find: source.id, replace: "" },
              { chapterId: toCh.id, find: "", replace: source.id },
            ],
          });
        });
      } catch (error) {
        if (
          (error as Error).message === "SOURCE_REVISION_CONFLICT" ||
          (error as Error).message === "DESTINATION_REVISION_CONFLICT"
        ) {
          return {
            status: "revision conflict",
            content:
              "STALE REVISION during move commit. The transaction was rolled back; " +
              "no passage was moved.",
          };
        }
        throw error;
      }
      const sourceRevision = expectedSourceRevision + 1;
      const destinationRevision = (expectedDestinationRevision as number) + 1;

      return {
        status: backstageLine("move_text"),
        content:
          `Moved ${label} from chapter ${fromN} (${fromCh.title}) to chapter ${toN} ` +
          `(${toCh.title}); revisions ${expectedSourceRevision} -> ${sourceRevision} and ` +
          `${expectedDestinationRevision} -> ${destinationRevision}.\n\n` +
          sceneIndexReport(sourceWithout, fromN, fromCh.title) +
          "\n\n" +
          sceneIndexReport(destWith, toN, toCh.title),
        mutationCount: 1,
        ui: [
          {
            type: "chapter_updated",
            chapterId: fromCh.id,
            content: sourceWithout,
            wordCount: fromWordCount,
            revision: sourceRevision,
          },
          {
            type: "chapter_updated",
            chapterId: toCh.id,
            content: destWith,
            wordCount: toWordCount,
            revision: destinationRevision,
          },
        ],
      };
    }

    case "insert_text": {
      const n = Number(input.chapterNumber);
      const expectedRevision = Number(input.expectedRevision);
      const text = String(input.text || "").trim();
      if (!text) return { status: "insert failed", content: "Empty text to insert." };
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        return {
          status: "insert failed",
          content: "expectedRevision must be a non-negative integer.",
        };
      }
      const chapters = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
      const ch = chapters[n - 1];
      if (!ch) return { status: `chapter ${n} not found`, content: `No chapter ${n}.` };
      if (ch.revision !== expectedRevision) {
        return {
          status: "revision conflict",
          content:
            `STALE REVISION: chapter ${n} is revision ${ch.revision}, not ` +
            `${expectedRevision}. No text was inserted.`,
        };
      }

      const dest = resolveDestination(ch.content, n, {
        after: typeof input.after === "string" ? input.after : undefined,
        before: typeof input.before === "string" ? input.before : undefined,
        position: typeof input.position === "string" ? input.position : undefined,
      });
      if (dest.error) {
        return { status: "insert failed", content: dest.error };
      }

      const insertHtml = paragraphsToHtml(text);
      const content = insertHtmlAt(ch.content, insertHtml, dest.at);
      const wordCount = countWords(htmlToText(content));
      const committed = await prisma.$transaction(async (tx) => {
        const updated = await tx.chapter.updateMany({
          where: { id: ch.id, revision: expectedRevision },
          data: { content, wordCount, revision: { increment: 1 } },
        });
        if (updated.count !== 1) return false;
        await tx.manuscriptEdit.create({
          data: { chapterId: ch.id, find: "", replace: text },
        });
        return true;
      });
      if (!committed) {
        return {
          status: "revision conflict",
          content:
            `STALE REVISION: chapter ${n} changed before commit. No text was inserted.`,
        };
      }
      const revision = expectedRevision + 1;
      return {
        status: `inserting into chapter ${n}`,
        content:
          `Inserted into chapter ${n} (${ch.title}); revision ` +
          `${expectedRevision} -> ${revision}.\n\n` +
          sceneIndexReport(content, n, ch.title),
        mutationCount: 1,
        ui: {
          type: "chapter_updated",
          chapterId: ch.id,
          content,
          wordCount,
          revision,
        },
      };
    }

    case "create_chapter": {
      const chapters = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
      const open = input.open !== false;
      let order = chapters.length;
      const afterN =
        input.afterChapter != null && input.afterChapter !== ""
          ? Number(input.afterChapter)
          : null;
      if (afterN != null) {
        if (!Number.isFinite(afterN) || afterN < 1 || afterN > chapters.length) {
          return {
            status: "create failed",
            content: `afterChapter must be between 1 and ${chapters.length}.`,
          };
        }
        order = afterN; // insert after chapter N → new order index = N (0-based: afterN)
        // Shift later chapters up so the new one slots in.
        const toShift = chapters.filter((c) => c.order >= order);
        if (toShift.length) {
          await prisma.$transaction(
            toShift.map((c) =>
              prisma.chapter.update({
                where: { id: c.id },
                data: { order: c.order + 1 },
              })
            )
          );
        }
      }

      const title =
        String(input.title || "").trim() || `Chapter ${order + 1}`;
      const chapter = await prisma.chapter.create({
        data: {
          projectId,
          title,
          order,
        },
      });
      const number = order + 1;
      return {
        status: `creating chapter ${number}`,
        content: `Created chapter ${number}: "${chapter.title}"${
          open ? " (now open in the editor)" : ""
        }.`,
        mutationCount: 1,
        ui: [
          {
            type: "chapter_created",
            chapter: {
              id: chapter.id,
              projectId: chapter.projectId,
              title: chapter.title,
              order: chapter.order,
              content: chapter.content,
              summary: chapter.summary,
              status: chapter.status,
              wordCount: chapter.wordCount,
              revision: chapter.revision,
            },
            open,
          },
          ...(open
            ? [
                {
                  type: "open_chapter" as const,
                  chapterId: chapter.id,
                  number,
                  title: chapter.title,
                },
              ]
            : []),
        ],
      };
    }

    case "open_chapter": {
      const n = Number(input.chapterNumber);
      const chapters = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
      const ch = chapters[n - 1];
      if (!ch) return { status: `chapter ${n} not found`, content: `No chapter ${n}.` };
      return {
        status: `opening chapter ${n}`,
        content: `Opened chapter ${n}: "${ch.title}". Subsequent <draft> inserts (including Auto mode) will target this chapter.`,
        ui: {
          type: "open_chapter",
          chapterId: ch.id,
          number: n,
          title: ch.title,
        },
      };
    }

    case "dispatch_draft": {
      const brief = String(input.brief || "").trim();
      const mode = input.mode === "fast" ? "fast" : "quality";
      if (!brief) return { status: "draft", content: "Empty brief." };
      const model = mode === "fast" ? DRAFTER_FAST_MODEL : DRAFTER_MODEL;
      try {
        const anthropic = getAnthropic();
        const res = await anthropic.messages.create({
          model,
          max_tokens: 3000,
          system: DRAFTER_SYSTEM,
          messages: [{ role: "user", content: brief }],
        });
        const prose = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        return {
          status: backstageLine("dispatch_draft"),
          content: prose || "(drafter returned nothing)",
        };
      } catch (e) {
        return { status: "draft failed", content: `Error: ${(e as Error).message}` };
      }
    }

    case "read_blob": {
      const id = String(input.id || "").trim();
      if (!id) return { status: "read failed", content: "Empty blob id." };
      const blob = await prisma.chatBlob.findFirst({
        where: { id, projectId },
      });
      if (!blob) {
        return { status: "not found", content: `No blob ${id} in this project.` };
      }
      return {
        status: backstageLine("read_blob"),
        content: blob.content || "(empty)",
      };
    }

    case "read_past_turn": {
      const id = String(input.id || "").trim();
      if (!id) return { status: "read failed", content: "Empty message id." };
      const msg = await prisma.chatMessage.findFirst({
        where: { id, projectId },
      });
      if (!msg) {
        return { status: "not found", content: `No chat message ${id}.` };
      }
      const archiveNote = msg.archivedAt
        ? "(archived - rolled out of the live window)\n\n"
        : "";
      return {
        status: backstageLine("read_past_turn"),
        content: `${archiveNote}[${msg.role} · ${msg.kind} · ${msg.status}]\n\n${msg.content}`,
      };
    }

    case "search_chat": {
      const q = String(input.query || "").trim();
      if (!q) return { status: "search", content: "Empty query." };
      const messages = await prisma.chatMessage.findMany({
        where: { projectId },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      const needle = q.toLowerCase();
      const hits: { id: string; label: string; preview: string }[] = [];
      for (const m of messages) {
        const lower = m.content.toLowerCase();
        const idx = lower.indexOf(needle);
        if (idx === -1) continue;
        const start = Math.max(0, idx - 80);
        const end = Math.min(m.content.length, idx + q.length + 80);
        const preview = m.content
          .slice(start, end)
          .replace(/\s+/g, " ")
          .trim();
        hits.push({
          id: m.id,
          label: `${m.role}${m.archivedAt ? " · archived" : ""} · ${m.kind}`,
          preview,
        });
        if (hits.length >= 12) break;
      }

      let hint = "";
      if (hits.length > 1) {
        try {
          const ranked = await runRanker(q, hits);
          if (ranked.ranked.length) {
            hint =
              "\n\n[Ranking hint - non-binding; open what you need yourself]\n" +
              ranked.ranked
                .slice(0, 6)
                .map(
                  (r, i) =>
                    `${i + 1}. ${r.id} (${r.label})${r.reason ? ` — ${r.reason}` : ""}`
                )
                .join("\n");
          }
        } catch {
          /* ranking is advisory; never fail the search */
        }
      }

      const body = hits.length
        ? hits
            .map(
              (h) =>
                `[id:${h.id} · ${h.label}] ...${h.preview}...`
            )
            .join("\n\n") + hint
        : `No chat matches for "${q}".`;

      return {
        status: backstageLine("search_chat", `"${q}"`),
        content: body,
      };
    }

    default:
      return { status: "unknown tool", content: `Unknown tool: ${name}` };
  }
}
