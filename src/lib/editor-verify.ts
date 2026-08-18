import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { htmlToText } from "@/lib/text";
import {
  countPassageOccurrences,
  normalizeWhitespace,
} from "@/lib/passages";
import {
  intentFromMessages,
  type EditorIntentContract,
} from "@/lib/editor-intent";

type VerificationCheck = {
  name: string;
  passed: boolean;
  evidence: string;
};

export type EditorVerificationResult = {
  policy: "intent-aware-v1";
  passed: boolean;
  noOp: boolean;
  intent: EditorIntentContract | null;
  checks: VerificationCheck[];
  unmatchedToolUseIds: string[];
  failedReasons: string[];
  chapterRevisions: Record<number, number>;
};

function toolEvidence(messages: Anthropic.MessageParam[]) {
  const toolUses = new Map<
    string,
    { name: string; input: Record<string, unknown> }
  >();
  const toolResults = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "tool_use") {
        toolUses.set(block.id, {
          name: block.name,
          input: (block.input as Record<string, unknown>) || {},
        });
      }
      if (block.type === "tool_result") toolResults.add(block.tool_use_id);
    }
  }
  return {
    toolUses,
    unmatchedToolUseIds: [...toolUses.keys()].filter(
      (id) => !toolResults.has(id)
    ),
  };
}

function hasInlineMarker(text: string, marker: string): boolean {
  const wanted = normalizeWhitespace(marker).toLocaleLowerCase();
  return text.split(/\n/).some((line) => {
    const normalized = normalizeWhitespace(line).toLocaleLowerCase();
    const at = normalized.indexOf(wanted);
    return at > 0;
  });
}

function isRelevantMutation(name: string): boolean {
  return [
    "move_text",
    "delete_passages",
    "split_chapter_at",
    "insert_text",
    "edit_manuscript",
  ].includes(name);
}

function usesExpectedRevision(tool: {
  name: string;
  input: Record<string, unknown>;
}): boolean {
  if (tool.name === "split_chapter_at") {
    return Number.isInteger(tool.input.expectedSourceRevision);
  }
  if (
    tool.name === "delete_passages" ||
    tool.name === "insert_text" ||
    tool.name === "edit_manuscript"
  ) {
    return Number.isInteger(tool.input.expectedRevision);
  }
  if (tool.name === "move_text") {
    if (!Number.isInteger(tool.input.expectedSourceRevision)) return false;
    const passageChapter = String(tool.input.from || "").match(/^ch(\d+)\./i);
    const sourceChapter =
      Number(tool.input.fromChapter) || Number(passageChapter?.[1]) || null;
    const anchor = String(tool.input.after || tool.input.before || "");
    const anchorChapter = anchor.match(/^ch(\d+)\./i);
    const destinationChapter =
      Number(tool.input.toChapter) ||
      Number(anchorChapter?.[1]) ||
      sourceChapter;
    return (
      sourceChapter === destinationChapter ||
      Number.isInteger(tool.input.expectedDestinationRevision)
    );
  }
  return true;
}

export async function verifyEditorCompletion(input: {
  projectId: string;
  messages: Anthropic.MessageParam[];
  mutationCount: number;
}): Promise<EditorVerificationResult> {
  const intent = intentFromMessages(input.messages);
  const evidence = toolEvidence(input.messages);
  const checks: VerificationCheck[] = [
    {
      name: "model_ended_turn",
      passed: true,
      evidence: "The runner entered verification from end_turn.",
    },
    {
      name: "all_tool_uses_have_results",
      passed: evidence.unmatchedToolUseIds.length === 0,
      evidence: evidence.unmatchedToolUseIds.length
        ? `Missing results for ${evidence.unmatchedToolUseIds.join(", ")}.`
        : "Every tool_use has a matching tool_result.",
    },
  ];
  const chapterRevisions: Record<number, number> = {};

  if (!intent || !intent.actionRequired) {
    const failedReasons = checks
      .filter((check) => !check.passed)
      .map((check) => check.evidence);
    return {
      policy: "intent-aware-v1",
      passed: failedReasons.length === 0,
      noOp: false,
      intent,
      checks,
      unmatchedToolUseIds: evidence.unmatchedToolUseIds,
      failedReasons,
      chapterRevisions,
    };
  }

  const affected = [
    ...new Set([...intent.sourceChapters, ...intent.destinationChapters]),
  ];
  const chapters = await prisma.chapter.findMany({
    where: { projectId: input.projectId },
    orderBy: { order: "asc" },
    select: { content: true, revision: true },
  });
  for (const chapterNumber of affected) {
    const chapter = chapters[chapterNumber - 1];
    if (chapter) chapterRevisions[chapterNumber] = chapter.revision;
  }

  for (const marker of intent.postconditions.inlineMarkersAbsent) {
    const chapter = chapters[marker.chapter - 1];
    const present = chapter
      ? hasInlineMarker(htmlToText(chapter.content), marker.marker)
      : true;
    checks.push({
      name: `inline_marker_absent_chapter_${marker.chapter}`,
      passed: !present,
      evidence: present
        ? `Inline marker "${marker.marker}" remains in chapter ${marker.chapter}.`
        : `Inline marker "${marker.marker}" is absent from chapter ${marker.chapter}.`,
    });
  }

  for (const [index, passage] of intent.postconditions.passages.entries()) {
    const sourceCount = countPassageOccurrences(
      chapters[passage.sourceChapter - 1]?.content || "",
      passage.normalizedText
    );
    const destinationCount = countPassageOccurrences(
      chapters[passage.destinationChapter - 1]?.content || "",
      passage.normalizedText
    );
    checks.push(
      {
        name: `passage_${index + 1}_absent_from_source`,
        passed: sourceCount === 0,
        evidence: `Chapter ${passage.sourceChapter} contains ${sourceCount} normalized copy/copies.`,
      },
      {
        name: `passage_${index + 1}_exactly_once_at_destination`,
        passed: destinationCount === 1,
        evidence: `Chapter ${passage.destinationChapter} contains ${destinationCount} normalized copy/copies.`,
      }
    );
  }

  const hasPostconditions =
    intent.postconditions.inlineMarkersAbsent.length +
      intent.postconditions.passages.length >
    0;
  const operationCovered = (
    operation: EditorIntentContract["desiredOperations"][number]
  ): boolean =>
    operation.kind === "move_passage"
      ? intent.postconditions.passages.some(
          (passage) =>
            passage.sourceChapter === operation.sourceChapter &&
            passage.destinationChapter === operation.destinationChapter
        )
      : intent.postconditions.inlineMarkersAbsent.some(
          (marker) =>
            marker.chapter === operation.sourceChapter &&
            marker.destinationChapter === operation.destinationChapter
        );
  // Every operation whose end state we can pin deterministically is covered by
  // a postcondition above. A split boundary is always pinnable, so an uncovered
  // split is a real gap. A move_passage is only pinnable when a selection or a
  // fused inline marker identified the exact prose; a move we could not pin has
  // no deterministic postcondition to prove and is instead justified by the
  // revision-safe mutation gate below - it must not block completion forever.
  const allOperationsCovered =
    intent.desiredOperations.every(operationCovered);
  const unprovableSplit = intent.desiredOperations.some(
    (operation) => operation.kind !== "move_passage" && !operationCovered(operation)
  );
  checks.push({
    name: "intent_has_verifiable_postconditions",
    passed: !unprovableSplit,
    evidence: unprovableSplit
      ? "A chapter-boundary split lacks a deterministic marker postcondition."
      : allOperationsCovered
        ? "Every desired operation has deterministic manuscript postconditions."
        : "Pinnable operations are covered; an unpinnable move relies on the revision-safe mutation gate.",
  });

  const relevantCalls = [...evidence.toolUses.values()].filter((tool) =>
    isRelevantMutation(tool.name)
  );
  const revisionSafe = relevantCalls.every(usesExpectedRevision);
  checks.push({
    name: "mutations_use_expected_revisions",
    passed: input.mutationCount === 0 || revisionSafe,
    evidence:
      input.mutationCount === 0 || revisionSafe
        ? "Recorded structural mutations use expected chapter revisions."
        : "A structural mutation omitted its expected chapter revision.",
  });
  const noOp =
    input.mutationCount === 0 &&
    intent.initialEvidence.desiredStateAlreadyHeld &&
    hasPostconditions &&
    allOperationsCovered;
  const justifiedWork =
    noOp ||
    (input.mutationCount > 0 && relevantCalls.length > 0 && revisionSafe);
  checks.push({
    name: "mutation_or_verified_noop",
    passed: justifiedWork,
    evidence: noOp
      ? "Initial evidence proves the requested end state already held."
      : input.mutationCount > 0 && relevantCalls.length > 0
        ? `${input.mutationCount} mutation(s) with ${relevantCalls.length} relevant structural tool call(s).`
        : "No relevant successful mutation or verified no-op was recorded.",
  });

  const failedReasons = checks
    .filter((check) => !check.passed)
    .map((check) => check.evidence);
  return {
    policy: "intent-aware-v1",
    passed: failedReasons.length === 0,
    noOp,
    intent,
    checks,
    unmatchedToolUseIds: evidence.unmatchedToolUseIds,
    failedReasons,
    chapterRevisions,
  };
}

export function verificationContinuation(
  verification: EditorVerificationResult
): string {
  return [
    "Completion verification failed. Continue the same request and resolve these checks:",
    ...verification.failedReasons.map((reason) => `- ${reason}`),
    "Do not claim completion until every postcondition passes.",
  ].join("\n");
}
