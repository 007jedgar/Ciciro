// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSnapshot, EditorRun, EditorRunStatus } from "@/lib/types";
import {
  loadPendingTurn,
  resolvePendingTurn,
  savePendingTurn,
  type PendingTurn,
} from "@/lib/pending-turn";
import {
  isTerminalRunStatus,
  readNdjsonStream,
  type NdjsonEvent,
} from "@/lib/ndjson-stream";

function run(turnId: string, status: EditorRunStatus): EditorRun {
  return {
    id: `run-${turnId}`,
    projectId: "project-1",
    turnId,
    kind: "action",
    status,
    visibleOutput: `saved ${turnId}`,
    iterationCount: 6,
    mutationCount: 1,
    stopReason: status === "continuing" ? "max_tokens" : "end_turn",
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:01:00.000Z",
  };
}

function stored(turnId: string): PendingTurn {
  return {
    projectId: "project-1",
    turnId,
    message: `message ${turnId}`,
    kind: "action",
    activeChapterId: null,
    selection: "",
    partialText: `local ${turnId}`,
    startedAt: Date.now(),
  };
}

describe("client continuation and reload", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips a pending turn through reload storage", () => {
    const pending = stored("reload-turn");
    savePendingTurn(pending);
    expect(loadPendingTurn("project-1")).toEqual(pending);
  });

  it("prefers the authoritative unfinished run over a stale stored turn", () => {
    const stale = stored("stale-turn");
    const current = run("current-turn", "continuing");
    const snapshot: ChatSnapshot = {
      runs: [current],
      messages: [
        {
          id: "user-current",
          role: "user",
          content: "authoritative request",
          kind: "action",
          turnId: current.turnId,
          createdAt: current.createdAt,
        },
      ],
    };

    expect(resolvePendingTurn("project-1", snapshot, stale)).toMatchObject({
      turnId: "current-turn",
      runId: "run-current-turn",
      message: "authoritative request",
      partialText: "saved current-turn",
      status: "continuing",
    });
  });

  it("does not resume terminal runs after reload", () => {
    const terminal = run("done-turn", "failed");
    expect(
      resolvePendingTurn(
        "project-1",
        { runs: [terminal], messages: [] },
        stored("done-turn")
      )
    ).toBeNull();
    expect(isTerminalRunStatus("failed")).toBe(true);
    expect(isTerminalRunStatus("cancelled")).toBe(true);
    expect(isTerminalRunStatus("continuing")).toBe(false);
  });

  it("parses split NDJSON chunks and preserves continuing status", async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const chunks = [
      '{"type":"turn","id":"turn-1","runId":"run-1"}\n{"type":"te',
      'xt","v":"saved"}\n{"type":"done","status":"continuing","runId":"run-1","stopReason":"max_tokens"}\n',
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const events: NdjsonEvent[] = [];

    await readNdjsonStream(stream, {
      stallMs: 5_000,
      onEvent: (event) => events.push(event),
    });
    vi.useRealTimers();

    expect(events).toEqual([
      { type: "turn", id: "turn-1", runId: "run-1" },
      { type: "text", v: "saved" },
      {
        type: "done",
        status: "continuing",
        runId: "run-1",
        stopReason: "max_tokens",
      },
    ]);
  });
});
