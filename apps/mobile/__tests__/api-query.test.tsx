import { type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  ApiError,
  queryClient,
  queryKeys,
  shouldRetryQuery,
  useAddProjectsToFolderMutation,
  useArchiveChapterMutation,
  useCreateChapterMutation,
  useCreateProjectMutation,
  useDeleteChapterMutation,
  useProjectQuery,
  useProjectsQuery,
  useReorderChaptersMutation,
  useUnarchiveChapterMutation,
} from "../lib/api";
import { jsonResponse, mockFetch } from "./http";

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("query keys", () => {
  it("nests list/detail keys so invalidation can fan out", () => {
    expect(queryKeys.projects.list()).toEqual(["projects", "list"]);
    expect(queryKeys.projects.detail("p1")).toEqual(["projects", "detail", "p1"]);
    expect(queryKeys.folders.detail("f1")[0]).toBe("folders");
    expect(queryKeys.questions.list("p1")).toEqual(["questions", "p1", "all"]);
    expect(queryKeys.questions.list("p1", "open")).toEqual(["questions", "p1", "open"]);
    // The prefix covers both views, so answering a question refreshes each one.
    expect(queryKeys.questions.all("p1")).toEqual(["questions", "p1"]);
    expect(queryKeys.chapters.archived("p1")).toEqual(["chapters", "p1", "archived"]);
    expect(queryKeys.bible.file("p1", "canon.md")).toEqual(["bible", "p1", "canon.md"]);
  });
});

describe("shouldRetryQuery", () => {
  it("does not retry 4xx and stops after two retries on other errors", () => {
    expect(shouldRetryQuery(0, new ApiError("no", 401))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError("no", 404))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError("conflict", 409))).toBe(false);
    expect(shouldRetryQuery(0, new ApiError("oops", 500))).toBe(true);
    expect(shouldRetryQuery(1, new Error("offline"))).toBe(true);
    expect(shouldRetryQuery(2, new Error("offline"))).toBe(false);
  });
});

describe("query hooks", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    queryClient.clear();
    queryClient.setDefaultOptions({
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    queryClient.clear();
    queryClient.setDefaultOptions({
      queries: { retry: shouldRetryQuery, staleTime: 30_000 },
      mutations: { retry: false },
    });
  });

  it("loads the manuscripts list", async () => {
    const projects = [{ id: "p1", title: "One" }];
    mockFetch(async () => jsonResponse(projects));
    const { result, unmount } = renderHook(() => useProjectsQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(projects);
    unmount();
  });

  it("does not fetch when disabled or when a project id is missing", async () => {
    const fetchMock = mockFetch(async () => jsonResponse([]));
    const disabled = renderHook(() => useProjectsQuery({ enabled: false }), { wrapper });
    const missing = renderHook(() => useProjectQuery(""), { wrapper });
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
    disabled.unmount();
    missing.unmount();
  });

  it("appends a created chapter onto the project cache", async () => {
    mockFetch(async () => jsonResponse({ id: "c2", title: "Chapter 2", projectId: "p1" }));
    queryClient.setQueryData(queryKeys.projects.detail("p1"), {
      id: "p1",
      title: "Book",
      chapters: [{ id: "c1", title: "Chapter 1" }],
    });

    const { result, unmount } = renderHook(() => useCreateChapterMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ projectId: "p1", title: "Chapter 2" });
    });

    expect(queryClient.getQueryData(queryKeys.projects.detail("p1"))).toMatchObject({
      chapters: [{ id: "c1", title: "Chapter 1" }, { id: "c2", title: "Chapter 2", projectId: "p1" }],
    });
    unmount();
  });

  it("hides an archived chapter from the project cache", async () => {
    mockFetch(async () =>
      jsonResponse({ id: "c2", projectId: "p1", title: "Hidden", order: 1, archivedAt: "2026-09-11T00:00:00.000Z" })
    );
    queryClient.setQueryData(queryKeys.projects.detail("p1"), {
      id: "p1",
      title: "Book",
      chapters: [
        { id: "c1", title: "Chapter 1" },
        { id: "c2", title: "Hidden" },
      ],
    });

    const { result, unmount } = renderHook(() => useArchiveChapterMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "c2", projectId: "p1" });
    });

    expect(queryClient.getQueryData(queryKeys.projects.detail("p1"))).toMatchObject({
      chapters: [{ id: "c1", title: "Chapter 1" }],
    });
    unmount();
  });

  it("restores an unarchived chapter into the project cache", async () => {
    mockFetch(async () =>
      jsonResponse({ id: "c2", projectId: "p1", title: "Hidden", order: 1, archivedAt: null })
    );
    queryClient.setQueryData(queryKeys.projects.detail("p1"), {
      id: "p1",
      title: "Book",
      chapters: [{ id: "c1", title: "Chapter 1", order: 0 }],
    });

    const { result, unmount } = renderHook(() => useUnarchiveChapterMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "c2", projectId: "p1" });
    });

    expect(queryClient.getQueryData(queryKeys.projects.detail("p1"))).toMatchObject({
      chapters: [
        { id: "c1", title: "Chapter 1", order: 0 },
        { id: "c2", title: "Hidden", order: 1, archivedAt: null },
      ],
    });
    unmount();
  });

  it("removes a deleted chapter from the project cache", async () => {
    mockFetch(async () => jsonResponse({ ok: true }));
    queryClient.setQueryData(queryKeys.projects.detail("p1"), {
      id: "p1",
      title: "Book",
      chapters: [
        { id: "c1", title: "Chapter 1" },
        { id: "c2", title: "Spare" },
      ],
    });

    const { result, unmount } = renderHook(() => useDeleteChapterMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "c2", projectId: "p1" });
    });

    expect(queryClient.getQueryData(queryKeys.projects.detail("p1"))).toMatchObject({
      chapters: [{ id: "c1", title: "Chapter 1" }],
    });
    unmount();
  });

  it("moves a manuscript into a folder before the server responds", async () => {
    const folder = { id: "f1", name: "Cycle", notes: "", projects: [], _count: { projects: 0 } };
    mockFetch(async () =>
      jsonResponse({
        ...folder,
        projects: [{ id: "p1", title: "One", folderId: "f1" }],
        _count: { projects: 1 },
      })
    );
    queryClient.setQueryData(queryKeys.folders.list(), [folder]);
    queryClient.setQueryData(queryKeys.folders.detail("f1"), folder);
    queryClient.setQueryData(queryKeys.projects.list(), [{ id: "p1", title: "One", folderId: null }]);

    const { result, unmount } = renderHook(() => useAddProjectsToFolderMutation(), { wrapper });

    // The optimistic update lands synchronously inside onMutate.
    let mutation: Promise<unknown> | null = null;
    act(() => {
      mutation = result.current.mutateAsync({ id: "f1", projectIds: ["p1"] });
    });
    await waitFor(() => {
      const detail = queryClient.getQueryData(queryKeys.folders.detail("f1")) as { projects: unknown[] };
      expect(detail.projects).toHaveLength(1);
    });
    expect(queryClient.getQueryData(queryKeys.projects.list())).toEqual([
      { id: "p1", title: "One", folderId: "f1" },
    ]);
    await act(async () => {
      await mutation;
    });
    unmount();
  });

  it("rolls the folder caches back when a move fails", async () => {
    mockFetch(async () => jsonResponse({ error: "nope" }, { status: 500 }));
    queryClient.setQueryData(queryKeys.folders.detail("f1"), {
      id: "f1",
      name: "Cycle",
      notes: "",
      projects: [],
      _count: { projects: 0 },
    });
    queryClient.setQueryData(queryKeys.projects.list(), [{ id: "p1", title: "One", folderId: null }]);

    const { result, unmount } = renderHook(() => useAddProjectsToFolderMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: "f1", projectIds: ["p1"] }).catch(() => {});
    });

    expect(queryClient.getQueryData(queryKeys.projects.list())).toEqual([
      { id: "p1", title: "One", folderId: null },
    ]);
    expect(queryClient.getQueryData(queryKeys.folders.detail("f1"))).toMatchObject({ projects: [] });
    unmount();
  });

  it("sends overlapping chapter reorders one at a time and keeps the latest order", async () => {
    const pending: Array<{ ids: string[]; resolve: (res: Response) => void }> = [];
    const fetchMock = mockFetch((_url, init) => {
      const url = String(_url);
      if (!url.includes("/api/chapters/reorder")) {
        return Promise.resolve(jsonResponse({ id: "p1", title: "Book", chapters: [] }));
      }
      const { chapterIds } = JSON.parse(String(init?.body)) as { chapterIds: string[] };
      return new Promise<Response>((resolve) => pending.push({ ids: chapterIds, resolve }));
    });
    const chapter = (id: string, order: number) => ({ id, title: id, order });
    queryClient.setQueryData(queryKeys.projects.detail("p1"), {
      id: "p1",
      title: "Book",
      chapters: [chapter("a", 0), chapter("b", 1), chapter("c", 2)],
    });
    const order = () =>
      (queryClient.getQueryData(queryKeys.projects.detail("p1")) as { chapters: { id: string }[] })
        .chapters.map((c) => c.id);

    const { result, unmount } = renderHook(() => useReorderChaptersMutation(), { wrapper });
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    await act(async () => {
      first = result.current.mutateAsync({ projectId: "p1", chapterIds: ["a", "c", "b"] });
      second = result.current.mutateAsync({ projectId: "p1", chapterIds: ["c", "a", "b"] });
    });
    expect(order()).toEqual(["c", "a", "b"]);
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].ids).toEqual(["a", "c", "b"]);

    await act(async () => {
      pending[0].resolve(jsonResponse({ error: "nope" }, { status: 500 }));
      await first.catch(() => undefined);
    });
    expect(order()).toEqual(["c", "a", "b"]);
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1].ids).toEqual(["c", "a", "b"]);
    const refetchesBefore = fetchMock.mock.calls.filter(([u]) => !String(u).includes("reorder")).length;
    expect(refetchesBefore).toBe(0);

    await act(async () => {
      pending[1].resolve(jsonResponse([chapter("c", 0), chapter("a", 1), chapter("b", 2)]));
      await second;
    });
    expect(order()).toEqual(["c", "a", "b"]);
    unmount();
  });

  it("invalidates the project list after creating a manuscript", async () => {
    mockFetch(async () => jsonResponse({ id: "p2", title: "Night Watch", chapters: [] }));
    queryClient.setQueryData(queryKeys.projects.list(), [{ id: "p1", title: "Old" }]);
    const { result, unmount } = renderHook(() => useCreateProjectMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ title: "Night Watch", author: "Ada" });
    });
    expect(queryClient.getQueryState(queryKeys.projects.list())?.isInvalidated).toBe(true);
    unmount();
  });
});
