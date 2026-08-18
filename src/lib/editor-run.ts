import type Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { getAnthropic, EDITOR_MODEL } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { buildEditorContext } from "@/lib/context";
import { EDITOR_SYSTEM } from "@/lib/prompts";
import { EDITOR_TOOLS, executeEditorTool, toolUiEvents } from "@/lib/tools";
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
  resumeTurnId?: string;
  continueFrom?: string;
  forceCompact?: boolean;
  clientTurnId?: string;
};

export type EditorRunEvent =
  | { type: "text"; v: string; resume?: boolean }
  | { type: "tool"; v: string }
  | ({ type: string } & Record<string, unknown>);

type Emit = (event: EditorRunEvent) => void;

const MAX_ITERATIONS_PER_SLICE = 6;
const MAX_STREAM_RETRIES = 2;
const LEASE_MS = 11 * 60_000;

const CONTINUE_EXACTLY =
  "Continue exactly where you left off - mid-word if that is where it cut off. " +
  "Do not repeat or restate anything already written, and do not comment on the cutoff.";

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
    created = await prisma.$transaction(async (tx) => {
      const user =
        legacyUser ||
        (await tx.chatMessage.create({
          data: {
            projectId: input.projectId,
            role: "user",
            content: message,
            kind: input.kind || "chat",
            turnId,
            status: "complete",
          },
        }));
      return tx.editorRun.create({
        data: {
          projectId: input.projectId,
          turnId,
          userMessageId: user.id,
          assistantMessageId: legacyAssistant?.id,
          kind: input.kind || legacyUser?.kind || "chat",
          scope: input.scope,
          activeChapterId: input.activeChapterId,
          selection: input.selection || "",
          autoMode: Boolean(input.autoMode),
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

    let reorgBlock = "";
    let namedChapterNumbers: number[] = [];
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
    const intent = await buildEditorIntent({
      projectId: input.projectId,
      message,
      selection: input.selection,
      activeChapterId: input.activeChapterId,
      kind: input.kind,
    });
    const route = await routeEditorWork({
      message,
      kind: input.kind,
      intent,
    });
    const context = await buildEditorContext(
      input.projectId,
      input.activeChapterId,
      input.scope,
      Boolean(input.autoMode),
      namedChapterNumbers
    );
    const intentBlock = formatEditorIntent(intent);
    const routeBlock = formatEditorRoute(route);
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

    if (visibleSeed) {
      messages.push({ role: "assistant", content: visibleSeed });
      messages.push({
        role: "user",
        content:
          `<context>\n${contextWithPlan}\n</context>${selectionBlock}\n\n` +
          continuePrompt(visibleSeed),
      });
    } else {
      const last = messages.length - 1;
      const row = messages[last];
      if (row?.role !== "user") {
        throw new Error("Editor run has no final user message.");
      }
      messages[last] = {
        role: "user",
        content: `<context>\n${contextWithPlan}\n</context>${selectionBlock}\n\n${row.content}`,
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
      : input.status === "failed"
        ? "partial"
        : "continuing";
  const assistantContent = healAssistantContent(input.visibleOutput, {
    closeDrafts: input.status === "completed",
  });

  return prisma.$transaction(async (tx) => {
    const current = await tx.editorRun.findUniqueOrThrow({
      where: { id: input.runId },
    });
    if (current.lockToken !== input.claimToken) {
      throw new Error("Editor run lease was lost.");
    }

    let assistantMessageId = current.assistantMessageId;
    if (assistantMessageId) {
      await tx.chatMessage.update({
        where: { id: assistantMessageId },
        data: {
          content: assistantContent,
          status: chatStatus,
          kind: current.kind,
        },
      });
    } else if (assistantContent.trim()) {
      const assistant = await tx.chatMessage.create({
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

    await tx.editorStep.create({
      data: {
        runId: input.runId,
        iteration: input.iteration,
        status: input.status,
        stopReason: input.stopReason,
        modelResponseJson: serialize(input.modelResponse),
        toolResultsJson: input.toolResults
          ? serialize(input.toolResults)
          : null,
        visibleDelta: input.visibleDelta,
        mutationCount: input.stepMutationCount,
      },
    });

    return tx.editorRun.update({
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
          input.verification === undefined
            ? undefined
            : serialize(input.verification),
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
  });
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
  const final = await prisma.$transaction(async (tx) => {
    const updated = await tx.editorRun.update({
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
    if (updated.assistantMessageId) {
      await tx.chatMessage.update({
        where: { id: updated.assistantMessageId },
        data: {
          content: healAssistantContent(updated.visibleOutput, {
            closeDrafts: finalStatus === "completed",
          }),
          status: finalStatus === "completed" ? "complete" : "continuing",
        },
      });
    }
    return updated;
  });
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

  try {
    if (claim.status === "verifying") {
      return finalizeVerification(claim, messages);
    }

    for (let sliceIndex = 0; sliceIndex < MAX_ITERATIONS_PER_SLICE; sliceIndex++) {
      let msg: Anthropic.Message | undefined;
      let visibleDelta = "";
      let midStreamDrop = false;

      for (let attempt = 0; ; attempt++) {
        const beforeAttempt = visible;
        const beforeDelta = visibleDelta;
        let emittedThisAttempt = false;
        try {
          const stream = anthropic.messages.stream({
            model: EDITOR_MODEL,
            max_tokens: requestProfile.maxTokens,
            thinking: { type: "adaptive" },
            output_config: { effort: requestProfile.effort },
            system: [
              {
                type: "text",
                text: EDITOR_SYSTEM,
                cache_control: { type: "ephemeral" },
              },
            ],
            tools: EDITOR_TOOLS,
            messages,
          });

          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              emittedThisAttempt = true;
              visible += event.delta.text;
              visibleDelta += event.delta.text;
              emit({ type: "text", v: event.delta.text });
            }
          }
          msg = await stream.finalMessage();
          break;
        } catch (error) {
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
        for (const block of msg.content) {
          if (block.type !== "tool_use") continue;
          const result = await executeEditorTool(
            block.name,
            (block.input as Record<string, unknown>) || {},
            {
              projectId: claim.projectId,
              activeChapterId: claim.activeChapterId,
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
        const status: EditorRunStatus = isLastIteration
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
          stopReason: "tool_use",
          status,
          stepMutationCount: stepMutations,
          totalMutationCount: totalMutations,
        });
        persistedIterations = completedIterations;
        if (status === "continuing") return checkpoint;
        continue;
      }

      if (msg.stop_reason === "max_tokens") {
        messages.push({ role: "user", content: CONTINUE_EXACTLY });
        const status: EditorRunStatus = isLastIteration
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
          stopReason: "max_tokens",
          status,
          stepMutationCount: 0,
          totalMutationCount: totalMutations,
        });
        persistedIterations = completedIterations;
        if (status === "continuing") return checkpoint;
        continue;
      }

      if (msg.stop_reason === "end_turn") {
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
