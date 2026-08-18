import { NextRequest, after } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
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
  archiveAsBlob,
  ensureModelContent,
  OVERSIZE_CHARS,
  selectionForModel,
  toModelMessages,
} from "@/lib/message-view";
import {
  continuePrompt,
  healAssistantContent,
  stripErrorFooter,
} from "@/lib/heal";

export const runtime = "nodejs";
export const maxDuration = 600;

const MAX_ITERATIONS = 6;
const MAX_STREAM_RETRIES = 2;
const PING_MS = 12_000;

// Long extended-thinking turns can sit silent for minutes; the underlying
// connection to the API occasionally drops mid-stream (surfaces as a bare
// "terminated" error from undici) with nothing lost yet on our side. Retrying
// the same call is safe as long as no text has reached the client for this
// attempt - once prose has started streaming we continue from the partial
// instead of abandoning the turn.
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

type Scope = "selection" | "chapter" | "book";

// POST /api/chat — run the editor (Opus) as an agentic loop. It streams prose to
// the author and calls tools between turns (retrieval, decision capture, and
// dispatching prose to the drafter). Emits newline-delimited JSON events:
//   {"type":"turn","id":"..."}  stable id for resume after drops
//   {"type":"text","v":"..."}   editor prose delta (shown to the author)
//   {"type":"tool","v":"..."}   backstage status (reading X, drafting with Sonnet)
//   {"type":"open_chapter"|...} client side-effect (open/create/update chapter)
//   {"type":"ping"}             keepalive so clients can detect dead links
//   {"type":"compact","v":"..."} auto-compact notice
//   {"type":"done","status":"complete"|"partial"}
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    projectId,
    message,
    activeChapterId,
    selection,
    kind,
    scope,
    autoMode,
    resumeTurnId,
    continueFrom,
    forceCompact,
    clientTurnId,
  } = body as {
    projectId?: string;
    message?: string;
    activeChapterId?: string | null;
    selection?: string;
    kind?: string;
    scope?: Scope;
    autoMode?: boolean;
    resumeTurnId?: string;
    continueFrom?: string;
    forceCompact?: boolean;
    clientTurnId?: string;
  };

  if (!projectId) {
    return json({ error: "projectId required" }, 400);
  }

  // Manual compact from the chat header - no model turn, just shrink history.
  if (body.compactOnly) {
    try {
      getAnthropic();
      const result = await maybeCompactChat(projectId, true);
      return json(result, 200);
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  }

  if (!resumeTurnId && !message?.trim()) {
    return json({ error: "projectId and message required" }, 400);
  }

  let anthropic;
  try {
    anthropic = getAnthropic();
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  await ensureBible(projectId);

  // Auto-compact (or forced) before building the model window - not on resume,
  // where we need the partial assistant row to stay put.
  let compactNotice: string | null = null;
  if (!resumeTurnId) {
    try {
      const result = await maybeCompactChat(projectId, Boolean(forceCompact));
      if (result.compacted) {
        compactNotice =
          result.statusLine ||
          backstageLine("compact", `${result.removed} earlier pages`);
      }
    } catch {
      /* compact is best-effort; never block the turn */
    }
  }

  // Prefer the client's turn id so a drop before the first NDJSON event still
  // resumes against the same row the browser persisted in sessionStorage.
  const turnId =
    resumeTurnId ||
    (typeof clientTurnId === "string" && clientTurnId.trim()) ||
    crypto.randomUUID();
  let msgKind = kind || "chat";
  let partialSeed = "";
  let existingAssistantId: string | null = null;

  if (resumeTurnId) {
    const prior = await prisma.chatMessage.findMany({
      where: { projectId, turnId: resumeTurnId },
      orderBy: { createdAt: "asc" },
    });
    const userMsg = prior.find((m) => m.role === "user");
    const assistantMsg = [...prior]
      .reverse()
      .find((m) => m.role === "assistant");

    if (!userMsg) {
      return json({ error: "Nothing to resume for that turn" }, 404);
    }
    msgKind = userMsg.kind || "chat";

    if (assistantMsg?.status === "complete" && assistantMsg.content.trim()) {
      // Server already finished while the client was gone - replay and exit.
      return replayCompleted(assistantMsg.content, turnId);
    }

    partialSeed = stripErrorFooter(
      continueFrom || assistantMsg?.content || ""
    );
    existingAssistantId = assistantMsg?.id ?? null;
  } else {
    await prisma.chatMessage.create({
      data: {
        projectId,
        role: "user",
        content: message!.trim(),
        kind: msgKind,
        turnId,
        status: "complete",
      },
    });
  }

  // Live window only - soft-archived rows stay in DB for read_past_turn.
  const history = await prisma.chatMessage.findMany({
    where: { projectId, archivedAt: null },
    orderBy: { createdAt: "asc" },
    take: 40,
  });

  // Drop any partial assistant row for this turn from the model history - we
  // re-inject it via the continue prompt instead.
  const historyForModel = history.filter(
    (m) => !(m.role === "assistant" && m.turnId === turnId)
  );

  const context = await buildEditorContext(
    projectId,
    activeChapterId,
    scope,
    Boolean(autoMode)
  );
  const userText =
    (!resumeTurnId && message?.trim()) ||
    historyForModel.find((m) => m.role === "user" && m.turnId === turnId)
      ?.content ||
    message?.trim() ||
    "";
  let reorgBlock = "";
  try {
    const plan = await buildReorgPlan({
      projectId,
      message: userText,
      selection: selection || "",
      activeChapterId,
    });
    reorgBlock = formatReorgPlan(plan);
  } catch {
    /* planner is advisory; never block the turn */
  }
  const contextWithPlan = reorgBlock
    ? `${context}\n\n${reorgBlock}`
    : context;
  const selectionBlock = await selectionForModel(
    projectId,
    selection || "",
    turnId
  );

  // Stub inserted drafts / aged content once from stored data - never
  // regenerate mid-resume in a way that would reshape tool pairings.
  // Mid-turn tool_use/tool_result pairs live only in the in-memory `messages`
  // array below; resume rebuilds from persisted rows + partialSeed (heal.ts).
  const baseMessages = await toModelMessages(projectId, historyForModel);
  const messages: Anthropic.MessageParam[] = baseMessages.map((m, i) => {
    const isLast = i === baseMessages.length - 1;
    if (isLast && m.role === "user" && !partialSeed) {
      return {
        role: "user" as const,
        content: `<context>\n${contextWithPlan}\n</context>${selectionBlock}\n\n${m.content}`,
      };
    }
    return m;
  });

  if (partialSeed) {
    messages.push({ role: "assistant", content: partialSeed });
    messages.push({
      role: "user",
      content:
        `<context>\n${contextWithPlan}\n</context>${selectionBlock}\n\n` +
        continuePrompt(partialSeed),
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        } catch {
          closed = true;
        }
      };

      // Keepalives so the client stall detector knows we're still alive during
      // long thinking / tool pauses (even when no text deltas arrive).
      const pingTimer = setInterval(() => emit({ type: "ping" }), PING_MS);

      let visible = partialSeed;
      let finalStatus: "complete" | "partial" = "complete";

      emit({ type: "turn", id: turnId });
      if (compactNotice) emit({ type: "tool", v: compactNotice });
      if (partialSeed) {
        emit({ type: "tool", v: "Resuming interrupted reply…" });
        // Re-send the already-written prefix so the client bubble matches the
        // server seed even if its local partial was empty/stale.
        emit({ type: "text", v: partialSeed, resume: true });
      }

      try {
        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          let msg: Anthropic.Message | undefined;
          let midStreamDrop = false;

          for (let attempt = 0; ; attempt++) {
            let emittedThisAttempt = false;
            const visibleBeforeAttempt = visible;
            try {
              const s = anthropic.messages.stream({
                model: EDITOR_MODEL,
                max_tokens: 16000,
                thinking: { type: "adaptive" },
                output_config: { effort: "high" },
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

              for await (const event of s) {
                if (
                  event.type === "content_block_delta" &&
                  event.delta.type === "text_delta"
                ) {
                  // On a true resume seed we already emitted the prefix; only
                  // forward new deltas. Mid-attempt retries that hadn't emitted
                  // yet append normally.
                  const delta = event.delta.text;
                  visible += delta;
                  emittedThisAttempt = true;
                  emit({ type: "text", v: delta });
                }
              }

              msg = await s.finalMessage();
              break;
            } catch (err) {
              if (
                !emittedThisAttempt &&
                attempt < MAX_STREAM_RETRIES &&
                isRetryableStreamError(err)
              ) {
                visible = visibleBeforeAttempt;
                emit({ type: "tool", v: "Connection dropped, reconnecting…" });
                await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
                continue;
              }

              // Text already reached the client - heal by continuing from the
              // partial in a fresh iteration rather than discarding it.
              if (
                emittedThisAttempt &&
                isRetryableStreamError(err) &&
                iter < MAX_ITERATIONS - 1
              ) {
                midStreamDrop = true;
                emit({
                  type: "tool",
                  v: "Connection dropped mid-reply, continuing…",
                });
                break;
              }
              throw err;
            }
          }

          if (midStreamDrop) {
            const written = stripErrorFooter(visible);
            messages.push({ role: "assistant", content: written });
            messages.push({
              role: "user",
              content:
                "Continue exactly where you left off - mid-word if that's where it cut " +
                "off. Do not repeat or restate anything already written, and do not " +
                "comment on the cutoff.",
            });
            continue;
          }

          if (!msg) break;

          messages.push({ role: "assistant", content: msg.content });

          // Hit the output cap mid-reply (e.g. writing full chapters inline
          // instead of dispatching) - resume in the next iteration rather
          // than ending the turn with a truncated sentence and a dangling
          // <draft> tag.
          if (msg.stop_reason === "max_tokens") {
            if (iter === MAX_ITERATIONS - 1) break;
            messages.push({
              role: "user",
              content:
                "Continue exactly where you left off - mid-word if that's where it cut " +
                "off. Do not repeat or restate anything already written, and do not " +
                "comment on the cutoff.",
            });
            continue;
          }

          if (msg.stop_reason !== "tool_use") break;

          // Tool results from earlier iterations have already been seen by the
          // model (they produced this response). Stub those now so later
          // iterations stay lean - never stub the batch we're about to add.
          await stubConsumedToolResults(messages, projectId, turnId);

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of msg.content) {
            if (block.type !== "tool_use") continue;
            const result = await executeEditorTool(
              block.name,
              (block.input as Record<string, unknown>) || {},
              { projectId, activeChapterId }
            );
            emit({ type: "tool", v: result.status });
            for (const ui of toolUiEvents(result.ui)) {
              emit(ui);
            }
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: result.content,
            });
          }
          messages.push({ role: "user", content: toolResults });
        }
      } catch (err) {
        const m = `\n\n[Ciciro error: ${(err as Error).message}]`;
        visible += m;
        emit({ type: "text", v: m });
        finalStatus = "partial";
      } finally {
        clearInterval(pingTimer);

        const raw = stripErrorFooter(visible);
        if (raw.trim()) {
          // Close dangling drafts only when the turn truly finished; leave
          // them open on partial so a resume can continue inside <draft>.
          const content = healAssistantContent(raw, {
            closeDrafts: finalStatus === "complete",
          });
          // If we errored after writing something, mark partial so the client
          // (or a later load) can resume.
          const status =
            finalStatus === "partial" || visible.includes("[Ciciro error:")
              ? "partial"
              : "complete";

          let savedId = existingAssistantId;
          if (existingAssistantId) {
            await prisma.chatMessage.update({
              where: { id: existingAssistantId },
              data: { content, status, kind: msgKind },
            });
          } else {
            const created = await prisma.chatMessage.create({
              data: {
                projectId,
                role: "assistant",
                content,
                kind: msgKind,
                turnId,
                status,
              },
            });
            savedId = created.id;
          }
          finalStatus = status;
          if (savedId && status === "complete") {
            after(() => {
              ensureModelContent(savedId!).catch(() => {});
            });
          }
        }

        emit({ type: "done", status: finalStatus });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        closed = true;
      }
    },
    cancel() {
      // Client went away - the start() loop may still finish and persist so a
      // later resume/poll can pick up the completed reply.
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}

/**
 * Replace oversized tool_result payloads that the model has already consumed
 * with stable ChatBlob stubs. Mutates `messages` in place. Resume does not
 * rebuild this array - it continues from persisted ChatMessage rows only.
 */
async function stubConsumedToolResults(
  messages: Anthropic.MessageParam[],
  projectId: string,
  turnId: string
): Promise<void> {
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    let changed = false;
    const next: Anthropic.ContentBlockParam[] = [];
    for (const block of m.content) {
      if (
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "tool_result" &&
        typeof block.content === "string" &&
        block.content.length > OVERSIZE_CHARS &&
        !block.content.startsWith("[tool_result ref:")
      ) {
        const archived = await archiveAsBlob({
          projectId,
          kind: "tool_result",
          content: block.content,
          label: "prior tool result",
          turnId,
        });
        next.push({ ...block, content: archived.stub });
        changed = true;
      } else {
        next.push(block as Anthropic.ContentBlockParam);
      }
    }
    if (changed) {
      messages[i] = { role: "user", content: next };
    }
  }
}

function replayCompleted(content: string, turnId: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const emit = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      emit({ type: "turn", id: turnId });
      emit({ type: "tool", v: "Recovered finished reply from the server." });
      emit({ type: "text", v: content, resume: true });
      emit({ type: "done", status: "complete" });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
    },
  });
}

// GET /api/chat?projectId=... — load live (non-archived) chat history.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return json({ error: "projectId required" }, 400);
  const messages = await prisma.chatMessage.findMany({
    where: { projectId, archivedAt: null },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return json(messages, 200);
}

// DELETE /api/chat?projectId=... — hard-clear chat, archives, and blobs.
// Escape hatch for a poisoned conversation; automatic compaction only archives.
export async function DELETE(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return json({ error: "projectId required" }, 400);
  await prisma.$transaction([
    prisma.chatBlob.deleteMany({ where: { projectId } }),
    prisma.draftInsertion.deleteMany({ where: { projectId } }),
    prisma.chatMessage.deleteMany({ where: { projectId } }),
  ]);
  return json({ ok: true }, 200);
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
