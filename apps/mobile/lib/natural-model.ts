/**
 * Getting the natural-voice model onto the device, and off it again.
 *
 * The model is never in the app binary: the writer opts in from Listening
 * settings, sees the size first, and it downloads from a public source. The
 * download is cut into ranged chunks, each saved as its own file, so Pause,
 * a dropped connection and even quitting the app all resume from the last
 * whole chunk. The pure state machine (`reduceModelState`) is what the screen
 * reads; `ModelInstaller` drives it against injected file and network
 * operations, so the whole flow is tested without a device.
 */

export type ModelErrorReason = "network" | "storage" | "integrity" | "install" | "unknown";
export type ModelError = { reason: ModelErrorReason; /** For "storage": how many bytes the install needs. */ neededBytes?: number };

export type ModelState =
  | { status: "absent" }
  | { status: "downloading"; bytes: number; total: number }
  /** Stopped by the writer or by the connection, with whole chunks kept: it resumes. */
  | { status: "paused"; bytes: number; total: number }
  /** Joining the chunks into the model's files. */
  | { status: "installing"; progress: number }
  | { status: "ready"; bytes: number }
  | { status: "error"; error: ModelError; bytes: number; total: number };

export type ModelEvent =
  | { type: "start"; bytes: number; total: number }
  | { type: "progress"; bytes: number }
  | { type: "pause" }
  | { type: "installing"; progress: number }
  | { type: "installed"; bytes: number }
  | { type: "fail"; error: ModelError }
  | { type: "cancel" }
  | { type: "delete" }
  /** What was found on disk at launch. */
  | { type: "found"; state: ModelState };

/**
 * One transition. A late event (a progress callback that lands after Pause, a
 * Start on a model that is ready) leaves the state as it was.
 */
export function reduceModelState(state: ModelState, event: ModelEvent): ModelState {
  switch (event.type) {
    case "found":
      return event.state;
    case "start":
      return state.status === "absent" || state.status === "paused" || state.status === "error"
        ? { status: "downloading", bytes: event.bytes, total: event.total }
        : state;
    case "progress":
      return state.status === "downloading"
        ? { status: "downloading", bytes: Math.min(event.bytes, state.total), total: state.total }
        : state;
    case "pause":
      return state.status === "downloading"
        ? { status: "paused", bytes: state.bytes, total: state.total }
        : state;
    case "installing":
      return state.status === "downloading" || state.status === "installing"
        ? { status: "installing", progress: Math.max(0, Math.min(1, event.progress)) }
        : state;
    case "installed":
      return state.status === "installing" || state.status === "downloading"
        ? { status: "ready", bytes: event.bytes }
        : state;
    case "fail":
      if (state.status === "downloading" || state.status === "paused") {
        return { status: "error", error: event.error, bytes: state.bytes, total: state.total };
      }
      if (state.status === "installing") {
        return { status: "error", error: event.error, bytes: 0, total: 0 };
      }
      return state;
    case "cancel":
      return state.status === "downloading" || state.status === "paused" || state.status === "error" || state.status === "installing"
        ? { status: "absent" }
        : state;
    case "delete":
      return state.status === "ready" || state.status === "error" ? { status: "absent" } : state;
  }
}

/** True when starting would pick the download back up rather than begin it. */
export function canResume(state: ModelState): boolean {
  return (state.status === "paused" || state.status === "error") && state.bytes > 0;
}

export type PackItem = {
  /** Where the file lands under the pack's folder. */
  path: string;
  url: string;
  bytes: number;
};

/** What a model pack is, where it comes from, and how to tell it installed whole. */
export type ModelPack = {
  /** Permanent: it names the folder and the audio cache, so a new pack gets a new id. */
  id: string;
  items: PackItem[];
  /** Files that must exist, and how big at least, or the install is broken. */
  required: { path: string; minBytes: number }[];
  /** Shown in Listening settings and recorded in docs/natural-voice.md. */
  source: { name: string; url: string; license: string };
};

export const packDownloadBytes = (pack: ModelPack) => pack.items.reduce((n, i) => n + i.bytes, 0);

/**
 * Disk an install needs at its peak: every chunk downloaded, plus the largest
 * file joined whole before its chunks go (the files are not unpacked, so the
 * installed model is the same size as the download), and a margin.
 */
export const packInstallBytes = (pack: ModelPack) =>
  packDownloadBytes(pack) + Math.max(...pack.items.map((i) => i.bytes)) + SPACE_MARGIN_BYTES;

/** The file and network operations an install needs. Paths are plain strings. */
export type InstallerDeps = {
  availableBytes(): number;
  exists(path: string): boolean;
  /** Size of a file, or null when it is missing. */
  size(path: string): number | null;
  ensureDir(path: string): void;
  remove(path: string): void;
  move(from: string, to: string): void;
  /** Total bytes of every file under a folder. */
  treeBytes(path: string): number;
  /** Appends the whole of `from` to `to`, creating it. */
  append(to: string, from: string): Promise<void>;
  readText(path: string): string | null;
  writeText(path: string, text: string): void;
  /** Downloads bytes `from..to` (inclusive) of `url` into `dest`; rejects on abort, network or HTTP errors. */
  fetchRange(
    url: string,
    dest: string,
    range: { from: number; to: number },
    handlers: { signal: AbortSignal; onProgress: (bytesInChunk: number) => void }
  ): Promise<void>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
};

export const CHUNK_BYTES = 8 * 1024 * 1024;
const RETRIES = 4;
/** Room beyond the model's own files, for the OS and the writer's own work. */
export const SPACE_MARGIN_BYTES = 100 * 1024 * 1024;
const MARKER = "installed.json";

type Chunk = { item: number; index: number; from: number; to: number; name: string; bytes: number };

export function planChunks(items: PackItem[], chunkBytes = CHUNK_BYTES): Chunk[] {
  const out: Chunk[] = [];
  items.forEach((item, itemIndex) => {
    for (let from = 0, index = 0; from < item.bytes; from += chunkBytes, index++) {
      const to = Math.min(from + chunkBytes, item.bytes) - 1;
      out.push({ item: itemIndex, index, from, to, name: `${itemIndex}-${index}.part`, bytes: to - from + 1 });
    }
  });
  return out;
}

/**
 * Joins path parts with single slashes. A URI keeps the slashes after its scheme (`file:///var/...`):
 * collapsing them to `file://var/...` names a host called "var" and fails on a real device.
 */
const join = (...parts: string[]) => {
  const joined = parts.join("/");
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/\/?/i.exec(joined)?.[0] ?? "";
  return scheme + joined.slice(scheme.length).replace(/\/{2,}/g, "/");
};

export class ModelInstaller {
  private state: ModelState = { status: "absent" };
  private abort: AbortController | null = null;
  private running: Promise<void> | null = null;
  private stopRequest: "pause" | "cancel" | null = null;

  constructor(
    private pack: ModelPack,
    private root: string,
    private deps: InstallerDeps,
    private onChange: (state: ModelState) => void = () => {}
  ) {}

  private get dir() {
    return join(this.root, this.pack.id);
  }
  private get downloads() {
    return join(this.dir, "download");
  }
  private get installed() {
    return join(this.dir, "files");
  }
  /** The folder the runtime finds the model files under once installed. */
  get modelPath() {
    return this.installed;
  }
  get current(): ModelState {
    return this.state;
  }

  private dispatch(event: ModelEvent) {
    const next = reduceModelState(this.state, event);
    if (next === this.state) return;
    this.state = next;
    this.onChange(next);
  }

  /** Looks at the disk and sets the state: ready, resumable, or absent. */
  refresh(): ModelState {
    if (this.running) return this.state;
    this.dispatch({ type: "found", state: this.inspect() });
    return this.state;
  }

  private inspect(): ModelState {
    const marker = this.deps.readText(join(this.dir, MARKER));
    if (marker) {
      try {
        const parsed = JSON.parse(marker) as { id?: string; bytes?: number };
        if (parsed.id === this.pack.id && this.requiredPresent()) {
          return { status: "ready", bytes: typeof parsed.bytes === "number" ? parsed.bytes : packDownloadBytes(this.pack) };
        }
      } catch {
        /* a damaged marker means the install is not whole */
      }
      // The marker is there but the files are not: start clean.
      this.deps.remove(this.dir);
      return { status: "absent" };
    }
    const have = this.completedBytes();
    const total = packDownloadBytes(this.pack);
    return have > 0 ? { status: "paused", bytes: have, total } : { status: "absent" };
  }

  private requiredPresent() {
    return this.pack.required.every((f) => {
      const size = this.deps.size(join(this.installed, f.path));
      return size !== null && size >= f.minBytes;
    });
  }

  /** The file of an item, already in place in the installed folder. */
  private placed(item: number) {
    const { path, bytes } = this.pack.items[item];
    return this.deps.size(join(this.installed, path)) === bytes;
  }

  /**
   * An item whose chunks are no longer needed: joined whole before an
   * interruption, or already moved into place (its chunks went when it was joined).
   */
  private joined(item: number) {
    return this.placed(item) || this.deps.size(join(this.downloads, `item-${item}.bin`)) === this.pack.items[item].bytes;
  }

  private completedBytes() {
    return planChunks(this.pack.items).reduce((n, chunk) => {
      if (this.joined(chunk.item)) return n + chunk.bytes;
      const size = this.deps.size(join(this.downloads, chunk.name));
      return n + (size === chunk.bytes ? chunk.bytes : 0);
    }, 0);
  }

  /** Begins, or resumes, the download and install. Resolves when it ends, however it ends. */
  start(): Promise<void> {
    if (this.running) return this.running;
    if (this.state.status === "ready" || this.state.status === "installing") return Promise.resolve();
    this.stopRequest = null;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    const run = this.install(signal)
      // Whatever slips past the steps' own handling (a folder that cannot be made, a full disk
      // while unpacking) is still an error the screen can show, never an unhandled rejection.
      .catch((e: unknown) => {
        if (signal.aborted) return this.handleStop();
        this.fail({ reason: e instanceof StorageError ? "storage" : "unknown" });
      })
      .finally(() => {
        this.running = null;
        this.abort = null;
      });
    this.running = run;
    return run;
  }

  /** Stops the download and keeps the whole chunks, so Start resumes. */
  pause() {
    if (this.state.status !== "downloading") return;
    this.stopRequest = "pause";
    this.abort?.abort();
  }

  /** Stops and throws away what was downloaded. */
  async cancel() {
    this.stopRequest = "cancel";
    this.abort?.abort();
    await this.running;
    this.deps.remove(this.dir);
    this.dispatch({ type: "cancel" });
  }

  /** Removes the installed model. */
  async delete() {
    await this.running;
    this.deps.remove(this.dir);
    this.dispatch({ type: "delete" });
  }

  private fail(error: ModelError) {
    this.dispatch({ type: "fail", error });
  }

  private async install(signal: AbortSignal): Promise<void> {
    const total = packDownloadBytes(this.pack);
    const needed = packInstallBytes(this.pack);
    const resumed = this.completedBytes();
    // What is already downloaded is already paid for in disk space.
    if (this.deps.availableBytes() + resumed < needed) {
      this.dispatch({ type: "start", bytes: resumed, total });
      return this.fail({ reason: "storage", neededBytes: needed - resumed });
    }
    // Start first: a failure below only shows as an error from a state that is downloading.
    this.dispatch({ type: "start", bytes: resumed, total });
    this.deps.ensureDir(this.downloads);

    const chunks = planChunks(this.pack.items);
    let done = resumed;
    try {
      for (const chunk of chunks) {
        const final = join(this.downloads, chunk.name);
        if (this.joined(chunk.item) || this.deps.size(final) === chunk.bytes) continue;
        await this.fetchChunk(chunk, signal, (inChunk) => this.dispatch({ type: "progress", bytes: done + inChunk }));
        done += chunk.bytes;
        this.dispatch({ type: "progress", bytes: done });
      }
    } catch (e) {
      if (signal.aborted) return this.handleStop();
      return this.fail({
        reason: e instanceof StorageError ? "storage" : e instanceof IntegrityError ? "integrity" : "network",
      });
    }
    if (signal.aborted) return this.handleStop();

    this.dispatch({ type: "installing", progress: 0 });
    try {
      await this.assemble(signal);
    } catch (e) {
      if (signal.aborted) return this.handleStop();
      return this.fail({ reason: e instanceof IntegrityError ? "integrity" : "install" });
    }
    if (signal.aborted) return this.handleStop();
    if (!this.requiredPresent()) return this.fail({ reason: "integrity" });
    const bytes = this.deps.treeBytes(this.installed);
    this.deps.remove(this.downloads);
    this.deps.writeText(join(this.dir, MARKER), JSON.stringify({ id: this.pack.id, bytes, at: Date.now() }));
    this.dispatch({ type: "installed", bytes });
  }

  private handleStop() {
    if (this.stopRequest === "cancel") return; // cancel() clears the disk and the state itself
    this.dispatch({ type: "pause" });
  }

  private async fetchChunk(chunk: Chunk, signal: AbortSignal, onProgress: (bytes: number) => void) {
    const item = this.pack.items[chunk.item];
    const part = join(this.downloads, `${chunk.name}.tmp`);
    const final = join(this.downloads, chunk.name);
    let lastError: unknown;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      if (signal.aborted) throw new Error("aborted");
      try {
        this.deps.remove(part);
        await this.deps.fetchRange(item.url, part, { from: chunk.from, to: chunk.to }, { signal, onProgress });
        // A server that ignored the range sends the whole file, which would be the wrong size here.
        if (this.deps.size(part) !== chunk.bytes) throw new IntegrityError("chunk size");
        this.deps.move(part, final);
        return;
      } catch (e) {
        lastError = e;
        this.deps.remove(part);
        if (signal.aborted) throw e;
        if (this.deps.availableBytes() < chunk.bytes) throw new StorageError();
        if (attempt < RETRIES - 1) await this.deps.sleep(1000 * 2 ** attempt, signal);
      }
    }
    throw lastError;
  }

  /**
   * Joins each item's chunks, checks the size, and moves the file into place.
   * Chunks are only deleted once the whole file is joined and its size is right,
   * and a file only counts as downloaded again once it is in place, so an
   * interruption anywhere here loses nothing that was downloaded.
   */
  private async assemble(signal: AbortSignal) {
    const chunks = planChunks(this.pack.items);
    const total = packDownloadBytes(this.pack);
    this.deps.ensureDir(this.installed);
    let done = 0;
    for (let i = 0; i < this.pack.items.length; i++) {
      const item = this.pack.items[i];
      const whole = join(this.downloads, `item-${i}.bin`);
      const target = join(this.installed, item.path);
      if (!this.placed(i)) {
        if (this.deps.size(whole) !== item.bytes) {
          this.deps.remove(whole);
          let joinedBytes = 0;
          for (const chunk of chunks.filter((c) => c.item === i)) {
            if (signal.aborted) throw new Error("aborted");
            await this.deps.append(whole, join(this.downloads, chunk.name));
            joinedBytes += chunk.bytes;
            this.dispatch({ type: "installing", progress: (done + joinedBytes) / total });
          }
          if (this.deps.size(whole) !== item.bytes) {
            this.deps.remove(whole);
            throw new IntegrityError("item size");
          }
          for (const chunk of chunks.filter((c) => c.item === i)) this.deps.remove(join(this.downloads, chunk.name));
        }
        this.deps.ensureDir(target.slice(0, target.lastIndexOf("/")));
        this.deps.move(whole, target);
      }
      done += item.bytes;
      this.dispatch({ type: "installing", progress: done / total });
    }
  }
}

class StorageError extends Error {}
class IntegrityError extends Error {}
