import { ApiError } from "../lib/api";
import {
  addChapter,
  archiveChapter,
  createManuscript,
  deleteChapter,
  listArchivedChapters,
  listManuscripts,
  unarchiveChapter,
} from "../lib/manuscripts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("manuscript API helpers", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("lists manuscripts", async () => {
    globalThis.fetch = jest.fn(async () =>
      jsonResponse([{ id: "p1", title: "One" }])
    ) as unknown as typeof fetch;

    await expect(listManuscripts()).resolves.toEqual([{ id: "p1", title: "One" }]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/projects$/),
      expect.objectContaining({ credentials: "include" })
    );
  });

  it("creates a manuscript with trimmed fields", async () => {
    const created = { id: "p2", title: "The Book", chapters: [{ id: "c1", title: "Chapter 1" }] };
    const fetchMock = jest.fn(async () => jsonResponse(created, 201));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      createManuscript({ title: "  The Book  ", author: "  Ada  ", genre: " Mystery " })
    ).resolves.toEqual(created);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      title: "The Book",
      author: "Ada",
      genre: "Mystery",
      logline: "",
    });

    await createManuscript({ title: "Filed", author: "Ada", folderId: "f1" });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      title: "Filed",
      author: "Ada",
      genre: "",
      logline: "",
      folderId: "f1",
    });
  });

  it("adds a chapter to a manuscript", async () => {
    const chapter = { id: "c2", title: "Chapter 2", order: 1 };
    const fetchMock = jest.fn(async () => jsonResponse(chapter, 201));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(addChapter("p1")).resolves.toEqual(chapter);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ projectId: "p1" });

    await addChapter("p1", "  Epilogue  ");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      projectId: "p1",
      title: "Epilogue",
    });
  });

  it("deletes, archives, unarchives, and lists archived chapters", async () => {
    const archived = {
      id: "c1",
      title: "Chapter 1",
      archivedAt: "2026-09-11T00:00:00.000Z",
    };
    const fetchMock = jest.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/archive") && !url.includes("archived=")) {
        return jsonResponse(archived);
      }
      if (url.includes("archived=true")) {
        return jsonResponse([archived]);
      }
      return jsonResponse({ ok: true });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(deleteChapter("c1", "p1")).resolves.toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/chapters\/c1$/);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "DELETE" }));

    await expect(archiveChapter("c1", "p1")).resolves.toEqual(archived);
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/api\/chapters\/c1\/archive$/);
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: "POST" }));

    await expect(unarchiveChapter("c1", "p1")).resolves.toEqual(archived);
    expect(String(fetchMock.mock.calls[2][0])).toMatch(/\/api\/chapters\/c1\/archive$/);
    expect(fetchMock.mock.calls[2][1]).toEqual(expect.objectContaining({ method: "DELETE" }));

    await expect(listArchivedChapters("p1")).resolves.toEqual([archived]);
    expect(String(fetchMock.mock.calls[3][0])).toMatch(/\/api\/chapters\?projectId=p1&archived=true$/);
  });

  it("propagates ApiError from create", async () => {
    globalThis.fetch = jest.fn(async () =>
      jsonResponse({ error: "Authentication required." }, 401)
    ) as unknown as typeof fetch;

    await expect(createManuscript({ title: "X", author: "Y" })).rejects.toMatchObject({
      status: 401,
    });
    await expect(createManuscript({ title: "X", author: "Y" })).rejects.toBeInstanceOf(ApiError);
  });
});
