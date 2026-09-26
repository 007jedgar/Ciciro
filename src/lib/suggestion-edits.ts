import type { Chapter } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeChapterHtml } from "@/lib/chapter-writes";
import { defaultSettings, parseSettingsJson } from "@/lib/settings";
import { assistantReplacementSplitter, type ManuscriptKind } from "@/lib/manuscript-kind";
import {
  CICIRO_AUTHOR,
  hasSuggestions,
  suggestReplacements,
  suggestionsAsTextMarkers,
  type SuggestEdit,
  type SuggestOutcome,
} from "@/lib/suggestions";
import { chapterWordCount } from "@/lib/text";
import type { ToolResult } from "@/lib/tools";

// edit_manuscript as tracked changes: Ciciro's line edits land as suggestions
// the author accepts or rejects, instead of rewriting the prose outright.

/** Whether the manuscript's owner wants Ciciro's line edits as suggestions. */
export async function aiEditsAsSuggestions(projectId: string): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { owner: { select: { settingsJson: true, settingsUpdatedAt: true } } },
  });
  if (!project?.owner) return defaultSettings().aiSuggestions;
  return parseSettingsJson(project.owner.settingsJson, project.owner.settingsUpdatedAt)
    .aiSuggestions;
}

function quote(text: string): string {
  return text.length > 60 ? `${text.slice(0, 60)}...` : text;
}

function describeOutcome(edit: SuggestEdit, outcome: SuggestOutcome): string {
  const find = quote(edit.find);
  switch (outcome.status) {
    case "suggested": {
      const line = `suggested "${find}" -> "${quote(edit.replace)}" (${outcome.count}x)`;
      return outcome.conflicts > 0
        ? `${line}; left ${outcome.conflicts} other spot(s) alone because the author has a pending suggestion there`
        : line;
    }
    case "unchanged":
      return `"${find}" already reads that way - no suggestion needed.`;
    case "conflict":
      return (
        `"${find}" overlaps a pending suggestion by ${outcome.authorName || "the author"} - left alone. ` +
        "Ask the author to accept or reject it first."
      );
    default:
      return `"${find}" NOT FOUND - no suggestion made. Tell the author this correction did not apply.`;
  }
}

/**
 * Propose find/replace corrections on one chapter as tracked suggestions. The
 * caller has already checked the chapter against the revision the editor was
 * given; the op log's compare-and-swap catches anything that moves after.
 */
export async function suggestChapterEdits(
  chapter: Chapter,
  chapterNumber: number,
  replacements: { find: string; replace?: string }[],
  kind: ManuscriptKind,
  runId?: string
): Promise<ToolResult> {
  const edits: SuggestEdit[] = replacements
    .filter((r) => r.find)
    .map((r) => ({ find: r.find, replace: r.replace ?? "" }));
  const { html, outcomes } = suggestReplacements(chapter.content, edits, {
    author: CICIRO_AUTHOR,
    newBlockId: () => crypto.randomUUID(),
    splitReplacement: assistantReplacementSplitter(kind),
  });
  const report = edits.map((edit, i) => describeOutcome(edit, outcomes[i]));
  const heading = `Chapter ${chapterNumber} (${chapter.title})`;
  if (!outcomes.some((o) => o.status === "suggested")) {
    return {
      status: `correcting chapter ${chapterNumber}`,
      content: `${heading}, revision ${chapter.revision}:\n${report.join("\n")}`,
      mutationCount: 0,
    };
  }

  const committed = await writeChapterHtml(chapter, html, { actor: "ai", runId });
  if (!committed.ok) {
    return {
      status: "revision conflict",
      content:
        `STALE REVISION: chapter ${chapterNumber} changed before commit. ` +
        "No suggestions were added.",
    };
  }
  return {
    status: `suggesting edits in chapter ${chapterNumber}`,
    content:
      `${heading}, revision ${committed.revision}:\n${report.join("\n")}\n` +
      "These are pending suggestions: the author accepts or rejects each one in the " +
      "manuscript. Tell them what you suggested; do not say the text is already changed.",
    mutationCount: 1,
    ui: {
      type: "chapter_updated",
      chapterId: chapter.id,
      content: committed.content,
      wordCount: chapterWordCount(committed.content),
      revision: committed.revision,
    },
  };
}

/** Chapter HTML for the model: pending suggestions spelled out inline. */
export function chapterHtmlForModel(html: string): string {
  return suggestionsAsTextMarkers(html);
}

/** A one-line legend when the chapter has anything pending, else "". */
export function pendingSuggestionsNote(html: string): string {
  if (!hasSuggestions(html)) return "";
  return (
    "Pending suggestions appear inline as [-removed-]{+added+}. They are not applied " +
    "until the author accepts them. Never quote the markers in a find or anchor.\n\n"
  );
}
