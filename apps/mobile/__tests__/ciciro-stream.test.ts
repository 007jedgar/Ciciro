import {
  applyChatStreamEvent,
  emptyChatStreamState,
  hydrateChatMessages,
  isTerminalRunStatus,
  mergeChatTranscript,
  upsertStreamAssistant,
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

describe("hydrateChatMessages", () => {
  it("fills empty assistant content from the run visibleOutput", () => {
    const messages = hydrateChatMessages({
      messages: [
        {
          id: "u1",
          role: "user",
          content: "Hi",
          kind: "chat",
          createdAt: "2026-09-14T00:00:00.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          content: "",
          kind: "chat",
          turnId: "t1",
          createdAt: "2026-09-14T00:00:00.000Z",
        },
      ],
      runs: [
        {
          id: "r1",
          projectId: "p1",
          turnId: "t1",
          status: "completed",
          visibleOutput: "The night was quiet.",
          iterationCount: 1,
          mutationCount: 0,
          createdAt: "2026-09-14T00:00:00.000Z",
          updatedAt: "2026-09-14T00:00:00.000Z",
        },
      ],
    });
    expect(messages.map((message) => message.content)).toEqual(["Hi", "The night was quiet."]);
  });

  it("adds an assistant message when only the run has prose", () => {
    const messages = hydrateChatMessages({
      messages: [
        {
          id: "u1",
          role: "user",
          content: "Hi",
          kind: "chat",
          createdAt: "2026-09-14T00:00:00.000Z",
        },
      ],
      runs: [
        {
          id: "r1",
          projectId: "p1",
          turnId: "t1",
          assistantMessageId: "a1",
          status: "completed",
          visibleOutput: "From the run.",
          iterationCount: 1,
          mutationCount: 0,
          createdAt: "2026-09-14T00:00:00.000Z",
          updatedAt: "2026-09-14T00:00:00.000Z",
        },
      ],
    });
    expect(messages[1]).toMatchObject({
      id: "a1",
      role: "assistant",
      content: "From the run.",
      turnId: "t1",
    });
  });
});

describe("upsertStreamAssistant", () => {
  it("keeps streamed prose when the server assistant row is still empty", () => {
    const local = upsertStreamAssistant([], {
      text: "Hello from stream",
      tools: [],
      turnId: "t1",
      runId: "r1",
      status: "completed",
    });
    const merged = mergeChatTranscript(
      [
        {
          id: "u1",
          role: "user",
          content: "Hi",
          kind: "chat",
          createdAt: "2026-09-14T00:00:00.000Z",
        },
        {
          id: "a1",
          role: "assistant",
          content: "",
          kind: "chat",
          turnId: "t1",
          createdAt: "2026-09-14T00:00:00.000Z",
        },
      ],
      local
    );
    expect(merged.find((message) => message.role === "assistant")?.content).toBe("Hello from stream");
  });
});
