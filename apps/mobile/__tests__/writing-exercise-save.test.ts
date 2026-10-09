import { keepExerciseAsManuscript } from "../lib/writing-exercise-save";

const labels = { observe: "Noticed", react: "Felt", narrate: "Story" };
const texts = { observe: "Rain.", react: "Calm.", narrate: "Once." };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("keepExerciseAsManuscript", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const project = { id: "p1", isFirstProject: false, chapters: [{ id: "c1", revision: 2 }] };

  it("creates a journal manuscript and writes the exercise into its entry", async () => {
    const fetchMock = jest.fn(async (url: string) =>
      url.endsWith("/api/projects") ? jsonResponse(project, 201) : jsonResponse({ id: "c1" })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const onCreated = jest.fn();

    const result = await keepExerciseAsManuscript({ texts, labels, title: "Exercise", author: "Ana", onCreated });

    expect(result.id).toBe("p1");
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
    const create = JSON.parse(((fetchMock.mock.calls[0] as unknown[][])[1] as { body: string }).body);
    expect(create).toMatchObject({ title: "Exercise", author: "Ana", kind: "journal" });
    const patchCall = fetchMock.mock.calls[1] as unknown[];
    expect(String(patchCall[0])).toMatch(/\/api\/chapters\/c1$/);
    const patch = JSON.parse((patchCall[1] as { body: string }).body);
    expect(patch).toEqual({
      expectedRevision: 2,
      content: "<h2>Noticed</h2><p>Rain.</p><h2>Felt</h2><p>Calm.</p><h2>Story</h2><p>Once.</p>",
    });
  });

  it("retries only the chapter write when the manuscript already exists", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ id: "c1" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const onCreated = jest.fn();

    await keepExerciseAsManuscript({
      texts,
      labels,
      title: "Exercise",
      author: "Ana",
      existing: project as never,
      onCreated,
    });

    expect(onCreated).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a failed chapter write after the manuscript exists, for the caller to retry", async () => {
    globalThis.fetch = jest.fn(async (url: string) =>
      url.endsWith("/api/projects") ? jsonResponse(project, 201) : jsonResponse({ error: "no" }, 500)
    ) as unknown as typeof fetch;
    const onCreated = jest.fn();

    await expect(
      keepExerciseAsManuscript({ texts, labels, title: "Exercise", author: "Ana", onCreated })
    ).rejects.toBeDefined();
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});
