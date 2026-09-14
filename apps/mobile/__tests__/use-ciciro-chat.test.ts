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
});
