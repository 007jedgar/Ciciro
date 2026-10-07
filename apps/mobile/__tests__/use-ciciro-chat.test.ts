import { act, renderHook, waitFor } from "@testing-library/react-native";
import { queryClient, queryKeys } from "../lib/api";
import { useCiciroChat } from "../lib/use-ciciro-chat";
import { jsonResponse, mockFetch, ndjsonResponse, parsedBody } from "./http";
import { setSessionToken } from "../lib/session-store";
import { chatRequestFromComposer } from "../lib/ciciro-intents";

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
  it("hands back an allowance-used-up failure so the screen can keep the author's words", async () => {
    mockFetch(async (input, init) => {
      if ((init?.method ?? "GET") !== "POST") return jsonResponse({ messages: [], runs: [] });
      return jsonResponse(
        { error: "You've used this month's free AI allowance.", code: "ai_limit_reached", entitlement: { plan: "free" } },
        { status: 402 }
      );
    });

    const { result, unmount } = renderHook(() => useCiciroChat("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let failure: unknown;
    await act(async () => {
      failure = await result.current.send({ projectId: "p1", message: "What next?" });
    });
    expect(failure).toMatchObject({ code: "aiLimit", retryable: false, plan: "free" });
    expect(result.current.failure).toMatchObject({ code: "aiLimit" });
    unmount();
  });

  it("reloads the transcript on retry when loading it was what failed", async () => {
    let gets = 0;
    let posts = 0;
    mockFetch(async (input, init) => {
      if ((init?.method ?? "GET") === "POST") {
        posts += 1;
        return jsonResponse({});
      }
      gets += 1;
      if (gets === 1) return jsonResponse({ error: "Bad gateway" }, { status: 502 });
      return jsonResponse({ messages: [], runs: [] });
    });

    const { result, unmount } = renderHook(() => useCiciroChat("p1"));
    await waitFor(() => expect(result.current.failure).toMatchObject({ retryable: true }));

    await act(async () => {
      await result.current.retry();
    });
    expect(gets).toBe(2);
    expect(posts).toBe(0);
    expect(result.current.failure).toBeNull();
    unmount();
  });

  it("stops a reply that never finishes, keeping the words that arrived", async () => {
    // A hosted run that sends one chunk and then holds the connection open.
    const encoder = new TextEncoder();
    mockFetch(async (input, init) => {
      const method = init?.method ?? "GET";
      if (method !== "POST") return jsonResponse({ messages: [], runs: [] });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('{"type":"turn","id":"t1"}\n'));
            controller.enqueue(encoder.encode('{"type":"text","v":"Setting up the bible."}\n'));
          },
        }),
        { status: 200, headers: { "content-type": "application/x-ndjson" } }
      );
    });

    const { result, unmount } = renderHook(() => useCiciroChat("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let sent: Promise<void> | undefined;
    act(() => {
      sent = result.current.send({ projectId: "p1", message: "Write chapter one" });
    });
    await waitFor(() => expect(result.current.stream.text).toBe("Setting up the bible."));

    await act(async () => {
      result.current.stop();
      await sent;
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.failure).toBeNull();
    expect(
      result.current.messages.some((message) => message.content === "Setting up the bible.")
    ).toBe(true);
    unmount();
  });

  it("asks the server to cancel the run when stopped, not just the local read", async () => {
    const encoder = new TextEncoder();
    const fetchMock = mockFetch(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/chat/cancel")) {
        return jsonResponse({ runId: "r1", turnId: "t1", status: "running" });
      }
      if (method !== "POST") return jsonResponse({ messages: [], runs: [] });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('{"type":"turn","id":"t1","runId":"r1"}\n'));
            controller.enqueue(encoder.encode('{"type":"text","v":"Chapter one."}\n'));
          },
        }),
        { status: 200, headers: { "content-type": "application/x-ndjson" } }
      );
    });

    const { result, unmount } = renderHook(() => useCiciroChat("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let sent: Promise<void> | undefined;
    act(() => {
      sent = result.current.send({
        projectId: "p1",
        message: "Write chapter one, then chapter two",
      });
    });
    await waitFor(() => expect(result.current.stream.text).toBe("Chapter one."));

    await act(async () => {
      result.current.stop();
      await sent;
    });

    const cancelCall = fetchMock.mock.calls.find(([requestUrl]) =>
      String(requestUrl).endsWith("/api/chat/cancel")
    );
    expect(cancelCall).toBeDefined();
    expect(parsedBody(cancelCall?.[1] as RequestInit)).toEqual({
      projectId: "p1",
      turnId: "t1",
    });
    unmount();
  });

  it("cancels by the client turn id when stopped before the run exists, retrying past the 404", async () => {
    let cancelCalls = 0;
    const fetchMock = mockFetch(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/chat/cancel")) {
        cancelCalls += 1;
        return cancelCalls === 1
          ? jsonResponse({ error: "No matching editor run" }, { status: 404 })
          : jsonResponse({ runId: "r1", turnId: "client-1", status: "running" });
      }
      if (method !== "POST") return jsonResponse({ messages: [], runs: [] });
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
      });
    });

    const { result, unmount } = renderHook(() => useCiciroChat("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let sent: Promise<unknown> | undefined;
    act(() => {
      sent = result.current.send({
        projectId: "p1",
        message: "Write chapter one, then chapter two",
        clientTurnId: "client-1",
      });
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    await act(async () => {
      result.current.stop();
      await sent;
    });

    await waitFor(() => expect(cancelCalls).toBe(2), { timeout: 3000 });
    const bodies = fetchMock.mock.calls
      .filter(([requestUrl]) => String(requestUrl).endsWith("/api/chat/cancel"))
      .map(([, requestInit]) => parsedBody(requestInit as RequestInit));
    expect(bodies).toEqual([
      { projectId: "p1", turnId: "client-1" },
      { projectId: "p1", turnId: "client-1" },
    ]);
    unmount();
  });

  describe("Allow edits / Chat only", () => {
    const stamp = "2026-09-14T00:00:00.000Z";
    const turn = (editsAllowed: boolean) => ({
      messages: [
        { id: "u1", role: "user", content: "Hi", kind: "chat", turnId: "t1", createdAt: stamp },
        { id: "a1", role: "assistant", content: "Hello", kind: "chat", turnId: "t1", createdAt: stamp },
      ],
      runs: [
        {
          id: "r1",
          projectId: "p1",
          turnId: "t1",
          status: "completed",
          visibleOutput: "Hello",
          iterationCount: 1,
          mutationCount: 0,
          editsAllowed,
          createdAt: stamp,
          updatedAt: stamp,
        },
      ],
    });

    function chatServer(initial: { messages: unknown[]; runs: unknown[] }) {
      const state = { snapshot: initial, posts: [] as Record<string, unknown>[] };
      mockFetch(async (input, init) => {
        const method = init?.method ?? "GET";
        if (method === "DELETE") {
          state.snapshot = { messages: [], runs: [] };
          return jsonResponse({ ok: true, archivedAt: stamp, count: 2 });
        }
        if (method === "POST") {
          state.posts.push(parsedBody(init as RequestInit));
          return ndjsonResponse([
            '{"type":"turn","id":"t-new","runId":"r-new"}',
            '{"type":"text","v":"Done."}',
            '{"type":"done","status":"completed","runId":"r-new"}',
          ]);
        }
        return jsonResponse(state.snapshot);
      });
      return state;
    }

    it("starts on Allow edits and sends editsAllowed with the turn", async () => {
      const server = chatServer({ messages: [], runs: [] });
      const { result, unmount } = renderHook(() => useCiciroChat("p1"));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.editMode).toBe("edits");

      await act(async () => {
        await result.current.send({ projectId: "p1", message: "Hello" });
      });
      expect(server.posts[0]).toMatchObject({ message: "Hello", editsAllowed: true });
      unmount();
    });

    it("keeps Chat only for every later turn of the conversation", async () => {
      const server = chatServer({ messages: [], runs: [] });
      const { result, unmount } = renderHook(() => useCiciroChat("p1"));
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => result.current.setEditMode("chat"));
      expect(result.current.editMode).toBe("chat");
      await act(async () => {
        await result.current.send({ projectId: "p1", message: "One" });
      });
      await act(async () => {
        await result.current.send({ projectId: "p1", message: "Two" });
      });
      expect(server.posts.map((post) => post.editsAllowed)).toEqual([false, false]);
      expect(result.current.editMode).toBe("chat");
      unmount();
    });

    it("restores the conversation's mode when it loads again", async () => {
      chatServer(turn(false));
      const { result, unmount } = renderHook(() => useCiciroChat("p1"));
      await waitFor(() => expect(result.current.editMode).toBe("chat"));
      unmount();
    });

    it("goes back to Allow edits on a new thread, and Undo brings the old mode back", async () => {
      const server = chatServer(turn(false));
      const original = server.snapshot;
      const { result, unmount } = renderHook(() => useCiciroChat("p1"));
      await waitFor(() => expect(result.current.editMode).toBe("chat"));

      let token: string | null = null;
      await act(async () => {
        token = await result.current.clear();
      });
      expect(result.current.editMode).toBe("edits");
      await act(async () => {
        await result.current.send({ projectId: "p1", message: "A fresh start" });
      });
      expect(server.posts[0]).toMatchObject({ editsAllowed: true });

      server.snapshot = original;
      await act(async () => {
        await result.current.undoClear(token as unknown as string);
      });
      await waitFor(() => expect(result.current.editMode).toBe("chat"));
      unmount();
    });

    it("replays a failed turn in the mode it was sent in", async () => {
      const posts: Record<string, unknown>[] = [];
      let failNext = true;
      mockFetch(async (_input, init) => {
        if ((init?.method ?? "GET") !== "POST") return jsonResponse({ messages: [], runs: [] });
        posts.push(parsedBody(init as RequestInit));
        if (failNext) {
          failNext = false;
          return jsonResponse({ error: "Overloaded" }, { status: 529 });
        }
        return ndjsonResponse(['{"type":"done","status":"completed","runId":"r1"}']);
      });
      const { result, unmount } = renderHook(() => useCiciroChat("p1"));
      await waitFor(() => expect(result.current.loading).toBe(false));
      act(() => result.current.setEditMode("chat"));
      await act(async () => {
        await result.current.send({ projectId: "p1", message: "Hi" });
      });
      act(() => result.current.setEditMode("edits"));
      await act(async () => {
        await result.current.retry();
      });
      expect(posts.map((post) => post.editsAllowed)).toEqual([false, false]);
      unmount();
    });
  });

  describe("cached transcript", () => {
    const snapshot = {
      messages: [
        {
          id: "u1",
          role: "user" as const,
          content: "Hi",
          kind: "chat",
          createdAt: "2026-09-14T00:00:00.000Z",
        },
        {
          id: "a1",
          role: "assistant" as const,
          content: "Hello again.",
          kind: "chat",
          turnId: "t1",
          createdAt: "2026-09-14T00:00:00.000Z",
        },
      ],
      runs: [],
    };

    afterEach(() => {
      queryClient.clear();
    });

    it("renders on first render with no empty state, before any fetch resolves", async () => {
      queryClient.setQueryData(queryKeys.chat.snapshot("p1"), snapshot);
      // Never resolves within this test, so a pass can only be explained by
      // the synchronous cache seed, not a fast network round trip.
      mockFetch(() => new Promise(() => {}));

      const { result, unmount } = renderHook(() => useCiciroChat("p1"));

      expect(result.current.loading).toBe(false);
      expect(result.current.messages.map((message) => message.content)).toEqual([
        "Hi",
        "Hello again.",
      ]);
      unmount();
    });

    it("paints the cached transcript instantly, then merges the background refetch and re-caches it", async () => {
      queryClient.setQueryData(queryKeys.chat.snapshot("p1"), snapshot);
      mockFetch(async () =>
        jsonResponse({
          ...snapshot,
          messages: [
            ...snapshot.messages,
            {
              id: "a2",
              role: "assistant",
              content: "Refreshed from the server.",
              kind: "chat",
              turnId: "t2",
              createdAt: "2026-09-14T00:01:00.000Z",
            },
          ],
        })
      );

      const { result, unmount } = renderHook(() => useCiciroChat("p1"));
      // Painted instantly from the cache, before the background refetch below.
      expect(result.current.messages.map((message) => message.content)).toEqual([
        "Hi",
        "Hello again.",
      ]);

      await waitFor(() =>
        expect(result.current.messages.some((message) => message.content === "Refreshed from the server.")).toBe(
          true
        )
      );
      expect(queryClient.getQueryData(queryKeys.chat.snapshot("p1"))).toMatchObject({
        messages: [{ id: "u1" }, { id: "a1" }, { id: "a2" }],
      });
      unmount();
    });

    it("keeps the cached transcript long after the chat screen is gone", async () => {
      jest.useFakeTimers();
      try {
        mockFetch(async () => jsonResponse(snapshot));
        const { result, unmount } = renderHook(() => useCiciroChat("p1"));
        await waitFor(() => expect(result.current.loading).toBe(false));
        unmount();

        act(() => {
          jest.advanceTimersByTime(60 * 60_000);
        });

        expect(queryClient.getQueryData(queryKeys.chat.snapshot("p1"))).toMatchObject({
          messages: [{ id: "u1" }, { id: "a1" }],
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it("keeps a just-sent prompt on screen when the turn and its reload both fail", async () => {
      queryClient.setQueryData(queryKeys.chat.snapshot("p1"), snapshot);
      let gets = 0;
      mockFetch(async (_input, init) => {
        if ((init?.method ?? "GET") === "POST") throw new TypeError("Network request failed");
        gets += 1;
        if (gets === 1) return jsonResponse(snapshot);
        throw new TypeError("Network request failed");
      });

      const { result, unmount } = renderHook(() => useCiciroChat("p1"));
      await waitFor(() => expect(gets).toBe(1));

      await act(async () => {
        await result.current.send({ projectId: "p1", message: "Tighten the ending." });
      });

      expect(result.current.failure).not.toBeNull();
      expect(result.current.messages.map((message) => message.content)).toEqual([
        "Hi",
        "Hello again.",
        "Tighten the ending.",
      ]);
      unmount();
    });
  });

  it("sends the open chapter with the turn, and refetches who knows what when a chat tool changes it", async () => {
    const posts: Record<string, unknown>[] = [];
    mockFetch(async (_input, init) => {
      if ((init?.method ?? "GET") === "POST") {
        posts.push(parsedBody(init as RequestInit));
        return ndjsonResponse([
          '{"type":"turn","id":"t1","runId":"r1"}',
          '{"type":"tool","v":"recording who knows what"}',
          '{"type":"knowledge_changed","characterPath":"characters/joe.md"}',
          '{"type":"text","v":"Recorded: Joe suspects Suzy has the pen, from chapter 6."}',
          '{"type":"done","status":"completed","runId":"r1"}',
        ]);
      }
      return jsonResponse({ messages: [], runs: [] });
    });
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    const { result, unmount } = renderHook(() => useCiciroChat("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const input = chatRequestFromComposer("Joe suspects Suzy has the pen. Record that.", {
      projectId: "p1",
      chapterId: "c6",
    });
    await act(async () => {
      await result.current.send(input!);
    });

    expect(posts[0]).toMatchObject({ projectId: "p1", activeChapterId: "c6" });
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["knowledge", "p1"]));
    expect(keys).toContain(JSON.stringify(["bible", "p1", "characters/joe.md"]));
    invalidate.mockRestore();
    unmount();
  });
});
