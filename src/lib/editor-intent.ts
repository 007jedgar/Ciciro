import { prisma } from "@/lib/db";
import type Anthropic from "@anthropic-ai/sdk";
import { htmlToText } from "@/lib/text";
import {
  countPassageOccurrences,
  normalizePassageComparison,
  normalizeWhitespace,
} from "@/lib/passages";
import {
  decideReorg,
  loadChapterShapes,
  looksLikeReorg,
} from "@/lib/reorg";

export type PassageExpectation = {
  sourceChapter: number;
  destinationChapter: number;
  normalizedText: string;
  origin: "selection" | "inline_marker";
};

export type InlineMarkerExpectation = {
  chapter: number;
  marker: string;
  destinationChapter: number | null;
};

export type EditorIntentContract = {
  version: 1;
  category: "reorganization" | "conversation";
  actionRequired: boolean;
  sourceChapters: number[];
  destinationChapters: number[];
  phases: readonly ["inspect", "compare", "mutate", "verify"];
  desiredOperations: Array<{
    kind: "move_passage" | "split_inline_chapter_boundary";
    sourceChapter: number;
    destinationChapter: number;
  }>;
  postconditions: {
    inlineMarkersAbsent: InlineMarkerExpectation[];
    passages: PassageExpectation[];
  };
  initialEvidence: {
    inlineMarkers: InlineMarkerExpectation[];
    selectionProvided: boolean;
    desiredStateAlreadyHeld: boolean;
  };
};

const CONTRACT_OPEN = "<editor_intent>";
const CONTRACT_CLOSE = "</editor_intent>";

function unique(numbers: Array<number | null>): number[] {
  return [...new Set(numbers.filter((number): number is number => number != null))];
}

function findInlineMarkers(
  html: string,
  chapter: number,
  fallbackDestination: number | null
): Array<InlineMarkerExpectation & { followingText: string }> {
  const text = htmlToText(html);
  const lines = text.split(/\n/);
  const markers: Array<InlineMarkerExpectation & { followingText: string }> = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const markerRe = /chapter\s*(\d+)(?!\d)/gi;
    let match: RegExpExecArray | null;
    while ((match = markerRe.exec(line))) {
      const prefix = line.slice(0, match.index).trim();
      if (!prefix) continue;
      const destinationChapter = Number(match[1]) || fallbackDestination;
      const followingText = normalizeWhitespace(
        [line.slice(match.index + match[0].length), ...lines.slice(lineIndex + 1)]
          .join(" ")
          .slice(0, 600)
      );
      markers.push({
        chapter,
        marker: match[0],
        destinationChapter,
        followingText,
      });
    }
  }
  return markers;
}

export async function buildEditorIntent(input: {
  projectId: string;
  message: string;
  selection?: string;
  activeChapterId?: string | null;
  kind?: string;
}): Promise<EditorIntentContract> {
  const actionRequired =
    input.kind === "action" || looksLikeReorg(input.message, input.selection);
  if (!actionRequired) {
    return {
      version: 1,
      category: "conversation",
      actionRequired: false,
      sourceChapters: [],
      destinationChapters: [],
      phases: ["inspect", "compare", "mutate", "verify"],
      desiredOperations: [],
      postconditions: { inlineMarkersAbsent: [], passages: [] },
      initialEvidence: {
        inlineMarkers: [],
        selectionProvided: false,
        desiredStateAlreadyHeld: true,
      },
    };
  }

  const [shapes, chapters] = await Promise.all([
    loadChapterShapes(input.projectId),
    prisma.chapter.findMany({
      where: { projectId: input.projectId },
      orderBy: { order: "asc" },
      select: { id: true, content: true },
    }),
  ]);
  const openIndex = chapters.findIndex(
    (chapter) => chapter.id === input.activeChapterId
  );
  const plan = decideReorg({
    message: input.message,
    selection: input.selection,
    openChapter: openIndex >= 0 ? openIndex + 1 : null,
    chapters: shapes,
  });
  const sourceChapter = plan.sourceChapter;
  const destinationChapter = plan.destChapter;
  const initialMarkers = sourceChapter
    ? findInlineMarkers(
        chapters[sourceChapter - 1]?.content || "",
        sourceChapter,
        destinationChapter
      )
    : [];
  const detectedMarkerExpectations = initialMarkers.map((marker) => ({
    chapter: marker.chapter,
    marker: marker.marker,
    destinationChapter: marker.destinationChapter,
  }));
  const inferredMarker =
    sourceChapter &&
    destinationChapter &&
    /\b(?:poorly|wrongly|badly)\s+inserted\b/i.test(input.message)
      ? {
          chapter: sourceChapter,
          marker: `CHAPTER ${destinationChapter}`,
          destinationChapter,
        }
      : null;
  const inlineMarkersAbsent = detectedMarkerExpectations.length
    ? detectedMarkerExpectations
    : inferredMarker
      ? [inferredMarker]
      : [];
  const passages: PassageExpectation[] = [];
  const selection = normalizePassageComparison(input.selection || "");
  if (selection && sourceChapter && destinationChapter) {
    passages.push({
      sourceChapter,
      destinationChapter,
      normalizedText: selection,
      origin: "selection",
    });
  }
  for (const marker of initialMarkers) {
    if (!marker.followingText || !marker.destinationChapter) continue;
    passages.push({
      sourceChapter: marker.chapter,
      destinationChapter: marker.destinationChapter,
      normalizedText: marker.followingText,
      origin: "inline_marker",
    });
  }
  const initialDesiredState =
    inlineMarkersAbsent.length + passages.length > 0 &&
    inlineMarkersAbsent.every((marker) => {
      const text = htmlToText(chapters[marker.chapter - 1]?.content || "");
      const wanted = normalizeWhitespace(marker.marker).toLocaleLowerCase();
      return !text.split(/\n/).some((line) => {
        const normalized = normalizeWhitespace(line).toLocaleLowerCase();
        return normalized.indexOf(wanted) > 0;
      });
    }) &&
    passages.every((passage) => {
      return (
        countPassageOccurrences(
          chapters[passage.sourceChapter - 1]?.content || "",
          passage.normalizedText
        ) === 0 &&
        countPassageOccurrences(
          chapters[passage.destinationChapter - 1]?.content || "",
          passage.normalizedText
        ) === 1
      );
    });

  const desiredOperations: EditorIntentContract["desiredOperations"] = [];
  if (sourceChapter && destinationChapter) {
    desiredOperations.push({
      kind: "move_passage",
      sourceChapter,
      destinationChapter,
    });
  }
  for (const marker of inlineMarkersAbsent) {
    if (!marker.destinationChapter) continue;
    desiredOperations.push({
      kind: "split_inline_chapter_boundary",
      sourceChapter: marker.chapter,
      destinationChapter: marker.destinationChapter,
    });
  }

  return {
    version: 1,
    category: "reorganization",
    actionRequired: true,
    sourceChapters: unique([
      sourceChapter,
      ...inlineMarkersAbsent.map((marker) => marker.chapter),
    ]),
    destinationChapters: unique([
      destinationChapter,
      ...inlineMarkersAbsent.map((marker) => marker.destinationChapter),
    ]),
    phases: ["inspect", "compare", "mutate", "verify"],
    desiredOperations,
    postconditions: { inlineMarkersAbsent, passages },
    initialEvidence: {
      inlineMarkers: detectedMarkerExpectations,
      selectionProvided: Boolean(selection),
      desiredStateAlreadyHeld: initialDesiredState,
    },
  };
}

export function formatEditorIntent(contract: EditorIntentContract): string {
  return `${CONTRACT_OPEN}\n${JSON.stringify(contract)}\n${CONTRACT_CLOSE}`;
}

export function parseEditorIntent(text: string): EditorIntentContract | null {
  const start = text.indexOf(CONTRACT_OPEN);
  const end = text.indexOf(CONTRACT_CLOSE, start + CONTRACT_OPEN.length);
  if (start < 0 || end < 0) return null;
  try {
    const parsed = JSON.parse(
      text.slice(start + CONTRACT_OPEN.length, end).trim()
    ) as EditorIntentContract;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function intentFromMessages(
  messages: Anthropic.MessageParam[]
): EditorIntentContract | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (typeof message.content === "string") {
      const contract = parseEditorIntent(message.content);
      if (contract) return contract;
      continue;
    }
    for (const block of message.content) {
      if (block.type !== "text") continue;
      const contract = parseEditorIntent(block.text);
      if (contract) return contract;
    }
  }
  return null;
}
