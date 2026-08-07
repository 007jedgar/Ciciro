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
      "Read the full plain text of a chapter by its number (1-based). Use to check continuity or callbacks in a chapter other than the open one.",
    input_schema: {
      type: "object",
      properties: {
        number: { type: "integer", description: "1-based chapter number" },
      },
      required: ["number"],
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
      required: ["chapterNumber", "replacements"],
    },
  },
  {
    name: "move_text",
    description:
      "Atomically cut a passage from one place and paste it somewhere else - within the same chapter or across chapters. Quote the passage as plain text (paragraphs separated by a blank line), matching what read_chapter returns. Destination: after, before, or position start/end. Prefer this over delete+rewrite when rearranging.",
    input_schema: {
      type: "object",
      properties: {
        fromChapter: {
          type: "integer",
          description: "1-based chapter number to cut from",
        },
        text: {
          type: "string",
          description:
            "Exact passage to move, plain text. Separate paragraphs with a blank line.",
        },
        toChapter: {
          type: "integer",
          description: "1-based chapter number to paste into (same as fromChapter to reorder within a chapter)",
        },
        after: {
          type: "string",
          description: "Plain-text anchor: paste immediately after this passage",
        },
        before: {
          type: "string",
          description: "Plain-text anchor: paste immediately before this passage",
        },
        position: {
          type: "string",
          enum: ["start", "end"],
          description: "Paste at chapter start or end (use when no anchor)",
        },
      },
      required: ["fromChapter", "text", "toChapter"],
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
        text: {
          type: "string",
          description: "Prose to insert, plain text. Separate paragraphs with a blank line.",
        },
        after: {
          type: "string",
          description: "Plain-text anchor: insert immediately after this passage",
        },
        before: {
          type: "string",
          description: "Plain-text anchor: insert immediately before this passage",
        },
        position: {
          type: "string",
          enum: ["start", "end"],
          description: "Insert at chapter start or end (use when no anchor)",
        },
      },
      required: ["chapterNumber", "text"],
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

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

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

type Block = { start: number; end: number; text: string };

// Top-level block elements (paragraphs, headings, list items, blockquotes)
// with their character offsets in the raw HTML and their plain-text content.
function getBlocks(html: string): Block[] {
  const re = /<(p|h[1-6]|li|blockquote)\b[^>]*>[\s\S]*?<\/\1>/gi;
  const blocks: Block[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    blocks.push({
      start: m.index,
      end: m.index + m[0].length,
      text: normalizeWhitespace(htmlToText(m[0])),
    });
  }
  return blocks;
}

function findParas(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => normalizeWhitespace(p))
    .filter(Boolean);
}

// Match a contiguous run of top-level blocks by plain text. Returns the
// inclusive block index range, or null if not found.
function findBlockRun(
  html: string,
  find: string
): { startIdx: number; endIdx: number; start: number; end: number } | null {
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

function resolveDestination(
  html: string,
  opts: DestOpts
): { at: number; error?: string } {
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

  const run = findBlockRun(html, after || before);
  if (!run) {
    const label = after ? "after" : "before";
    const snippet = (after || before).slice(0, 60);
    return {
      at: -1,
      error: `Anchor for ${label} not found: "${snippet}${
        (after || before).length > 60 ? "..." : ""
      }"`,
    };
  }
  return { at: after ? run.end : run.start };
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
  ctx: { projectId: string }
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
        content: `# ${ch.title}\n\n${htmlToText(ch.content) || "(empty)"}`,
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
      for (const ch of chapters) {
        const text = htmlToText(ch.content);
        const lower = text.toLowerCase();
        let idx = lower.indexOf(needle);
        while (idx !== -1 && hits.length < 8) {
          const start = Math.max(0, idx - 120);
          const end = Math.min(text.length, idx + q.length + 120);
          hits.push(`[${ch.title}] ...${text.slice(start, end).replace(/\s+/g, " ").trim()}...`);
          idx = lower.indexOf(needle, idx + q.length);
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
      return { status: "recording to canon", content: `Recorded to canon.md: ${note}` };
    }

    case "update_bible": {
      const p = String(input.path || "");
      const content = String(input.content ?? "");
      try {
        await writeBibleFile(projectId, p, content);
        return { status: `updating ${p}`, content: `Wrote ${p}.` };
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
        return { status: "resolved a question", content: `Resolved: ${q.question}` };
      } catch (e) {
        return { status: "resolve failed", content: `Error: ${(e as Error).message}` };
      }
    }

    case "edit_manuscript": {
      const n = Number(input.chapterNumber);
      const replacements = Array.isArray(input.replacements)
        ? (input.replacements as { find: string; replace: string }[])
        : [];
      const chapters = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
      const ch = chapters[n - 1];
      if (!ch) return { status: `chapter ${n} not found`, content: `No chapter ${n}.` };

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
        await prisma.chapter.update({
          where: { id: ch.id },
          data: { content, wordCount },
        });
      }
      // Keep a record of what actually changed so the manuscript pane can
      // render a diff view - separate from `report`, which goes to the model.
      if (applied.length) {
        await prisma.manuscriptEdit.createMany({
          data: applied.map((a) => ({ chapterId: ch.id, find: a.find, replace: a.replace })),
        });
      }
      return {
        status: `correcting chapter ${n}`,
        content: `Chapter ${n} (${ch.title}):\n${report.join("\n")}`,
        ui:
          content !== ch.content
            ? { type: "chapter_updated", chapterId: ch.id, content, wordCount }
            : undefined,
      };
    }

    case "move_text": {
      const fromN = Number(input.fromChapter);
      const toN = Number(input.toChapter);
      const text = String(input.text || "").trim();
      if (!text) return { status: "move failed", content: "Empty text to move." };
      if (!Number.isFinite(fromN) || !Number.isFinite(toN)) {
        return { status: "move failed", content: "fromChapter and toChapter are required." };
      }

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

      const sourceRun = findBlockRun(fromCh.content, text);
      if (!sourceRun) {
        return {
          status: "move failed",
          content: `Source passage NOT FOUND in chapter ${fromN} (${fromCh.title}). Quote the text exactly as read_chapter shows it (blank line between paragraphs).`,
        };
      }

      const extractedHtml = fromCh.content.slice(sourceRun.start, sourceRun.end);
      const sourceWithout = fromCh.content.slice(0, sourceRun.start) + fromCh.content.slice(sourceRun.end);

      // Same-chapter moves: destination offsets are against the post-cut HTML.
      const destHtml = fromN === toN ? sourceWithout : toCh.content;
      const dest = resolveDestination(destHtml, {
        after: typeof input.after === "string" ? input.after : undefined,
        before: typeof input.before === "string" ? input.before : undefined,
        position: typeof input.position === "string" ? input.position : undefined,
      });
      if (dest.error) {
        return { status: "move failed", content: dest.error };
      }

      // Guard: don't paste into the hole we just cut when the anchor was inside
      // the moved passage (same chapter only - cross-chapter anchors are fine).
      if (fromN === toN) {
        const anchorText =
          (typeof input.after === "string" && input.after.trim()) ||
          (typeof input.before === "string" && input.before.trim()) ||
          "";
        if (anchorText && findBlockRun(text, anchorText)) {
          return {
            status: "move failed",
            content:
              "Destination anchor is inside the passage being moved. Choose an anchor outside it, or use position start/end.",
          };
        }
      }

      const destWith = insertHtmlAt(destHtml, extractedHtml, dest.at);
      const fromWordCount = countWords(htmlToText(sourceWithout));
      const toWordCount = countWords(htmlToText(destWith));

      if (fromN === toN) {
        await prisma.chapter.update({
          where: { id: fromCh.id },
          data: { content: destWith, wordCount: toWordCount },
        });
        await prisma.manuscriptEdit.create({
          data: {
            chapterId: fromCh.id,
            find: text,
            replace: `[moved within chapter ${fromN}]`,
          },
        });
        return {
          status: `moving text in chapter ${fromN}`,
          content: `Moved passage within chapter ${fromN} (${fromCh.title}).`,
          ui: {
            type: "chapter_updated",
            chapterId: fromCh.id,
            content: destWith,
            wordCount: toWordCount,
          },
        };
      }

      await prisma.$transaction([
        prisma.chapter.update({
          where: { id: fromCh.id },
          data: { content: sourceWithout, wordCount: fromWordCount },
        }),
        prisma.chapter.update({
          where: { id: toCh.id },
          data: { content: destWith, wordCount: toWordCount },
        }),
        prisma.manuscriptEdit.create({
          data: {
            chapterId: fromCh.id,
            find: text,
            replace: "",
          },
        }),
        prisma.manuscriptEdit.create({
          data: {
            chapterId: toCh.id,
            find: "",
            replace: text,
          },
        }),
      ]);

      return {
        status: `moving text to chapter ${toN}`,
        content: `Moved passage from chapter ${fromN} (${fromCh.title}) to chapter ${toN} (${toCh.title}).`,
        ui: [
          {
            type: "chapter_updated",
            chapterId: fromCh.id,
            content: sourceWithout,
            wordCount: fromWordCount,
          },
          {
            type: "chapter_updated",
            chapterId: toCh.id,
            content: destWith,
            wordCount: toWordCount,
          },
        ],
      };
    }

    case "insert_text": {
      const n = Number(input.chapterNumber);
      const text = String(input.text || "").trim();
      if (!text) return { status: "insert failed", content: "Empty text to insert." };
      const chapters = await prisma.chapter.findMany({
        where: { projectId },
        orderBy: { order: "asc" },
      });
      const ch = chapters[n - 1];
      if (!ch) return { status: `chapter ${n} not found`, content: `No chapter ${n}.` };

      const dest = resolveDestination(ch.content, {
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
      await prisma.chapter.update({
        where: { id: ch.id },
        data: { content, wordCount },
      });
      await prisma.manuscriptEdit.create({
        data: { chapterId: ch.id, find: "", replace: text },
      });
      return {
        status: `inserting into chapter ${n}`,
        content: `Inserted into chapter ${n} (${ch.title}).`,
        ui: { type: "chapter_updated", chapterId: ch.id, content, wordCount },
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
