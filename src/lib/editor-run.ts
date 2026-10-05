import type Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { getAnthropic, EDITOR_MODEL } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { buildEditorContext } from "@/lib/context";
import { CHAT_ONLY_SYSTEM, editorSystemFor } from "@/lib/prompts";
import { craftDefaultsOn } from "@/lib/craft-options";
import {
  adaptiveThinking,
  isThinkingDisplayRejection,
  supportsThinkingUpdates,
  thinkingUpdatesRequestOptions,
} from "@/lib/thinking-display";
import { normalizeKind } from "@/lib/manuscript-kind";
import { editorToolsFor, executeEditorTool, toolUiEvents } from "@/lib/tools";
import { ensureBible } from "@/lib/bible";
import { maybeCompactChat } from "@/lib/compact";
import { backstageLine } from "@/lib/backstage";
import { buildReorgPlan, formatReorgPlan } from "@/lib/reorg";
import {
  ensureModelContent,
  selectionForModel,
  toModelMessages,
} from "@/lib/message-view";
import { continuePrompt, healAssistantContent, stripErrorFooter } from "@/lib/heal";
import {
  buildEditorIntent,
  formatEditorIntent,
} from "@/lib/editor-intent";
import {
  verificationContinuation,
  verifyEditorCompletion,
} from "@/lib/editor-verify";
import {
  editorRouteFromMessages,
  formatEditorRoute,
  routeEditorWork,
} from "@/lib/fast-lane";

export type EditorRunStatus =
  | "queued"
  | "running"
  | "continuing"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";

export type EditorScope = "selection" | "chapter" | "book";

export type EditorRunInput = {
  projectId: string;
  message?: string;
  activeChapterId?: string | null;
  selection?: string;
  kind?: string;
  scope?: EditorScope;
  autoMode?: boolean;
  /**
   * False for a "Chat only" turn (src/lib/edit-mode.ts). Anything but an
   * explicit false allows edits, and it is read only when a run is created: the
   * run keeps it for every later slice.
   */
  editsAllowed?: boolean;
  resumeTurnId?: string;
  continueFrom?: string;
  forceCompact?: boolean;
  clientTurnId?: string;
};

export type EditorRunEvent =
  | { type: "text"; v: string; resume?: boolean }
  | { type: "tool"; v: string }
  | { type: "progress"; v: string }
  | ({ type: string } & Record<string, unknown>);

type Emit = (event: EditorRunEvent) => void;

const MAX_ITERATIONS_PER_SLICE = 6;
const MAX_STREAM_RETRIES = 2;
const LEASE_MS = 11 * 60_000;

const CONTINUE_EXACTLY =
  "Continue exactly where you left off - mid-word if that is where it cut off. " +
  "Do not repeat or restate anything already written, and do not comment on the cutoff.";

const TOOL_SKIPPED_BY_CANCEL =
  "Not run: the author stopped this request before this tool call.";

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function parseMessages(raw: string): Anthropic.MessageParam[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Persisted editor transcript is invalid.");
  return parsed as Anthropic.MessageParam[];
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function isRetryableStreamError(err: unknown): boolean {
  const message = (err as Error)?.message || "";
  return (
    message === "terminated" ||
    message === "fetch failed" ||
    message.includes("other side closed") ||
    message.includes("ECONNRESET") ||
    message.includes("network") ||
    message.includes("socket")
  );
}

async function findRun(turnId: string, projectId: string) {
  const run = await prisma.editorRun.findUnique({ where: { turnId } });
  if (run && run.projectId !== projectId) {
    throw new Error("That turn id belongs to a different project.");
  }
  return run;
}

/**
 * Resolve the idempotency key and create the durable run/user message once.
 * The creator briefly owns the lease while constructing the initial transcript;
 * duplicate requests observe the same row and cannot initialize it again.
 */
export async function prepareEditorRun(input: EditorRunInput) {
  const turnId =
    input.resumeTurnId ||
    (typeof input.clientTurnId === "string" && input.clientTurnId.trim()) ||
    crypto.randomUUID();

  const existing = await findRun(turnId, input.projectId);
  if (existing) return { run: existing, compactNotice: null as string | null };

  const legacyRows = input.resumeTurnId
    ? await prisma.chatMessage.findMany({
        where: { projectId: input.projectId, turnId },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const legacyUser = legacyRows.find((row) => row.role === "user");
  const legacyAssistant = [...legacyRows]
    .reverse()
    .find((row) => row.role === "assistant");
  if (input.resumeTurnId && !legacyUser) return null;

  const message = (input.message || legacyUser?.content || "").trim();
  if (!message) throw new Error("projectId and message required");

  const setupToken = crypto.randomUUID();
  const legacyCompleted = Boolean(
    legacyAssistant?.status === "complete" && legacyAssistant.content.trim()
  );
  let created;
  try {
    // Sequential writes: D1 does not support interactive Prisma transactions.
    const user =
      legacyUser ||
      (await prisma.chatMessage.create({
        data: {
          projectId: input.projectId,
          role: "user",
          content: message,
          kind: input.kind || "chat",
          turnId,
          status: "complete",
        },
      }));
    created = await prisma.editorRun.create({
      data: {
        projectId: input.projectId,
        turnId,
        userMessageId: user.id,
        assistantMessageId: legacyAssistant?.id,
        kind: input.kind || legacyUser?.kind || "chat",
        scope: input.scope,
        activeChapterId: input.activeChapterId,
        selection: input.selection || "",
        autoMode: input.editsAllowed !== false && Boolean(input.autoMode),
        editsAllowed: input.editsAllowed !== false,
        visibleOutput: stripErrorFooter(
          input.continueFrom || legacyAssistant?.content || ""
        ),
        status: legacyCompleted ? "completed" : "queued",
        stopReason: legacyCompleted ? "legacy_replay" : null,
        verificationJson: legacyCompleted
          ? serialize({ policy: "legacy-replay", passed: true })
          : null,
        completedAt: legacyCompleted ? new Date() : null,
        lockToken: legacyCompleted ? null : setupToken,
        leaseExpiresAt: legacyCompleted
          ? null
          : new Date(Date.now() + LEASE_MS),
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await findRun(turnId, input.projectId);
    if (!raced) throw error;
    return { run: raced, compactNotice: null as string | null };
  }

  if (legacyCompleted) {
    return { run: created, compactNotice: null as string | null };
  }

  let compactNotice: string | null = null;
  try {
    await ensureBible(input.projectId);
    if (!input.resumeTurnId) {
      try {
        const compact = await maybeCompactChat(
          input.projectId,
          Boolean(input.forceCompact)
        );
        if (compact.compacted) {
          compactNotice =
            compact.statusLine ||
            backstageLine("compact", `${compact.removed} earlier pages`);
        }
      } catch {
        // Compaction is best-effort and must not poison a new run.
      }
    }

    const history = await prisma.chatMessage.findMany({
      where: { projectId: input.projectId, archivedAt: null },
      orderBy: { createdAt: "asc" },
      take: 40,
    });
    const historyForModel = history.filter(
      (row) => !(row.role === "assistant" && row.turnId === turnId)
    );

    // A Chat only turn plans no edits: no reorg plan, no edit intent, and no
    // mechanical lane, all of which steer the editor toward mutating tools.
    const editsAllowed = created.editsAllowed;
    let reorgBlock = "";
    let namedChapterNumbers: number[] = [];
    if (editsAllowed) {
      try {
        const plan = await buildReorgPlan({
          projectId: input.projectId,
          message,
          selection: input.selection || "",
          activeChapterId: input.activeChapterId,
        });
        reorgBlock = formatReorgPlan(plan);
        namedChapterNumbers = [plan.sourceChapter, plan.destChapter].filter(
          (chapter): chapter is number => chapter != null
        );
      } catch {
        // The planner remains advisory.
      }
    }
    const intent = editsAllowed
      ? await buildEditorIntent({
          projectId: input.projectId,
          message,
          selection: input.selection,
          activeChapterId: input.activeChapterId,
          kind: input.kind,
        })
      : null;
    const route = intent
      ? await routeEditorWork({
          message,
          kind: input.kind,
          intent,
        })
      : null;
    const context = await buildEditorContext(
      input.projectId,
      input.activeChapterId,
      input.scope,
      editsAllowed && Boolean(input.autoMode),
      namedChapterNumbers
    );
    const intentBlock = intent ? formatEditorIntent(intent) : "";
    const routeBlock = route ? formatEditorRoute(route) : "";
    const contextWithPlan = [context, reorgBlock, intentBlock, routeBlock]
      .filter(Boolean)
      .join("\n\n");
    const selectionBlock = await selectionForModel(
      input.projectId,
      input.selection || "",
      turnId
    );
    const messages = await toModelMessages(input.projectId, historyForModel);
    const visibleSeed = stripErrorFooter(
      input.continueFrom || legacyAssistant?.content || ""
    );

    // The context block is fixed for the whole run but resent on every
    // tool-loop iteration (executeClaimedEditorRun below), so it gets its
    // own cache breakpoint alongside the system prompt's (prompts.ts,
    // editorSystemFor) - two of Anthropic's four-breakpoint-per-request limit.
    const contextBlock: Anthropic.TextBlockParam = {
      type: "text",
      text: `<context>\n${contextWithPlan}\n</context>`,
      cache_control: { type: "ephemeral" },
    };

    if (visibleSeed) {
      messages.push({ role: "assistant", content: visibleSeed });
      messages.push({
        role: "user",
        content: [
          contextBlock,
          { type: "text", text: `${selectionBlock}\n\n${continuePrompt(visibleSeed)}` },
        ],
      });
    } else {
      const last = messages.length - 1;
      const row = messages[last];
      if (row?.role !== "user") {
        throw new Error("Editor run has no final user message.");
      }
      messages[last] = {
        role: "user",
        content: [contextBlock, { type: "text", text: `${selectionBlock}\n\n${row.content}` }],
      };
    }

    const run = await prisma.editorRun.update({
      where: { id: created.id },
      data: {
        messagesJson: serialize(messages),
        visibleOutput: visibleSeed,
        lockToken: null,
        leaseExpiresAt: null,
      },
    });
    return { run, compactNotice };
  } catch (error) {
    await prisma.editorRun.update({
      where: { id: created.id },
      data: {
        status: "failed",
        stopReason: "setup_error",
        error: (error as Error).message,
        lockToken: null,
        leaseExpiresAt: null,
      },
    });
    throw error;
  }
}

export type ClaimedEditorRun =
  Awaited<ReturnType<typeof prisma.editorRun.findUniqueOrThrow>> & {
    claimToken: string;
  };

/**
 * Claim a database lease before creating the response stream. A `null` result
 * means another request is executing this run.
 */
export async function claimEditorRun(runId: string): Promise<ClaimedEditorRun | null> {
  const claimToken = crypto.randomUUID();
  const now = new Date();
  const current = await prisma.editorRun.findUnique({ where: { id: runId } });
  if (!current) return null;

  if (
    current.cancelledAt &&
    !["completed", "failed", "cancelled"].includes(current.status)
  ) {
    // A cancellation landed in the gap between slices, when nothing was
    // actively executing to notice it (see cancelEditorRun below).
    // Finalize it now instead of leaving a non-terminal row that can never
    // be claimed again.
    await prisma.editorRun.updateMany({
      where: { id: runId, status: current.status },
      data: {
        status: "cancelled",
        stopReason: "user_cancelled",
        lockToken: null,
        leaseExpiresAt: null,
      },
    });
    return null;
  }

  const claimable = ["queued", "running", "continuing", "verifying"].includes(
    current.status
  );
  if (!claimable) return null;
  const claimed = await prisma.editorRun.updateMany({
    where: {
      id: runId,
      status: current.status,
      OR: [
        { lockToken: null },
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lt: now } },
      ],
    },
    data: {
      status: current.status === "verifying" ? "verifying" : "running",
      lockToken: claimToken,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      startedAt: now,
      error: null,
    },
  });
  if (claimed.count !== 1) return null;
  const run = await prisma.editorRun.findUniqueOrThrow({ where: { id: runId } });
  return { ...run, claimToken };
}

/**
 * Ask a run to stop. When nothing currently holds its lease - idle between
 * slices, or not yet started - this finalizes it as `cancelled` immediately.
 * Otherwise it only flags the row; the active slice notices at its next
 * iteration boundary or before its next tool call (see `isCancelled` in
 * executeClaimedEditorRun below) and finalizes it there. Never mid-stream or
 * mid-tool: whatever already landed - visible text, committed tool
 * mutations - stays, same as any other checkpoint.
 */
export async function cancelEditorRun(runId: string, projectId: string) {
  const current = await prisma.editorRun.findUnique({ where: { id: runId } });
  if (!current || current.projectId !== projectId) return null;

  if (["completed", "failed", "cancelled"].includes(current.status)) {
    return current;
  }

  const now = new Date();
  const locked = Boolean(
    current.lockToken && current.leaseExpiresAt && current.leaseExpiresAt > now
  );

  if (!locked) {
    const claimed = await prisma.editorRun.updateMany({
      where: {
        id: runId,
        status: current.status,
        OR: [
          { lockToken: null },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: "cancelled",
        stopReason: "user_cancelled",
        cancelledAt: current.cancelledAt ?? now,
        lockToken: null,
        leaseExpiresAt: null,
      },
    });
    if (claimed.count === 1) {
      const final = await prisma.editorRun.findUniqueOrThrow({ where: { id: runId } });
      if (final.assistantMessageId) {
        await prisma.chatMessage
          .update({
            where: { id: final.assistantMessageId },
            data: { status: "partial" },
          })
          .catch(() => {});
      }
      return final;
    }
    // Lost the race to an executor that just claimed it; fall through and
    // flag the row instead.
  }

  await prisma.editorRun.updateMany({
    where: { id: runId, cancelledAt: null },
    data: { cancelledAt: now },
  });
  return prisma.editorRun.findUniqueOrThrow({ where: { id: runId } });
}

type Checkpoint = {
  runId: string;
  claimToken: string;
  iteration: number;
  messages: Anthropic.MessageParam[];
  visibleOutput: string;
  visibleDelta: string;
  modelResponse: unknown;
  toolResults?: Anthropic.ToolResultBlockParam[];
  stopReason: string;
  status: EditorRunStatus;
  stepMutationCount: number;
  totalMutationCount: number;
  verification?: unknown;
  error?: string;
};

async function checkpointIteration(input: Checkpoint) {
  const chatStatus =
    input.status === "completed"
      ? "complete"
      : input.status === "failed" || input.status === "cancelled"
        ? "partial"
        : "continuing";
  const assistantContent = healAssistantContent(input.visibleOutput, {
    closeDrafts: input.status === "completed",
  });

  const current = await prisma.editorRun.findUniqueOrThrow({
    where: { id: input.runId },
  });
  if (current.lockToken !== input.claimToken) {
    throw new Error("Editor run lease was lost.");
  }

  let assistantMessageId = current.assistantMessageId;
  if (assistantMessageId) {
    await prisma.chatMessage.update({
      where: { id: assistantMessageId },
      data: {
        content: assistantContent,
        status: chatStatus,
        kind: current.kind,
      },
    });
  } else if (assistantContent.trim()) {
    const assistant = await prisma.chatMessage.create({
      data: {
        projectId: current.projectId,
        role: "assistant",
        content: assistantContent,
        status: chatStatus,
        kind: current.kind,
        turnId: current.turnId,
      },
    });
    assistantMessageId = assistant.id;
  }

  await prisma.editorStep.create({
    data: {
      runId: input.runId,
      iteration: input.iteration,
      status: input.status,
      stopReason: input.stopReason,
      modelResponseJson: serialize(input.modelResponse),
      toolResultsJson: input.toolResults ? serialize(input.toolResults) : null,
      visibleDelta: input.visibleDelta,
      mutationCount: input.stepMutationCount,
    },
  });

  return prisma.editorRun.update({
    where: { id: input.runId },
    data: {
      assistantMessageId,
      messagesJson: serialize(input.messages),
      visibleOutput: assistantContent,
      iterationCount: input.iteration,
      mutationCount: input.totalMutationCount,
      stopReason: input.stopReason,
      status: input.status,
      verificationJson:
        input.verification === undefined ? undefined : serialize(input.verification),
      error: input.error,
      leaseExpiresAt:
        input.status === "running" || input.status === "verifying"
          ? new Date(Date.now() + LEASE_MS)
          : null,
      lockToken:
        input.status === "running" || input.status === "verifying"
          ? input.claimToken
          : null,
      completedAt: input.status === "completed" ? new Date() : undefined,
    },
  });
}

async function projectKind(projectId: string) {
  const row = await prisma.project.findUnique({
    where: { id: projectId },
    select: { kind: true },
  });
  return normalizeKind(row?.kind);
}

async function finalizeVerification(
  claim: ClaimedEditorRun,
  messages: Anthropic.MessageParam[]
) {
  const current = await prisma.editorRun.findUniqueOrThrow({
    where: { id: claim.id },
    select: { mutationCount: true },
  });
  const verification = await verifyEditorCompletion({
    projectId: claim.projectId,
    messages,
    mutationCount: current.mutationCount,
    editsAllowed: claim.editsAllowed,
  });
  const finalStatus: EditorRunStatus = verification.passed
    ? "completed"
    : "continuing";
  const persistedMessages = verification.passed
    ? messages
    : [
        ...messages,
        {
          role: "user" as const,
          content: verificationContinuation(verification),
        },
      ];
  const claimed = await prisma.editorRun.updateMany({
    where: { id: claim.id, lockToken: claim.claimToken },
    data: {
      status: finalStatus,
      messagesJson: serialize(persistedMessages),
      verificationJson: serialize(verification),
      lockToken: null,
      leaseExpiresAt: null,
      completedAt: finalStatus === "completed" ? new Date() : null,
    },
  });
  if (claimed.count !== 1) {
    throw new Error("Editor run lease was lost.");
  }
  const final = await prisma.editorRun.findUniqueOrThrow({
    where: { id: claim.id },
  });
  if (final.assistantMessageId) {
    await prisma.chatMessage.update({
      where: { id: final.assistantMessageId },
      data: {
        content: healAssistantContent(final.visibleOutput, {
          closeDrafts: finalStatus === "completed",
        }),
        status: finalStatus === "completed" ? "complete" : "continuing",
      },
    });
  }
  if (finalStatus === "completed" && final.assistantMessageId) {
    ensureModelContent(final.assistantMessageId).catch(() => {});
  }
  return final;
}

async function failRun(
  claim: ClaimedEditorRun,
  messages: Anthropic.MessageParam[],
  visibleOutput: string,
  error: unknown,
  emit: Emit
) {
  const message = (error as Error).message || "Unknown editor run error";
  const footer = `\n\n[Ciciro error: ${message}]`;
  const visibleWithError = visibleOutput + footer;
  emit({ type: "text", v: footer });
  const iteration = claim.iterationCount + 1;
  return checkpointIteration({
    runId: claim.id,
    claimToken: claim.claimToken,
    iteration,
    messages,
    visibleOutput: visibleWithError,
    visibleDelta: footer,
    modelResponse: { error: message },
    stopReason: "terminal_error",
    status: "failed",
    stepMutationCount: 0,
    totalMutationCount: claim.mutationCount,
    error: message,
  });
}

/**
 * Execute one bounded slice. Every completed/synthetic model iteration is
 * checkpointed. Retrieval results are deliberately never stubbed inside a run.
 */
export async function executeClaimedEditorRun(
  claim: ClaimedEditorRun,
  emit: Emit
) {
  const anthropic = getAnthropic();
  const messages = parseMessages(claim.messagesJson);
  const route = editorRouteFromMessages(messages);
  const requestProfile =
    route?.lane === "retrieval"
      ? { maxTokens: 3000, effort: "low" as const }
      : route?.lane === "mechanical"
        ? { maxTokens: 6000, effort: "low" as const }
        : { maxTokens: 16000, effort: "high" as const };
  let visible = claim.visibleOutput;
  let totalMutations = claim.mutationCount;
  let completedIterations = claim.iterationCount;
  let persistedIterations = claim.iterationCount;
  let progressNotes = supportsThinkingUpdates(EDITOR_MODEL);

  // Cancellation is a flag on the row, not the claim token, so the author's
  // stop request can write it without needing the lease this run holds.
  // Checked between iterations and before each tool call - never mid-stream
  // or mid-tool - matching the durable lifecycle's "safe boundary" contract.
  const isCancelled = async () => {
    const row = await prisma.editorRun.findUnique({
      where: { id: claim.id },
      select: { cancelledAt: true },
    });
    return Boolean(row?.cancelledAt);
  };
  const checkpointCancelled = async () => {
    const iteration = completedIterations + 1;
    const checkpoint = await checkpointIteration({
      runId: claim.id,
      claimToken: claim.claimToken,
      iteration,
      messages,
      visibleOutput: visible,
      visibleDelta: "",
      modelResponse: { cancelled: true },
      stopReason: "user_cancelled",
      status: "cancelled",
      stepMutationCount: 0,
      totalMutationCount: totalMutations,
    });
    persistedIterations = iteration;
    return checkpoint;
  };

  try {
    if (claim.status === "verifying") {
      if (await isCancelled()) return checkpointCancelled();
      return finalizeVerification(claim, messages);
    }

    const [kind, craft] = await Promise.all([
      projectKind(claim.projectId),
      craftDefaultsOn(claim.projectId),
    ]);
    const editorSystem = editorSystemFor(
      kind,
      claim.editsAllowed ? "" : CHAT_ONLY_SYSTEM,
      { craft }
    );
    // Withheld here and refused again in executeEditorTool, per run rather than
    // per request, so a continuation slice from a stale client cannot reopen it.
    const editorTools = editorToolsFor(claim.editsAllowed);

    for (let sliceIndex = 0; sliceIndex < MAX_ITERATIONS_PER_SLICE; sliceIndex++) {
      if (await isCancelled()) return checkpointCancelled();

      let msg: Anthropic.Message | undefined;
      let visibleDelta = "";
      let midStreamDrop = false;

      for (let attempt = 0; ; attempt++) {
        const beforeAttempt = visible;
        const beforeDelta = visibleDelta;
        let emittedThisAttempt = false;
        try {
          const stream = anthropic.messages.stream(
            {
              model: EDITOR_MODEL,
              max_tokens: requestProfile.maxTokens,
              thinking: adaptiveThinking(progressNotes),
              output_config: { effort: requestProfile.effort },
              system: editorSystem,
              tools: editorTools,
              messages,
            },
            thinkingUpdatesRequestOptions(progressNotes)
          );

          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              emittedThisAttempt = true;
              visible += event.delta.text;
              visibleDelta += event.delta.text;
              emit({ type: "text", v: event.delta.text });
            } else if (
              event.type === "content_block_delta" &&
              event.delta.type === "thinking_delta" &&
              event.delta.thinking
            ) {
              // Ephemeral progress note, not part of the visible reply: a
              // drop here is always safe to retry from scratch, so it does
              // not count toward emittedThisAttempt.
              emit({ type: "progress", v: event.delta.thinking });
            }
          }
          msg = await stream.finalMessage();
          break;
        } catch (error) {
          if (progressNotes && isThinkingDisplayRejection(error)) {
            console.warn(
              "Editor progress notes rejected by the API; retrying without thinking.display:",
              (error as Error).message
            );
            progressNotes = false;
            attempt--;
            continue;
          }
          if (
            !emittedThisAttempt &&
            attempt < MAX_STREAM_RETRIES &&
            isRetryableStreamError(error)
          ) {
            visible = beforeAttempt;
            visibleDelta = beforeDelta;
            emit({ type: "tool", v: "Connection dropped, reconnecting…" });
            await new Promise((resolve) =>
              setTimeout(resolve, 1000 * (attempt + 1))
            );
            continue;
          }
          if (emittedThisAttempt && isRetryableStreamError(error)) {
            midStreamDrop = true;
            emit({
              type: "tool",
              v: "Connection dropped mid-reply; progress was checkpointed.",
            });
            break;
          }
          throw error;
        }
      }

      completedIterations += 1;
      const isLastIteration =
        sliceIndex === MAX_ITERATIONS_PER_SLICE - 1;

      if (midStreamDrop) {
        messages.push({ role: "assistant", content: visibleDelta });
        messages.push({ role: "user", content: CONTINUE_EXACTLY });
        const checkpoint = await checkpointIteration({
          runId: claim.id,
          claimToken: claim.claimToken,
          iteration: completedIterations,
          messages,
          visibleOutput: visible,
          visibleDelta,
          modelResponse: { partialText: visibleDelta },
          stopReason: "stream_interrupted",
          status: "continuing",
          stepMutationCount: 0,
          totalMutationCount: totalMutations,
        });
        persistedIterations = completedIterations;
        return checkpoint;
      }

      if (!msg) {
        throw new Error("Editor model returned no message.");
      }

      messages.push({ role: "assistant", content: msg.content });

      if (msg.stop_reason === "tool_use") {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        let stepMutations = 0;
        let stoppedMidStep = false;
        for (const block of msg.content) {
          if (block.type !== "tool_use") continue;
          if (stoppedMidStep || (await isCancelled())) {
            stoppedMidStep = true;
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: TOOL_SKIPPED_BY_CANCEL,
            });
            continue;
          }
          const result = await executeEditorTool(
            block.name,
            (block.input as Record<string, unknown>) || {},
            {
              projectId: claim.projectId,
              activeChapterId: claim.activeChapterId,
              runId: claim.id,
              editsAllowed: claim.editsAllowed,
            }
          );
          emit({ type: "tool", v: result.status });
          for (const event of toolUiEvents(result.ui)) emit(event);
          stepMutations += result.mutationCount || 0;
          totalMutations += result.mutationCount || 0;
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result.content,
          });
        }
        messages.push({ role: "user", content: toolResults });
        const cancelled = stoppedMidStep || (await isCancelled());
        const status: EditorRunStatus = cancelled
          ? "cancelled"
          : isLastIteration
            ? "continuing"
            : "running";
        const checkpoint = await checkpointIteration({
          runId: claim.id,
          claimToken: claim.claimToken,
          iteration: completedIterations,
          messages,
          visibleOutput: visible,
          visibleDelta,
          modelResponse: msg,
          toolResults,
          stopReason: cancelled ? "user_cancelled" : "tool_use",
          status,
          stepMutationCount: stepMutations,
          totalMutationCount: totalMutations,
        });
        persistedIterations = completedIterations;
        if (status !== "running") return checkpoint;
        continue;
      }

      if (msg.stop_reason === "max_tokens") {
        messages.push({ role: "user", content: CONTINUE_EXACTLY });
        const cancelled = await isCancelled();
        const status: EditorRunStatus = cancelled
          ? "cancelled"
          : isLastIteration
            ? "continuing"
            : "running";
        const checkpoint = await checkpointIteration({
          runId: claim.id,
          claimToken: claim.claimToken,
          iteration: completedIterations,
          messages,
          visibleOutput: visible,
          visibleDelta,
          modelResponse: msg,
          stopReason: cancelled ? "user_cancelled" : "max_tokens",
          status,
          stepMutationCount: 0,
          totalMutationCount: totalMutations,
        });
        persistedIterations = completedIterations;
        if (status !== "running") return checkpoint;
        continue;
      }

      if (msg.stop_reason === "end_turn") {
        if (await isCancelled()) {
          const checkpoint = await checkpointIteration({
            runId: claim.id,
            claimToken: claim.claimToken,
            iteration: completedIterations,
            messages,
            visibleOutput: visible,
            visibleDelta,
            modelResponse: msg,
            stopReason: "user_cancelled",
            status: "cancelled",
            stepMutationCount: 0,
            totalMutationCount: totalMutations,
          });
          persistedIterations = completedIterations;
          return checkpoint;
        }
        const verifying = await checkpointIteration({
          runId: claim.id,
          claimToken: claim.claimToken,
          iteration: completedIterations,
          messages,
          visibleOutput: visible,
          visibleDelta,
          modelResponse: msg,
          stopReason: "end_turn",
          status: "verifying",
          stepMutationCount: 0,
          totalMutationCount: totalMutations,
        });
        persistedIterations = completedIterations;
        emit({
          type: "phase",
          status: "verifying",
          runId: claim.id,
          stopReason: "end_turn",
          iterationCount: completedIterations,
          mutationCount: totalMutations,
        });
        const final = await finalizeVerification(
          { ...claim, status: verifying.status },
          messages
        );
        return { ...verifying, ...final };
      }

      const terminal = msg.stop_reason === "refusal";
      const status: EditorRunStatus = terminal ? "failed" : "continuing";
      return checkpointIteration({
        runId: claim.id,
        claimToken: claim.claimToken,
        iteration: completedIterations,
        messages,
        visibleOutput: visible,
        visibleDelta,
        modelResponse: msg,
        stopReason: msg.stop_reason || "unknown",
        status,
        stepMutationCount: 0,
        totalMutationCount: totalMutations,
        error: terminal ? "The editor model refused the request." : undefined,
      });
    }

    // Every branch in the loop returns or continues; this protects future edits
    // from accidentally treating budget exhaustion as completion.
    return prisma.editorRun.update({
      where: { id: claim.id, lockToken: claim.claimToken },
      data: {
        status: "continuing",
        stopReason: "slice_exhausted",
        lockToken: null,
        leaseExpiresAt: null,
      },
    });
  } catch (error) {
    return failRun(
      { ...claim, iterationCount: persistedIterations, mutationCount: totalMutations },
      messages,
      visible,
      error,
      emit
    );
  }
}
