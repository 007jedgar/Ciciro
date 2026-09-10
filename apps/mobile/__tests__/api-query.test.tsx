import { type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  ApiError,
  queryClient,
  queryKeys,
  shouldRetryQuery,
  useCreateChapterMutation,
  useCreateProjectMutation,
  useProjectQuery,
  useProjectsQuery,
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
    expect(queryKeys.questions("p1")).toEqual(["questions", "p1", "all"]);
    expect(queryKeys.questions("p1", "open")).toEqual(["questions", "p1", "open"]);
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
