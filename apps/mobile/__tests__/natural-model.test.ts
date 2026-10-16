import {
  canResume,
  ModelInstaller,
  packDownloadBytes,
  packInstallBytes,
  planChunks,
  reduceModelState,
  SPACE_MARGIN_BYTES,
  type InstallerDeps,
  type ModelPack,
  type ModelState,
} from "../lib/natural-model";

const MB = 1024 * 1024;

describe("reduceModelState", () => {
  const downloading: ModelState = { status: "downloading", bytes: 10, total: 100 };

  it("runs absent to downloading to installing to ready", () => {
    let s: ModelState = { status: "absent" };
    s = reduceModelState(s, { type: "start", bytes: 0, total: 100 });
    expect(s).toEqual({ status: "downloading", bytes: 0, total: 100 });
    s = reduceModelState(s, { type: "progress", bytes: 60 });
    expect(s).toEqual({ status: "downloading", bytes: 60, total: 100 });
    s = reduceModelState(s, { type: "installing", progress: 0.4 });
    expect(s).toEqual({ status: "installing", progress: 0.4 });
    s = reduceModelState(s, { type: "installed", bytes: 180 });
    expect(s).toEqual({ status: "ready", bytes: 180 });
    s = reduceModelState(s, { type: "delete" });
    expect(s).toEqual({ status: "absent" });
  });

  it("never reports more bytes than the total, and clamps install progress", () => {
    expect(reduceModelState(downloading, { type: "progress", bytes: 500 })).toEqual({
      status: "downloading",
      bytes: 100,
      total: 100,
    });
    expect(reduceModelState({ status: "installing", progress: 0 }, { type: "installing", progress: 4 })).toEqual({
      status: "installing",
      progress: 1,
    });
  });

  it("pauses and resumes with the bytes kept", () => {
    const paused = reduceModelState(downloading, { type: "pause" });
    expect(paused).toEqual({ status: "paused", bytes: 10, total: 100 });
    expect(canResume(paused)).toBe(true);
    expect(reduceModelState(paused, { type: "start", bytes: 10, total: 100 })).toEqual(downloading);
  });

  it("ignores a progress callback that lands after the pause", () => {
    const paused = reduceModelState(downloading, { type: "pause" });
    expect(reduceModelState(paused, { type: "progress", bytes: 99 })).toBe(paused);
  });

  it("keeps the downloaded bytes in an error, so Try again resumes", () => {
    const failed = reduceModelState(downloading, { type: "fail", error: { reason: "network" } });
    expect(failed).toEqual({ status: "error", error: { reason: "network" }, bytes: 10, total: 100 });
    expect(canResume(failed)).toBe(true);
    expect(reduceModelState(failed, { type: "start", bytes: 10, total: 100 }).status).toBe("downloading");
  });

  it("does not offer to resume a download that has not got anywhere", () => {
    expect(canResume({ status: "paused", bytes: 0, total: 100 })).toBe(false);
    expect(canResume({ status: "ready", bytes: 5 })).toBe(false);
    expect(canResume({ status: "absent" })).toBe(false);
  });

  it("cancels from any unfinished state, but never touches a ready model", () => {
    for (const s of [
      downloading,
      { status: "paused", bytes: 1, total: 2 },
      { status: "installing", progress: 0.5 },
      { status: "error", error: { reason: "network" }, bytes: 1, total: 2 },
    ] as ModelState[]) {
      expect(reduceModelState(s, { type: "cancel" })).toEqual({ status: "absent" });
    }
    const ready: ModelState = { status: "ready", bytes: 5 };
    expect(reduceModelState(ready, { type: "cancel" })).toBe(ready);
    expect(reduceModelState(ready, { type: "start", bytes: 0, total: 1 })).toBe(ready);
  });

  it("only deletes what is installed or broken", () => {
    expect(reduceModelState(downloading, { type: "delete" })).toBe(downloading);
    expect(reduceModelState({ status: "error", error: { reason: "install" }, bytes: 0, total: 0 }, { type: "delete" })).toEqual({
      status: "absent",
    });
  });

  it("takes whatever was found on disk at launch", () => {
    const found: ModelState = { status: "ready", bytes: 7 };
    expect(reduceModelState({ status: "absent" }, { type: "found", state: found })).toBe(found);
  });
});

describe("planChunks", () => {
  it("covers every byte once, in order, with a short last chunk", () => {
    const chunks = planChunks([{ path: "a", url: "u", bytes: 20 * MB + 5 }], 8 * MB);
    expect(chunks.map((c) => c.bytes)).toEqual([8 * MB, 8 * MB, 4 * MB + 5]);
    expect(chunks[0].from).toBe(0);
    expect(chunks[2].to).toBe(20 * MB + 4);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].from).toBe(chunks[i - 1].to + 1);
  });

  it("numbers chunks per item so two items never share a file", () => {
    const chunks = planChunks(
      [
        { path: "a", url: "u1", bytes: 10 },
        { path: "b", url: "u2", bytes: 10 },
      ],
      8
    );
    expect(new Set(chunks.map((c) => c.name)).size).toBe(chunks.length);
  });
});

/** An in-memory device: files are just sizes, the network is a function the test controls. */
function world(pack: ModelPack, opts: { free?: number } = {}) {
  const files = new Map<string, number>();
  const texts = new Map<string, string>();
  const log = { fetches: [] as string[], sleeps: [] as number[] };
  const control = {
    free: opts.free ?? 10_000 * MB,
    failNext: 0,
    ignoreRange: false,
    /** Resolves a fetch only when the test says so, so it can pause mid-download. */
    gate: null as null | ((url: string, range: { from: number }) => Promise<void>),
    chunkSizeDelta: 0,
  };
  const key = (p: string) => p.replace(/\/+$/, "");
  const underDir = (dir: string, path: string) => path === dir || path.startsWith(`${dir}/`);

  const deps: InstallerDeps = {
    availableBytes: () => control.free,
    exists: (p) => files.has(key(p)),
    size: (p) => files.get(key(p)) ?? null,
    ensureDir: () => {},
    remove: (p) => {
      for (const f of [...files.keys()]) if (underDir(key(p), f)) files.delete(f);
      for (const f of [...texts.keys()]) if (underDir(key(p), f)) texts.delete(f);
    },
    move: (from, to) => {
      files.set(key(to), files.get(key(from)) ?? 0);
      files.delete(key(from));
    },
    treeBytes: (dir) => [...files].reduce((n, [f, b]) => n + (underDir(key(dir), f) ? b : 0), 0),
    append: async (to, from) => {
      files.set(key(to), (files.get(key(to)) ?? 0) + (files.get(key(from)) ?? 0));
    },
    readText: (p) => texts.get(key(p)) ?? null,
    writeText: (p, t) => void texts.set(key(p), t),
    fetchRange: async (url, dest, range, { signal, onProgress }) => {
      log.fetches.push(`${range.from}-${range.to}`);
      if (control.gate) await control.gate(url, range);
      if (signal.aborted) throw new Error("aborted");
      if (control.failNext > 0) {
        control.failNext--;
        throw new Error("HTTP 503");
      }
      const wanted = range.to - range.from + 1;
      const got = control.ignoreRange ? pack.items[0].bytes : wanted + control.chunkSizeDelta;
      onProgress(Math.floor(got / 2));
      onProgress(got);
      files.set(key(dest), got);
      control.free -= got;
    },
    sleep: async (ms, signal) => {
      log.sleeps.push(ms);
      if (signal.aborted) throw new Error("aborted");
    },
  };
  return { files, texts, deps, log, control };
}

/** Three files in three folders, like the real pack: one big and cut into three chunks, two that are not. */
const ITEMS = [
  { path: "models/big.pte", url: "https://example.test/models/big.pte", bytes: 20 * MB + 5 },
  { path: "g2p/lexicon.json", url: "https://example.test/g2p/lexicon.json", bytes: 3 * MB },
  { path: "voices/af_heart.bin", url: "https://example.test/voices/af_heart.bin", bytes: MB / 2 },
];
const PACK: ModelPack = {
  id: "kokoro-test-pack",
  items: ITEMS,
  required: ITEMS.map((i) => ({ path: i.path, minBytes: i.bytes })),
  source: { name: "test", url: "https://example.test", license: "Apache-2.0" },
};
const ALL_FETCHES = [
  `0-${8 * MB - 1}`,
  `${8 * MB}-${16 * MB - 1}`,
  `${16 * MB}-${20 * MB + 4}`,
  `0-${3 * MB - 1}`,
  `0-${MB / 2 - 1}`,
];
const HOME = "/data/natural/kokoro-test-pack";

function installer(w: ReturnType<typeof world>, pack = PACK) {
  const states: ModelState[] = [];
  const inst = new ModelInstaller(pack, "/data/natural", w.deps, (s) => states.push(s));
  return { inst, states };
}

const statuses = (states: ModelState[]) => states.map((s) => s.status);

describe("ModelInstaller: on a real device's paths and failures", () => {
  it("keeps the three slashes of a file URI, so the folder is made where the cache folder is", async () => {
    const w = world(PACK);
    const made: string[] = [];
    w.deps.ensureDir = (p) => void made.push(p);
    const inst = new ModelInstaller(PACK, "file:///var/mobile/Caches/natural-voice/", w.deps);
    await inst.start();
    expect(inst.current.status).toBe("ready");
    const home = "file:///var/mobile/Caches/natural-voice/kokoro-test-pack";
    expect(inst.modelPath).toBe(`${home}/files`);
    expect(made).toEqual([`${home}/download`, `${home}/files`, `${home}/files/models`, `${home}/files/g2p`, `${home}/files/voices`]);
    expect([...w.files.keys()].every((f) => f.startsWith("file:///var/mobile/Caches/natural-voice/"))).toBe(true);
  });

  it("reports a folder that cannot be made as an error instead of throwing from start", async () => {
    const w = world(PACK);
    w.deps.ensureDir = () => {
      throw new Error("the volume is read only");
    };
    const { inst, states } = installer(w);
    await expect(inst.start()).resolves.toBeUndefined();
    expect(inst.current).toMatchObject({ status: "error", error: { reason: "unknown" } });
    expect(statuses(states)).toEqual(["downloading", "error"]);
    // And Try again works once the problem is gone.
    w.deps.ensureDir = () => {};
    await inst.start();
    expect(inst.current.status).toBe("ready");
  });
});

describe("ModelInstaller: a clean install", () => {
  it("downloads in chunks, joins them, puts each file in its folder, checks them and records the install last", async () => {
    const w = world(PACK);
    const { inst, states } = installer(w);
    inst.refresh();
    await inst.start();
    expect(inst.current.status).toBe("ready");
    expect(w.log.fetches).toEqual(ALL_FETCHES);
    expect(w.texts.get(`${HOME}/installed.json`)).toContain("kokoro-test-pack");
    // The chunks and the joined files are gone; only the files in place remain.
    expect([...w.files.keys()].sort()).toEqual(ITEMS.map((i) => `${HOME}/files/${i.path}`).sort());
    for (const item of ITEMS) expect(w.files.get(`${HOME}/files/${item.path}`)).toBe(item.bytes);
    expect(inst.modelPath).toBe(`${HOME}/files`);
    expect(statuses(states)).toContain("installing");
    expect(states.at(-1)).toMatchObject({ status: "ready", bytes: packDownloadBytes(PACK) });
  });

  it("shows install progress that goes up with the bytes joined and ends at 1", async () => {
    const w = world(PACK);
    const { inst, states } = installer(w);
    await inst.start();
    const progress = states.flatMap((s) => (s.status === "installing" ? [s.progress] : []));
    expect(progress.length).toBeGreaterThan(3);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
  });

  it("reports bytes that only ever go up and end at the total", async () => {
    const w = world(PACK);
    const { inst, states } = installer(w);
    await inst.start();
    const bytes = states.flatMap((s) => (s.status === "downloading" ? [s.bytes] : []));
    expect(bytes.length).toBeGreaterThan(3);
    for (let i = 1; i < bytes.length; i++) expect(bytes[i]).toBeGreaterThanOrEqual(bytes[i - 1]);
    expect(bytes.at(-1)).toBe(packDownloadBytes(PACK));
  });

  it("does nothing when it is already ready or already running", async () => {
    const w = world(PACK);
    const { inst } = installer(w);
    const first = inst.start();
    expect(inst.start()).toBe(first);
    await first;
    const fetched = w.log.fetches.length;
    await inst.start();
    expect(w.log.fetches).toHaveLength(fetched);
  });
});

describe("ModelInstaller: flaky networks", () => {
  it("retries a chunk with growing waits and carries on", async () => {
    const w = world(PACK);
    w.control.failNext = 2;
    const { inst } = installer(w);
    await inst.start();
    expect(inst.current.status).toBe("ready");
    expect(w.log.sleeps).toEqual([1000, 2000]);
  });

  it("stops in an error after repeated failures and keeps the chunks it has", async () => {
    const w = world(PACK);
    const { inst } = installer(w);
    // The first chunk goes through, then the connection dies for good.
    let calls = 0;
    const real = w.deps.fetchRange;
    w.deps.fetchRange = async (...args) => {
      if (++calls > 1) throw new Error("offline");
      return real(...args);
    };
    await inst.start();
    expect(inst.current).toMatchObject({ status: "error", error: { reason: "network" }, bytes: 8 * MB });
    expect(canResume(inst.current)).toBe(true);
    // Resuming fetches only what is missing.
    w.deps.fetchRange = real;
    w.log.fetches.length = 0;
    await inst.start();
    expect(inst.current.status).toBe("ready");
    expect(w.log.fetches).toEqual(ALL_FETCHES.slice(1));
  });

  it("treats a server that ignores the range as a bad download, not a good one", async () => {
    const w = world(PACK);
    w.control.ignoreRange = true;
    const { inst } = installer(w);
    await inst.start();
    expect(inst.current).toMatchObject({ status: "error", error: { reason: "integrity" } });
    expect(w.texts.size).toBe(0);
  });
});

describe("ModelInstaller: pause, resume and cancel", () => {
  it("pauses mid-download, keeps whole chunks, and resumes to the end", async () => {
    const w = world(PACK);
    const { inst, states } = installer(w);
    let release!: () => void;
    let calls = 0;
    w.control.gate = (_u, range) => {
      calls++;
      if (calls === 2) return new Promise<void>((r) => (release = r)); // hold the second chunk
      return Promise.resolve();
    };
    const run = inst.start();
    await new Promise((r) => setTimeout(r, 0));
    inst.pause();
    release();
    await run;
    expect(inst.current).toMatchObject({ status: "paused", bytes: 8 * MB });
    // A progress callback arriving late changes nothing.
    const frozen = inst.current;
    expect(statuses(states).at(-1)).toBe("paused");
    expect(inst.current).toBe(frozen);

    w.control.gate = null;
    w.log.fetches.length = 0;
    await inst.start();
    expect(inst.current.status).toBe("ready");
    expect(w.log.fetches).toEqual(ALL_FETCHES.slice(1));
  });

  it("cancels, throws away the partial download, and starts over from nothing", async () => {
    const w = world(PACK);
    const { inst } = installer(w);
    let release!: () => void;
    let calls = 0;
    w.control.gate = () => {
      if (++calls === 2) return new Promise<void>((r) => (release = r));
      return Promise.resolve();
    };
    const run = inst.start();
    await new Promise((r) => setTimeout(r, 0));
    const cancelled = inst.cancel();
    release();
    await Promise.all([run, cancelled]);
    expect(inst.current).toEqual({ status: "absent" });
    expect(w.files.size).toBe(0);

    w.control.gate = null;
    w.log.fetches.length = 0;
    await inst.start();
    expect(w.log.fetches[0]).toBe(`0-${8 * MB - 1}`);
    expect(inst.current.status).toBe("ready");
  });

  it("deletes an installed model and everything under its folder", async () => {
    const w = world(PACK);
    const { inst } = installer(w);
    await inst.start();
    await inst.delete();
    expect(inst.current).toEqual({ status: "absent" });
    expect(w.files.size).toBe(0);
    expect(w.texts.size).toBe(0);
    expect(inst.refresh()).toEqual({ status: "absent" });
  });
});

describe("ModelInstaller: disk space", () => {
  it("needs room for every chunk, the largest file joined whole beside them, and a margin", () => {
    expect(packInstallBytes(PACK)).toBe(packDownloadBytes(PACK) + (20 * MB + 5) + SPACE_MARGIN_BYTES);
  });

  it("refuses to start without room for the download, the file being joined and a margin", async () => {
    const need = packInstallBytes(PACK);
    const w = world(PACK, { free: need - 1 });
    const { inst } = installer(w);
    await inst.start();
    expect(inst.current).toMatchObject({ status: "error", error: { reason: "storage", neededBytes: need } });
    expect(w.log.fetches).toEqual([]);
  });

  it("counts what is already downloaded as space already spent", async () => {
    const w = world(PACK);
    const { inst } = installer(w);
    let calls = 0;
    const real = w.deps.fetchRange;
    w.deps.fetchRange = async (...args) => {
      if (++calls > 1) throw new Error("offline");
      return real(...args);
    };
    await inst.start();
    w.deps.fetchRange = real;
    const need = packInstallBytes(PACK);
    w.control.free = need - 8 * MB; // exactly enough once the first chunk is counted
    await inst.start();
    expect(inst.current.status).toBe("ready");
  });

  it("stops with a storage error when the disk fills mid-download", async () => {
    const w = world(PACK);
    const { inst } = installer(w);
    const real = w.deps.fetchRange;
    let calls = 0;
    w.deps.fetchRange = async (...args) => {
      if (++calls === 2) {
        w.control.free = 1 * MB;
        throw new Error("write failed");
      }
      return real(...args);
    };
    await inst.start();
    expect(inst.current).toMatchObject({ status: "error", error: { reason: "storage" } });
  });
});

describe("ModelInstaller: what is on disk at launch", () => {
  it("is absent on a fresh device", () => {
    const { inst } = installer(world(PACK));
    expect(inst.refresh()).toEqual({ status: "absent" });
  });

  it("is ready when the marker and every required file are there, even in a new session", async () => {
    const w = world(PACK);
    await installer(w).inst.start();
    const next = installer(w).inst;
    expect(next.refresh()).toMatchObject({ status: "ready" });
  });

  it("starts clean when the marker is there but a required file is missing or too small", async () => {
    const w = world(PACK);
    await installer(w).inst.start();
    w.files.set(`${HOME}/files/models/big.pte`, 100);
    const next = installer(w).inst;
    expect(next.refresh()).toEqual({ status: "absent" });
    expect(w.files.size).toBe(0);
  });

  it("ignores a marker for a different pack or one that is damaged", async () => {
    const w = world(PACK);
    await installer(w).inst.start();
    w.texts.set(`${HOME}/installed.json`, "{not json");
    expect(installer(w).inst.refresh()).toEqual({ status: "absent" });
  });

  it("offers to resume a download that was cut off when the app quit", () => {
    const w = world(PACK);
    w.files.set(`${HOME}/download/0-0.part`, 8 * MB);
    w.files.set(`${HOME}/download/0-1.part`, 3 * MB); // incomplete: not counted
    const { inst } = installer(w);
    expect(inst.refresh()).toEqual({ status: "paused", bytes: 8 * MB, total: packDownloadBytes(PACK) });
  });
});

describe("ModelInstaller: failures after the download", () => {
  it("reports an install error and keeps the chunks, so a retry does not download again", async () => {
    const w = world(PACK);
    const { inst } = installer(w);
    const real = w.deps.append;
    w.deps.append = async () => {
      throw new Error("the disk is full");
    };
    await inst.start();
    expect(inst.current).toMatchObject({ status: "error", error: { reason: "install" } });
    expect(w.texts.size).toBe(0);

    w.deps.append = real;
    w.log.fetches.length = 0;
    await inst.start();
    expect(w.log.fetches).toEqual([]);
    expect(inst.current.status).toBe("ready");
  });

  it("keeps the files already in place when a later one fails, and counts them as downloaded on resume", async () => {
    const w = world(PACK);
    const { inst } = installer(w);
    const real = w.deps.append;
    let joined = 0;
    w.deps.append = async (to, from) => {
      // Item 0 joins from three chunks; the fourth append is item 1's first.
      if (++joined > 3) throw new Error("interrupted");
      return real(to, from);
    };
    await inst.start();
    expect(inst.current).toMatchObject({ status: "error", error: { reason: "install" } });
    expect(w.files.get(`${HOME}/files/models/big.pte`)).toBe(20 * MB + 5);
    // A new session sees a download that is whole, not one that must start over.
    expect(installer(w).inst.refresh()).toEqual({ status: "paused", bytes: packDownloadBytes(PACK), total: packDownloadBytes(PACK) });

    w.deps.append = real;
    w.log.fetches.length = 0;
    await inst.start();
    expect(w.log.fetches).toEqual([]);
    expect(inst.current.status).toBe("ready");
    expect(w.files.get(`${HOME}/files/models/big.pte`)).toBe(20 * MB + 5);
  });

  it("fails as integrity when a file in place is smaller than the pack promises", async () => {
    const w = world(PACK);
    const bad: ModelPack = { ...PACK, required: PACK.required.map((r) => (r.path === "g2p/lexicon.json" ? { ...r, minBytes: 4 * MB } : r)) };
    const { inst } = installer(w, bad);
    await inst.start();
    expect(inst.current).toMatchObject({ status: "error", error: { reason: "integrity" } });
    expect(w.texts.size).toBe(0);
  });

  it("fails as integrity when a joined file is the wrong size", async () => {
    const w = world(PACK);
    const real = w.deps.append;
    w.deps.append = async (to, from) => {
      await real(to, from);
      w.files.set(to, (w.files.get(to) ?? 0) - 1);
    };
    const { inst } = installer(w);
    await inst.start();
    expect(inst.current).toMatchObject({ status: "error", error: { reason: "integrity" } });
  });
});
