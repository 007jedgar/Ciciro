import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useCiciroChat } from "../lib/use-ciciro-chat";
import { jsonResponse, mockFetch, ndjsonResponse } from "./http";
import { setSessionToken } from "../lib/session-store";

describe("useCiciroChat", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setSessionToken("tok");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setSessionToken(null);
  });

  it("keeps streamed assistant prose when GET still has an empty assistant row", async () => {
    let gets = 0;
    mockFetch(async (input, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        return ndjsonResponse([
          '{"type":"turn","id":"t1","runId":"r1"}',
          '{"type":"text","v":"The night was quiet."}',
          '{"type":"done","status":"completed","runId":"r1"}',
        ]);
      }
      gets += 1;
      if (gets === 1) return jsonResponse({ messages: [], runs: [] });
      return jsonResponse({
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
        runs: [],
      });
    });

    const { result, unmount } = renderHook(() => useCiciroChat("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.send({ projectId: "p1", message: "Hi" });
    });

    expect(result.current.messages.some((message) => message.content === "The night was quiet.")).toBe(
      true
    );
    expect(result.current.streaming).toBe(false);
    unmount();
  });

  it("shows run visibleOutput after a transcript reload", async () => {
    mockFetch(async () =>
      jsonResponse({
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
            visibleOutput: "Hello from the run.",
            iterationCount: 1,
            mutationCount: 0,
            createdAt: "2026-09-14T00:00:00.000Z",
            updatedAt: "2026-09-14T00:00:00.000Z",
          },
        ],
      })
    );

    const { result, unmount } = renderHook(() => useCiciroChat("p1"));
    await waitFor(() =>
      expect(result.current.messages.some((message) => message.content === "Hello from the run.")).toBe(
        true
      )
    );
    unmount();
  });

  it("classifies a turn that never reached the editor, and replays it on retry", async () => {
    const posts: Record<string, unknown>[] = [];
    let failNext = true;
    mockFetch(async (input, init) => {
      if ((init?.method ?? "GET") !== "POST") return jsonResponse({ messages: [], runs: [] });
      posts.push(JSON.parse(String(init?.body ?? "{}")));
      if (failNext) {
        failNext = false;
        return jsonResponse({ error: "Overloaded" }, { status: 529 });
      }
      return ndjsonResponse([
        '{"type":"turn","id":"t2","runId":"r2"}',
        '{"type":"text","v":"Hello."}',
        '{"type":"done","status":"completed","runId":"r2"}',
      ]);
    });

    const { result, unmount } = renderHook(() => useCiciroChat("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.send({ projectId: "p1", message: "Say hi" });
    });
    expect(result.current.failure).toMatchObject({ code: "overloaded", retryable: true });

    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.failure).toBeNull();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toMatchObject({ message: "Say hi" });
    // A failed run replays its own error, so a retry must be a fresh turn.
    expect(posts[0]!.clientTurnId).not.toBe(posts[1]!.clientTurnId);
    unmount();
  });
});
