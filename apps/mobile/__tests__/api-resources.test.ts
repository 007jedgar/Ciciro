import { ciciro } from "../lib/api";
import { jsonResponse, lastFetchCall, mockFetch, ndjsonResponse, bufferedNdjsonResponse, parsedBody } from "./http";

type ResourceCase = {
  name: string;
  run: () => Promise<unknown>;
  path: RegExp;
  method?: string;
  body?: unknown;
};

const RESOURCES: ResourceCase[] = [
  {
    name: "search.find",
    run: () => ciciro.search.find("p1", "jon", { matchCase: true, wholeWord: false }),
    path: /\/api\/projects\/p1\/search\?q=jon&matchCase=1$/,
  },
  {
    name: "search.replace",
    run: () => ciciro.search.replace("p1", { query: "a", replacement: "b", matchCase: false, wholeWord: true }),
    method: "POST",
    path: /\/api\/projects\/p1\/replace$/,
    body: { query: "a", replacement: "b", matchCase: false, wholeWord: true },
  },
  { name: "health.get", run: () => ciciro.health.get(), path: /\/api\/health$/ },
  { name: "auth.me", run: () => ciciro.auth.me(), path: /\/api\/auth\/me$/ },
  {
    name: "auth.login",
    run: () => ciciro.auth.login({ email: "ada@example.com", password: "secret-pw" }),
    method: "POST",
    path: /\/api\/auth\/login$/,
    body: { email: "ada@example.com", password: "secret-pw" },
  },
  {
    name: "auth.signup",
    run: () => ciciro.auth.signup({ email: "ada@example.com", password: "secret-pw", name: "Ada" }),
    method: "POST",
    path: /\/api\/auth\/signup$/,
    body: { email: "ada@example.com", password: "secret-pw", name: "Ada" },
  },
  { name: "auth.logout", run: () => ciciro.auth.logout(), method: "POST", path: /\/api\/auth\/logout$/ },
  { name: "settings.get", run: () => ciciro.settings.get(), path: /\/api\/settings$/ },
  {
    name: "settings.patch",
    run: () => ciciro.settings.patch({ theme: "ember" }),
    method: "PATCH",
    path: /\/api\/settings$/,
    body: { theme: "ember" },
  },
  {
    name: "settings.put",
    run: () =>
      ciciro.settings.put({
        theme: "parchment",
        editorFont: "serif",
        editorFontSize: 19,
        autoCorrect: true,
        reduceMotion: true,
        chatWidth: 380,
        dailyWordGoal: 250,
        weeklyDayTarget: 4,
        showDailyGoal: true,
        formatChrome: "smart",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    method: "PUT",
    path: /\/api\/settings$/,
    body: {
      theme: "parchment",
      editorFont: "serif",
      editorFontSize: 19,
      autoCorrect: true,
      reduceMotion: true,
      chatWidth: 380,
      dailyWordGoal: 250,
      weeklyDayTarget: 4,
      showDailyGoal: true,
      formatChrome: "smart",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  },
  {
    name: "writing.day.get",
    run: () => ciciro.writing.day.get("2026-09-12"),
    path: /\/api\/writing\/day\?date=2026-09-12$/,
  },
  {
    name: "writing.days.get",
    run: () => ciciro.writing.days.get("2026-09-01", "2026-09-14"),
    path: /\/api\/writing\/days\?from=2026-09-01&to=2026-09-14$/,
  },
  {
    name: "writing.sessions.list",
    run: () => ciciro.writing.sessions.list(20),
    path: /\/api\/writing\/sessions\?limit=20$/,
  },
  {
    name: "writing.sessions.post",
    run: () =>
      ciciro.writing.sessions.post({
        projectId: null,
        startedAt: 1_000,
        endedAt: 2_000,
        words: 12,
        activeMs: 500,
      }),
    method: "POST",
    path: /\/api\/writing\/sessions$/,
    body: {
      projectId: null,
      startedAt: 1_000,
      endedAt: 2_000,
      words: 12,
      activeMs: 500,
    },
  },
  {
    name: "writing.day.put",
    run: () => ciciro.writing.day.put({ date: "2026-09-12", words: 12, activeMs: 4000 }),
    method: "PUT",
    path: /\/api\/writing\/day$/,
    body: { date: "2026-09-12", words: 12, activeMs: 4000 },
  },
  { name: "projects.list", run: () => ciciro.projects.list(), path: /\/api\/projects$/ },
  {
    name: "projects.create",
    run: () => ciciro.projects.create({ title: "Night Watch", author: "Ada", folderId: "f1" }),
    method: "POST",
    path: /\/api\/projects$/,
    body: { title: "Night Watch", author: "Ada", folderId: "f1" },
  },
  { name: "projects.get", run: () => ciciro.projects.get("p1"), path: /\/api\/projects\/p1$/ },
  {
    name: "projects.patch",
    run: () => ciciro.projects.patch("p1", { logline: "A hook." }),
    method: "PATCH",
    path: /\/api\/projects\/p1$/,
    body: { logline: "A hook." },
  },
  { name: "projects.delete", run: () => ciciro.projects.delete("p1"), method: "DELETE", path: /\/api\/projects\/p1$/ },
  { name: "folders.list", run: () => ciciro.folders.list(), path: /\/api\/folders$/ },
  {
    name: "folders.create",
    run: () => ciciro.folders.create({ name: "Cycle", projectIds: ["p1"] }),
    method: "POST",
    path: /\/api\/folders$/,
    body: { name: "Cycle", projectIds: ["p1"] },
  },
  { name: "folders.get", run: () => ciciro.folders.get("f1"), path: /\/api\/folders\/f1$/ },
  {
    name: "folders.patch",
    run: () => ciciro.folders.patch("f1", { name: "Archive" }),
    method: "PATCH",
    path: /\/api\/folders\/f1$/,
    body: { name: "Archive" },
  },
  { name: "folders.delete", run: () => ciciro.folders.delete("f1"), method: "DELETE", path: /\/api\/folders\/f1$/ },
  {
    name: "folders.addProjects",
    run: () => ciciro.folders.addProjects("f1", { projectIds: ["p1", "p2"] }),
    method: "POST",
    path: /\/api\/folders\/f1\/projects$/,
    body: { projectIds: ["p1", "p2"] },
  },
  {
    name: "folders.removeProjects",
    run: () => ciciro.folders.removeProjects("f1", { projectIds: ["p1"] }),
    method: "DELETE",
    path: /\/api\/folders\/f1\/projects$/,
    body: { projectIds: ["p1"] },
  },
  { name: "chapters.list", run: () => ciciro.chapters.list("p1"), path: /\/api\/chapters\?projectId=p1$/ },
  {
    name: "chapters.create",
    run: () => ciciro.chapters.create({ projectId: "p1", title: "Chapter 2" }),
    method: "POST",
    path: /\/api\/chapters$/,
    body: { projectId: "p1", title: "Chapter 2" },
  },
  {
    name: "chapters.patch",
    run: () => ciciro.chapters.patch("c1", { expectedRevision: 1, title: "Chapter 1" }),
    method: "PATCH",
    path: /\/api\/chapters\/c1$/,
    body: { expectedRevision: 1, title: "Chapter 1" },
  },
  {
    name: "chapters.reorder",
    run: () => ciciro.chapters.reorder({ projectId: "p1", chapterIds: ["c2", "c1"] }),
    method: "POST",
    path: /\/api\/chapters\/reorder$/,
    body: { projectId: "p1", chapterIds: ["c2", "c1"] },
  },
  { name: "chapters.delete", run: () => ciciro.chapters.delete("c1"), method: "DELETE", path: /\/api\/chapters\/c1$/ },
  {
    name: "chapters.archive",
    run: () => ciciro.chapters.archive("c1"),
    method: "POST",
    path: /\/api\/chapters\/c1\/archive$/,
  },
  {
    name: "chapters.unarchive",
    run: () => ciciro.chapters.unarchive("c1"),
    method: "DELETE",
    path: /\/api\/chapters\/c1\/archive$/,
  },
  {
    name: "chapters.listArchived",
    run: () => ciciro.chapters.listArchived("p1"),
    path: /\/api\/chapters\?projectId=p1&archived=true$/,
  },
  { name: "chapters.edits", run: () => ciciro.chapters.edits("c1"), path: /\/api\/chapters\/c1\/edits$/ },
  {
    name: "chapters.snapshots.list",
    run: () => ciciro.chapters.snapshots.list("c1"),
    path: /\/api\/chapters\/c1\/snapshots$/,
  },
  {
    name: "chapters.snapshots.get",
    run: () => ciciro.chapters.snapshots.get("c1", "s1"),
    path: /\/api\/chapters\/c1\/snapshots\/s1$/,
  },
  {
    name: "chapters.snapshots.create",
    run: () => ciciro.chapters.snapshots.create("c1", { label: "Draft one" }),
    method: "POST",
    path: /\/api\/chapters\/c1\/snapshots$/,
    body: { label: "Draft one" },
  },
  {
    name: "chapters.snapshots.delete",
    run: () => ciciro.chapters.snapshots.delete("c1", "s1"),
    method: "DELETE",
    path: /\/api\/chapters\/c1\/snapshots\/s1$/,
  },
  {
    name: "chapters.snapshots.restore",
    run: () => ciciro.chapters.snapshots.restore("c1", "s1"),
    method: "POST",
    path: /\/api\/chapters\/c1\/snapshots\/s1\/restore$/,
  },
  {
    name: "chapters.ops.list",
    run: () => ciciro.chapters.ops.list("c1", 3),
    path: /\/api\/chapters\/c1\/ops\?after=3$/,
  },
  {
    name: "chapters.ops.push",
    run: () =>
      ciciro.chapters.ops.push("c1", {
        ops: [
          {
            opId: "op-1",
            baseRevision: 1,
            actor: "user",
            type: "delete_block",
            blockId: "b1",
          },
        ],
      }),
    method: "POST",
    path: /\/api\/chapters\/c1\/ops$/,
    body: {
      ops: [
        {
          opId: "op-1",
          baseRevision: 1,
          actor: "user",
          type: "delete_block",
          blockId: "b1",
        },
      ],
    },
  },
  {
    name: "projects.position.get",
    run: () => ciciro.projects.position.get("p1"),
    path: /\/api\/projects\/p1\/position$/,
  },
  {
    name: "projects.position.put",
    run: () => ciciro.projects.position.put("p1", { chapterId: "c1", blockId: "b1", offset: 4 }),
    method: "PUT",
    path: /\/api\/projects\/p1\/position$/,
    body: { chapterId: "c1", blockId: "b1", offset: 4 },
  },
  {
    name: "sync.pull",
    run: () => ciciro.sync.pull("p1", { chapters: { c1: 2 }, bible: { "canon.md": 1 } }),
    path: /\/api\/sync\?projectId=p1&after=/,
  },
  {
    name: "sync.push",
    run: () =>
      ciciro.sync.push({
        projectId: "p1",
        after: { chapters: { c1: 0 } },
        ops: [
          {
            opId: "op-1",
            chapterId: "c1",
            baseRevision: 0,
            actor: "user",
            type: "delete_block",
            blockId: "b1",
          },
        ],
        position: { chapterId: "c1", blockId: "b1", offset: 0 },
      }),
    method: "POST",
    path: /\/api\/sync$/,
    body: {
      projectId: "p1",
      after: { chapters: { c1: 0 } },
      ops: [
        {
          opId: "op-1",
          chapterId: "c1",
          baseRevision: 0,
          actor: "user",
          type: "delete_block",
          blockId: "b1",
        },
      ],
      position: { chapterId: "c1", blockId: "b1", offset: 0 },
    },
  },
  { name: "characters.list", run: () => ciciro.characters.list("p1"), path: /\/api\/characters\?projectId=p1$/ },
  {
    name: "characters.create",
    run: () => ciciro.characters.create({ projectId: "p1", name: "Ada" }),
    method: "POST",
    path: /\/api\/characters$/,
    body: { projectId: "p1", name: "Ada" },
  },
  {
    name: "characters.patch",
    run: () => ciciro.characters.patch("ch1", { role: "protagonist" }),
    method: "PATCH",
    path: /\/api\/characters\/ch1$/,
    body: { role: "protagonist" },
  },
  {
    name: "characters.delete",
    run: () => ciciro.characters.delete("ch1"),
    method: "DELETE",
    path: /\/api\/characters\/ch1$/,
  },
  { name: "plotPoints.list", run: () => ciciro.plotPoints.list("p1"), path: /\/api\/plotpoints\?projectId=p1$/ },
  {
    name: "plotPoints.create",
    run: () => ciciro.plotPoints.create({ projectId: "p1", title: "The turn" }),
    method: "POST",
    path: /\/api\/plotpoints$/,
    body: { projectId: "p1", title: "The turn" },
  },
  {
    name: "plotPoints.patch",
    run: () => ciciro.plotPoints.patch("pp1", { status: "resolved", chapterId: null }),
    method: "PATCH",
    path: /\/api\/plotpoints\/pp1$/,
    body: { status: "resolved", chapterId: null },
  },
  {
    name: "plotPoints.delete",
    run: () => ciciro.plotPoints.delete("pp1"),
    method: "DELETE",
    path: /\/api\/plotpoints\/pp1$/,
  },
  {
    name: "questions.list",
    run: () => ciciro.questions.list("p1", "open"),
    path: /\/api\/questions\?projectId=p1&status=open$/,
  },
  {
    name: "questions.create",
    run: () => ciciro.questions.create({ projectId: "p1", question: "Who is the killer?" }),
    method: "POST",
    path: /\/api\/questions$/,
    body: { projectId: "p1", question: "Who is the killer?" },
  },
  {
    name: "questions.patch",
    run: () => ciciro.questions.patch("q1", { status: "resolved" }),
    method: "PATCH",
    path: /\/api\/questions\/q1$/,
    body: { status: "resolved" },
  },
  { name: "questions.delete", run: () => ciciro.questions.delete("q1"), method: "DELETE", path: /\/api\/questions\/q1$/ },
  { name: "bible.list", run: () => ciciro.bible.list("p1"), path: /\/api\/bible\?projectId=p1$/ },
  {
    name: "bible.read",
    run: () => ciciro.bible.read("p1", "characters/ada.md"),
    path: /\/api\/bible\?projectId=p1&path=characters%2Fada\.md$/,
  },
  {
    name: "bible.write",
    run: () => ciciro.bible.write({ projectId: "p1", path: "canon.md", content: "# Canon" }),
    method: "POST",
    path: /\/api\/bible$/,
    body: { projectId: "p1", path: "canon.md", content: "# Canon" },
  },
  {
    name: "bible.createCharacter",
    run: () => ciciro.bible.createCharacter({ projectId: "p1", newCharacter: "Ada" }),
    method: "POST",
    path: /\/api\/bible$/,
    body: { projectId: "p1", newCharacter: "Ada" },
  },
  {
    name: "bible.createPlot",
    run: () => ciciro.bible.createPlot({ projectId: "p1", newPlot: "The heist" }),
    method: "POST",
    path: /\/api\/bible$/,
    body: { projectId: "p1", newPlot: "The heist" },
  },
  { name: "chat.get", run: () => ciciro.chat.get("p1"), path: /\/api\/chat\?projectId=p1$/ },
  {
    name: "chat.clear",
    run: () => ciciro.chat.clear("p1"),
    method: "DELETE",
    path: /\/api\/chat\?projectId=p1$/,
  },
  {
    name: "chat.compact",
    run: () => ciciro.chat.compact("p1"),
    method: "POST",
    path: /\/api\/chat$/,
    body: { projectId: "p1", compactOnly: true },
  },
  {
    name: "chat.insertions.list",
    run: () => ciciro.chat.insertions.list("p1"),
    path: /\/api\/chat\/insertions\?projectId=p1$/,
  },
  {
    name: "chat.insertions.record",
    run: () =>
      ciciro.chat.insertions.record({
        projectId: "p1",
        turnId: "t1",
        segmentIndex: 0,
        chapterId: "c1",
      }),
    method: "POST",
    path: /\/api\/chat\/insertions$/,
    body: { projectId: "p1", turnId: "t1", segmentIndex: 0, chapterId: "c1" },
  },
  {
    name: "correct.post",
    run: () =>
      ciciro.correct.post({ chapterId: "c1", blockId: "b1", text: "Their going.", revision: 3 }),
    method: "POST",
    path: /\/api\/correct$/,
    body: { chapterId: "c1", blockId: "b1", text: "Their going.", revision: 3 },
  },
];

describe("ciciro resource catalog", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it.each(RESOURCES)("$name hits $path", async ({ run, path, method, body }) => {
    mockFetch(async () => jsonResponse({ ok: true }));
    await run();
    const call = lastFetchCall();
    expect(call.url).toMatch(path);
    if (method) expect(call.init.method).toBe(method);
    if (body !== undefined) expect(parsedBody(call.init)).toEqual(body);
  });

  it("encodes ids in path segments", async () => {
    mockFetch(async () => jsonResponse({}));
    await ciciro.projects.get("p/1");
    expect(lastFetchCall().url).toMatch(/\/api\/projects\/p%2F1$/);
  });

  it("omits empty optional query params", async () => {
    mockFetch(async () => jsonResponse([]));
    await ciciro.questions.list("p1");
    expect(lastFetchCall().url).toMatch(/\/api\/questions\?projectId=p1$/);
    expect(lastFetchCall().url).not.toContain("status=");
  });

  it("streams chat NDJSON and skips pings", async () => {
    mockFetch(async () =>
      ndjsonResponse([
        '{"type":"ping"}',
        '{"type":"turn","id":"t1","runId":"r1"}',
        '{"type":"text","v":"Hello"}',
        '{"type":"done","status":"completed","runId":"r1"}',
      ])
    );
    const events: unknown[] = [];
    await ciciro.chat.start({ projectId: "p1", message: "Hi" }, (event) => events.push(event));
    expect(parsedBody(lastFetchCall().init)).toEqual({ projectId: "p1", message: "Hi" });
    expect(lastFetchCall().url).toMatch(/\/api\/chat$/);
    expect(events).toEqual([
      { type: "turn", id: "t1", runId: "r1" },
      { type: "text", v: "Hello" },
      { type: "done", status: "completed", runId: "r1" },
    ]);
  });

  it("parses chat NDJSON when fetch buffers the body and leaves Response.body null", async () => {
    mockFetch(async () =>
      bufferedNdjsonResponse(
        '{"type":"turn","id":"t1"}\n{"type":"text","v":"Hello"}\n{"type":"done","status":"completed"}'
      )
    );
    const events: unknown[] = [];
    await ciciro.chat.start({ projectId: "p1", message: "Hi" }, (event) => events.push(event));
    expect(events).toEqual([
      { type: "turn", id: "t1" },
      { type: "text", v: "Hello" },
      { type: "done", status: "completed" },
    ]);
  });

  it("normalizes a chat snapshot that is a bare message array", async () => {
    mockFetch(async () => jsonResponse([{ id: "m1", role: "assistant", content: "Hi" }]));
    await expect(ciciro.chat.get("p1")).resolves.toEqual({
      messages: [{ id: "m1", role: "assistant", content: "Hi" }],
      runs: [],
    });
  });

  it("streams autowrite NDJSON", async () => {
    mockFetch(async () =>
      ndjsonResponse(['{"type":"phase","v":"planning"}', '{"type":"done","beats":1,"words":12}'])
    );
    const events: unknown[] = [];
    await ciciro.autowrite.start(
      { projectId: "p1", chapterId: "c1", targetWords: 600 },
      (event) => events.push(event)
    );
    expect(lastFetchCall().url).toMatch(/\/api\/autowrite$/);
    expect(parsedBody(lastFetchCall().init)).toEqual({
      projectId: "p1",
      chapterId: "c1",
      targetWords: 600,
    });
    expect(events).toEqual([
      { type: "phase", v: "planning" },
      { type: "done", beats: 1, words: 12 },
    ]);
  });

  it("downloads a manuscript export", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    mockFetch(async () =>
      new Response(bytes, {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": 'attachment; filename="book.docx"',
        },
      })
    );
    const file = await ciciro.export.download("p1");
    expect(lastFetchCall().url).toMatch(/\/api\/export\/p1$/);
    expect(file.filename).toBe("book.docx");
    expect(new Uint8Array(file.bytes)).toEqual(bytes);
  });

  it("requests the chosen export format", async () => {
    mockFetch(async () =>
      new Response(new Uint8Array([1]), {
        headers: {
          "content-type": "application/epub+zip",
          "content-disposition": 'attachment; filename="book.epub"',
        },
      })
    );
    const file = await ciciro.export.download("p 1", "epub");
    expect(lastFetchCall().url).toMatch(/\/api\/export\/p%201\?format=epub$/);
    expect(file.filename).toBe("book.epub");
  });
});
