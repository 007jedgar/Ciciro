import {
  addManuscriptsToFolder,
  createFolder,
  deleteFolder,
  getFolder,
  listFolders,
  removeManuscriptsFromFolder,
  updateFolder,
} from "../lib/folders";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("folder API helpers", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("lists, creates, fetches, updates, and deletes folders", async () => {
    const fetchMock = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";
      if (href.endsWith("/api/folders") && method === "GET") {
        return jsonResponse([{ id: "f1", name: "Cycle" }]);
      }
      if (href.endsWith("/api/folders") && method === "POST") {
        return jsonResponse({ id: "f2", name: "Drafts", notes: "WIP", projects: [] }, 201);
      }
      if (href.endsWith("/api/folders/f2") && method === "GET") {
        return jsonResponse({ id: "f2", name: "Drafts", notes: "WIP", projects: [] });
      }
      if (href.endsWith("/api/folders/f2") && method === "PATCH") {
        return jsonResponse({ id: "f2", name: "Archive" });
      }
      if (href.endsWith("/api/folders/f2") && method === "DELETE") {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "unhandled" }, 500);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(listFolders()).resolves.toEqual([{ id: "f1", name: "Cycle" }]);
    await expect(createFolder({ name: "  Drafts  ", notes: "  WIP  " })).resolves.toEqual({
      id: "f2",
      name: "Drafts",
      notes: "WIP",
      projects: [],
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      name: "Drafts",
      notes: "WIP",
    });

    await expect(getFolder("f2")).resolves.toEqual({
      id: "f2",
      name: "Drafts",
      notes: "WIP",
      projects: [],
    });
    await expect(updateFolder("f2", { name: "Archive" })).resolves.toMatchObject({
      name: "Archive",
    });
    await expect(deleteFolder("f2")).resolves.toEqual({ ok: true });
  });

  it("adds and removes manuscripts", async () => {
    const folder = { id: "f1", name: "Cycle", projects: [{ id: "p1" }] };
    const fetchMock = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") return jsonResponse({ ...folder, projects: [] });
      return jsonResponse(folder);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(addManuscriptsToFolder("f1", ["p1"])).resolves.toEqual(folder);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ projectIds: ["p1"] });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/folders\/f1\/projects$/);

    await expect(removeManuscriptsFromFolder("f1", ["p1"])).resolves.toMatchObject({
      projects: [],
    });
    expect(fetchMock.mock.calls[1][1]?.method).toBe("DELETE");
  });
});
