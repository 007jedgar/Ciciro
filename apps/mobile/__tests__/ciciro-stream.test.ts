import {
  applyChatStreamEvent,
  emptyChatStreamState,
  isTerminalRunStatus,
} from "../lib/ciciro-stream";

describe("applyChatStreamEvent", () => {
  it("accumulates text, tools, turn ids, and terminal status", () => {
    let state = emptyChatStreamState();
    state = applyChatStreamEvent(state, { type: "turn", id: "t1", runId: "r1" });
    state = applyChatStreamEvent(state, { type: "text", v: "Hel" });
    state = applyChatStreamEvent(state, { type: "text", v: "lo" });
    state = applyChatStreamEvent(state, { type: "tool", v: "drafter" });
    state = applyChatStreamEvent(state, { type: "phase", status: "running", runId: "r1" });
    expect(state).toMatchObject({
      text: "Hello",
      tools: ["drafter"],
      turnId: "t1",
      runId: "r1",
      status: "running",
    });

    state = applyChatStreamEvent(state, { type: "text", v: "Restart", resume: true });
    state = applyChatStreamEvent(state, { type: "done", status: "completed", runId: "r1" });
    expect(state.text).toBe("Restart");
    expect(state.status).toBe("completed");
    expect(isTerminalRunStatus(state.status)).toBe(true);
  });

  it("ignores pings and unknown events", () => {
    const state = emptyChatStreamState();
    expect(applyChatStreamEvent(state, { type: "ping" })).toEqual(state);
    expect(applyChatStreamEvent(state, { type: "ui", event: { type: "open_chapter" } })).toEqual(state);
  });
});
