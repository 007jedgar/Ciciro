import {
  createKokoroEngine,
  type AudioOutput,
  type EngineEvent,
  type NaturalAudio,
  type NaturalRuntime,
  type OutputEvents,
} from "../lib/kokoro-engine";
import { phonemizerFor, type NaturalVoice } from "../lib/natural-voice";
import type { SpeechRun } from "../lib/read-aloud";
import { memoryCacheFiles, SentenceCache } from "../lib/sentence-cache";

/** Lets the engine's async pump run until it is waiting on something. */
const flush = async (turns = 12) => {
  for (let i = 0; i < turns; i++) await Promise.resolve();
};

const SECOND = 24000;
const audio = (seconds: number): NaturalAudio => ({
  samples: new Float32Array(Math.round(seconds * SECOND)).fill(0.1),
  sampleRate: SECOND,
});

type Job = { text: string; voice: NaturalVoice; speed: number; resolve: (a: NaturalAudio) => void; reject: (e: Error) => void };

/** A model whose every sentence waits for the test to finish it, so timing is in the test's hands. */
function fakeRuntime(opts: { loadFails?: boolean; onLoad?: () => void } = {}) {
  const jobs: Job[] = [];
  let active = 0;
  let maxActive = 0;
  // Like the real runtime: a second load for the same phonemizer does nothing, a release forgets it.
  let loaded: string | null = null;
  const runtime: NaturalRuntime & { loads: number; releases: number } = {
    loads: 0,
    releases: 0,
    async load(voice) {
      const g2p = phonemizerFor(voice);
      if (loaded === g2p) return;
      if (opts.loadFails) throw new Error("no model");
      opts.onLoad?.();
      loaded = g2p;
      runtime.loads++;
    },
    synthesize(text, options) {
      active++;
      maxActive = Math.max(maxActive, active);
      return new Promise<NaturalAudio>((resolve, reject) => {
        jobs.push({
          text,
          ...options,
          resolve: (a) => {
            active--;
            resolve(a);
          },
          reject: (e) => {
            active--;
            reject(e);
          },
        });
      });
    },
    async release() {
      loaded = null;
      runtime.releases++;
    },
  };
  return { runtime, jobs, maxActive: () => maxActive };
}

function fakeOutput() {
  let events: OutputEvents | null = null;
  const queued: number[] = [];
  const output: AudioOutput & { closes: number } = {
    closes: 0,
    open(e) {
      events = e;
      queued.length = 0;
    },
    enqueue(tag) {
      queued.push(tag);
    },
    close() {
      output.closes++;
    },
  };
  return {
    output,
    queued,
    start: (tag: number) => events?.onStarted(tag),
    end: (tag: number) => events?.onEnded(tag),
    fail: () => events?.onError("device"),
  };
}

function setup(
  overrides: { loadFails?: boolean; loadTakesMs?: number; options?: Parameters<typeof createKokoroEngine>[0]["options"] } = {}
) {
  let clock = 0;
  const rt = fakeRuntime({ loadFails: overrides.loadFails, onLoad: () => (clock += overrides.loadTakesMs ?? 0) });
  const out = fakeOutput();
  const files = memoryCacheFiles();
  const cache = new SentenceCache(files, { maxBytes: 50_000_000 });
  const scheduled: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const events: EngineEvent[] = [];
  const engine = createKokoroEngine({
    runtime: rt.runtime,
    output: out.output,
    cache,
    modelId: "kokoro-test",
    now: () => clock,
    timers: {
      setTimeout: (fn, ms) => {
        const t = { fn, ms, cleared: false };
        scheduled.push(t);
        return t;
      },
      clearTimeout: (h) => {
        (h as { cleared: boolean }).cleared = true;
      },
    },
    report: (e) => events.push(e),
    options: overrides.options,
  });
  const log = {
    sentences: [] as number[],
    buffering: [] as boolean[],
    done: 0,
    errors: [] as Array<{ reason: string; index: number }>,
  };
  const run = (texts: string[], extra: Partial<SpeechRun> = {}) =>
    engine.playRun({
      texts,
      from: 0,
      rate: 1,
      voice: "af_heart",
      onSentence: (i) => log.sentences.push(i),
      onBuffering: (b) => log.buffering.push(b),
      onDone: () => log.done++,
      onError: (e) => log.errors.push(e),
      ...extra,
    });
  return {
    ...rt,
    ...out,
    engine,
    cache,
    files,
    log,
    events,
    run,
    advance: (ms: number) => (clock += ms),
    scheduled,
  };
}

describe("kokoro engine: reading ahead", () => {
  it("synthesises the next sentences while the current one plays, a few ahead and no more", async () => {
    const t = setup();
    t.run(["One.", "Two.", "Three.", "Four.", "Five."]);
    await flush();
    expect(t.jobs.map((j) => j.text)).toEqual(["One."]);
    t.jobs[0].resolve(audio(2));
    await flush();
    expect(t.queued).toEqual([0]);
    expect(t.jobs.map((j) => j.text)).toEqual(["One.", "Two."]);
    t.jobs[1].resolve(audio(2));
    await flush();
    // Nothing has started playing yet, so it holds at two prepared.
    expect(t.jobs).toHaveLength(2);
    t.start(0);
    await flush();
    expect(t.jobs.map((j) => j.text)).toEqual(["One.", "Two.", "Three."]);
    t.jobs[2].resolve(audio(2));
    await flush();
    expect(t.jobs).toHaveLength(3);
    t.end(0);
    t.start(1);
    await flush();
    expect(t.jobs.map((j) => j.text)).toEqual(["One.", "Two.", "Three.", "Four."]);
    expect(t.maxActive()).toBe(1);
  });

  it("queues sentences in order without waiting for the previous one to finish, so playback has no gap", async () => {
    const t = setup();
    t.run(["One.", "Two."]);
    await flush();
    t.jobs[0].resolve(audio(2));
    await flush();
    t.jobs[1].resolve(audio(2));
    await flush();
    expect(t.queued).toEqual([0, 1]);
  });

  it("reports each sentence as it becomes audible and finishes after the last one ends", async () => {
    const t = setup();
    t.run(["One.", "Two."]);
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush();
    t.jobs[1].resolve(audio(1));
    await flush();
    expect(t.log.buffering).toEqual([true]);
    t.start(0);
    expect(t.log.sentences).toEqual([0]);
    expect(t.log.buffering).toEqual([true, false]);
    t.end(0);
    t.start(1);
    expect(t.log.sentences).toEqual([0, 1]);
    expect(t.log.done).toBe(0);
    t.end(1);
    expect(t.log.done).toBe(1);
    expect(t.output.closes).toBe(1);
  });

  it("starts at the sentence it is given", async () => {
    const t = setup();
    t.run(["One.", "Two.", "Three."], { from: 2 });
    await flush();
    expect(t.jobs.map((j) => j.text)).toEqual(["Three."]);
    t.jobs[0].resolve(audio(1));
    await flush();
    expect(t.queued).toEqual([2]);
    t.start(2);
    t.end(2);
    expect(t.log.sentences).toEqual([2]);
    expect(t.log.done).toBe(1);
  });

  it("reads in the chosen voice and speed, and falls back to a default voice for an unknown one", async () => {
    const t = setup();
    t.run(["One."], { voice: "bf_emma", rate: 1.5 });
    await flush();
    expect(t.jobs[0]).toMatchObject({ voice: { id: "bf_emma" }, speed: 1.5 });
    t.jobs[0].resolve(audio(1));
    t.engine.stop();
    t.run(["Two."], { voice: "no_such_voice" });
    await flush(40);
    expect(t.jobs.at(-1)).toMatchObject({ voice: { id: "af_heart" }, text: "Two." });
  });

  it("speaks one sentence for an engine caller that is not read-ahead aware", async () => {
    const t = setup();
    const onDone = jest.fn();
    t.engine.speak("Only one.", { rate: 1, voice: "af_heart", onDone, onError: jest.fn() });
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush();
    t.start(0);
    t.end(0);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("kokoro engine: the sentence cache", () => {
  it("keeps what it synthesised and does not synthesise it again", async () => {
    const t = setup();
    t.run(["One.", "Two."]);
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush();
    t.jobs[1].resolve(audio(1));
    await flush(40);
    expect(await t.cache.size()).toBeGreaterThan(0);

    t.engine.stop();
    t.jobs.length = 0;
    t.run(["One.", "Two."]);
    await flush(40);
    expect(t.jobs).toHaveLength(0);
    expect(t.queued).toEqual([0, 1]);
  });

  it("does not load the model for a chapter it has heard before", async () => {
    const t = setup();
    t.run(["One.", "Two."]);
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush();
    t.jobs[1].resolve(audio(1));
    await flush(40);
    expect(t.runtime.loads).toBe(1);

    // The model was freed after sitting idle; the replay comes from the cache alone.
    t.engine.stop();
    t.scheduled.at(-1)!.fn();
    await flush();
    expect(t.runtime.releases).toBe(1);
    t.jobs.length = 0;
    t.run(["One.", "Two."]);
    await flush(40);
    expect(t.queued).toEqual([0, 1]);
    expect(t.runtime.loads).toBe(1);
  });

  it("loads the model once, at the first sentence the cache cannot answer", async () => {
    const t = setup();
    t.run(["One.", "Two."]);
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush();
    t.jobs[1].resolve(audio(1));
    await flush(40);
    t.engine.stop();
    t.scheduled.at(-1)!.fn();
    await flush();
    t.jobs.length = 0;

    t.run(["One.", "A new sentence."]);
    await flush(40);
    expect(t.queued).toEqual([0]);
    expect(t.runtime.loads).toBe(2);
    expect(t.jobs).toHaveLength(1);
  });

  it("hands the runtime the voice of each read, so a voice in another language loads its own phonemizer", async () => {
    const t = setup();
    t.run(["One."], { voice: "af_heart" });
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush(40);
    t.engine.stop();

    t.run(["Uno."], { voice: "af_sarah" });
    await flush(40);
    t.jobs[1].resolve(audio(1));
    await flush(40);
    expect(t.runtime.loads).toBe(1);
    t.engine.stop();

    t.run(["Uno."], { voice: "ef_dora" });
    await flush(40);
    expect(t.runtime.loads).toBe(2);
    expect(t.jobs.at(-1)).toMatchObject({ voice: { id: "ef_dora" } });
  });

  it("synthesises again at a different speed or in a different voice", async () => {
    const t = setup();
    t.run(["One."]);
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush(40);
    t.engine.stop();
    t.run(["One."], { rate: 1.25 });
    await flush(40);
    expect(t.jobs).toHaveLength(2);
    t.jobs[1].resolve(audio(1));
    await flush(40);
    t.engine.stop();
    t.run(["One."], { voice: "af_sarah" });
    await flush(40);
    expect(t.jobs).toHaveLength(3);
  });

  it("still caches a sentence that finished after the read was stopped", async () => {
    const t = setup();
    t.run(["One.", "Two."]);
    await flush();
    t.engine.stop();
    t.jobs[0].resolve(audio(1));
    await flush(40);
    expect(t.queued).toEqual([]);
    expect(await t.cache.size()).toBeGreaterThan(0);
  });

  it("carries on when the cache cannot be read", async () => {
    const t = setup();
    jest.spyOn(t.cache, "get").mockRejectedValue(new Error("disk"));
    jest.spyOn(t.cache, "put").mockRejectedValue(new Error("disk"));
    t.run(["One."]);
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush(40);
    expect(t.queued).toEqual([0]);
  });
});

describe("kokoro engine: stopping", () => {
  it("drops audio and events from a read that was stopped", async () => {
    const t = setup();
    t.run(["One.", "Two."]);
    await flush();
    t.engine.stop();
    expect(t.output.closes).toBe(1);
    t.jobs[0].resolve(audio(1));
    await flush(40);
    t.start(0);
    t.end(0);
    expect(t.log.sentences).toEqual([]);
    expect(t.log.done).toBe(0);
    expect(t.queued).toEqual([]);
  });

  it("never runs two sentences through the model at once, even across a stop and a restart", async () => {
    const t = setup();
    t.run(["One.", "Two."]);
    await flush();
    t.engine.stop();
    t.run(["One.", "Two."]);
    await flush();
    expect(t.jobs).toHaveLength(1);
    t.jobs[0].resolve(audio(1));
    await flush(40);
    expect(t.maxActive()).toBe(1);
  });

  it("does not synthesise for a read that was stopped while it waited its turn", async () => {
    const t = setup();
    t.run(["One."]);
    await flush();
    t.run(["Two."]); // replaces the first read, which is still inside the model
    t.engine.stop();
    t.jobs[0].resolve(audio(1));
    await flush(40);
    expect(t.jobs.map((j) => j.text)).toEqual(["One."]);
  });

  it("reports a read stopped partway as stopped, with what it measured so far", async () => {
    const t = setup();
    t.run(["One.", "Two.", "Three."]);
    await flush();
    t.advance(500);
    t.jobs[0].resolve(audio(1));
    await flush(40);
    t.start(0);
    t.engine.stop();
    t.engine.stop();
    expect(t.events.filter((e) => e.type === "run-finished")).toEqual([
      { type: "run-finished", outcome: "stopped", synthesized: 1, cached: 0, underruns: 0, rtf: 0.5, firstAudioMs: 500 },
    ]);
  });

  it("reports a read replaced by another as stopped", async () => {
    const t = setup();
    t.run(["One.", "Two."]);
    await flush();
    t.run(["Two."], { from: 0 });
    expect(t.events).toContainEqual(expect.objectContaining({ type: "run-finished", outcome: "stopped", synthesized: 0 }));
  });

  it("reports a read that played to its end as completed, once", async () => {
    const t = setup();
    t.run(["One."]);
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush(40);
    t.start(0);
    t.end(0);
    t.engine.stop();
    expect(t.events.filter((e) => e.type === "run-finished")).toEqual([
      expect.objectContaining({ outcome: "completed", synthesized: 1 }),
    ]);
  });
});

describe("kokoro engine: measuring speed", () => {
  it("times only the making of speech, not reading the model into memory", async () => {
    const t = setup({ loadTakesMs: 10_000 });
    t.run(["One."]);
    await flush();
    t.advance(500);
    t.jobs[0].resolve(audio(1));
    await flush(40);
    t.start(0);
    t.end(0);
    expect(t.events).toContainEqual(expect.objectContaining({ type: "run-finished", outcome: "completed", rtf: 0.5 }));
  });
});

describe("kokoro engine: giving up", () => {
  it("hands over at the failed sentence once the earlier ones have played", async () => {
    const t = setup();
    t.run(["One.", "Two.", "Three."]);
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush();
    t.jobs[1].reject(new Error("native crash"));
    await flush(40);
    expect(t.log.errors).toEqual([]);
    t.start(0);
    t.end(0);
    expect(t.log.errors).toEqual([{ reason: "failed", index: 1 }]);
    expect(t.log.done).toBe(0);
    expect(t.events).toContainEqual({ type: "gave-up", reason: "failed", why: "synthesis" });
  });

  it("hands over at once when the model fails to load", async () => {
    const t = setup({ loadFails: true });
    t.run(["One.", "Two."], { from: 1 });
    await flush(40);
    expect(t.log.errors).toEqual([{ reason: "failed", index: 1 }]);
    expect(t.events).toContainEqual({ type: "gave-up", reason: "failed", why: "load" });
    expect(t.events).toContainEqual(expect.objectContaining({ type: "run-finished", outcome: "fallback" }));
  });

  it("hands over when the output reports an error", async () => {
    const t = setup();
    t.run(["One.", "Two."]);
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush(40);
    t.fail();
    expect(t.log.errors).toEqual([{ reason: "failed", index: 1 }]);
  });

  it("gives up as too slow when three sentences in a row take longer to make than to play", async () => {
    const t = setup();
    t.run(["One.", "Two.", "Three.", "Four.", "Five."]);
    for (let i = 0; i < 3; i++) {
      await flush();
      t.advance(3000); // three seconds to make one second of speech
      t.jobs[i].resolve(audio(1));
      await flush(40);
      if (i === 0) t.start(0);
    }
    expect(t.events).toContainEqual({ type: "gave-up", reason: "too-slow", why: "rtf" });
    // The third slow sentence is not queued; the reader takes over there once what is queued has played.
    expect(t.queued).toEqual([0, 1]);
    expect(t.log.errors).toEqual([]);
    t.end(0);
    t.start(1);
    t.end(1);
    expect(t.log.errors).toEqual([{ reason: "too-slow", index: 2 }]);
  });

  it("does not give up while synthesis keeps ahead of playback", async () => {
    const t = setup();
    t.run(["One.", "Two.", "Three.", "Four."]);
    for (let i = 0; i < 3; i++) {
      await flush();
      t.advance(400); // under half real time
      t.jobs[i].resolve(audio(1));
      await flush(40);
      if (i === 0) t.start(0);
    }
    expect(t.events.some((e) => e.type === "gave-up")).toBe(false);
  });

  it("gives up as too slow after repeated stalls, once the sentence that finally arrived has played", async () => {
    const t = setup({ options: { stallMs: 1000, maxStalls: 2 } });
    t.run(["One.", "Two.", "Three.", "Four.", "Five."]);
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush(40);
    t.start(0);
    t.end(0); // playback ran dry: sentence two is not ready
    expect(t.log.buffering.at(-1)).toBe(true);
    await flush();
    t.advance(1500);
    t.jobs[1].resolve(audio(1)); // stall one: the queue was dry for 1.5s
    await flush(40);
    expect(t.queued).toEqual([0, 1]);
    t.start(1);
    t.end(1); // dry again
    await flush();
    t.advance(1500);
    t.jobs[2].resolve(audio(1)); // stall two
    await flush(40);
    expect(t.events).toContainEqual({ type: "gave-up", reason: "too-slow", why: "underruns" });
    expect(t.queued).toEqual([0, 1, 2]);
    t.start(2);
    t.end(2);
    expect(t.log.errors).toEqual([{ reason: "too-slow", index: 3 }]);
  });

  it("forgives a single short pause", async () => {
    const t = setup({ options: { stallMs: 1000, maxStalls: 2 } });
    t.run(["One.", "Two.", "Three."]);
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush(40);
    t.start(0);
    t.end(0);
    await flush();
    t.advance(300);
    t.jobs[1].resolve(audio(1));
    await flush(40);
    expect(t.events.some((e) => e.type === "gave-up")).toBe(false);
    expect(t.queued).toEqual([0, 1]);
  });

  it("gives up when the first sentence takes far too long to start", async () => {
    const t = setup({ options: { firstAudioLimitMs: 10_000 } });
    t.run(["One.", "Two."]);
    await flush();
    t.advance(20_000);
    t.jobs[0].resolve(audio(1));
    await flush(40);
    expect(t.log.errors).toEqual([{ reason: "too-slow", index: 0 }]);
    expect(t.queued).toEqual([]);
  });

  it("ends the read rather than reporting an error when the failed sentence was past the last one", async () => {
    const t = setup();
    t.run(["One."]);
    await flush();
    t.jobs[0].resolve(audio(1));
    await flush(40);
    t.start(0);
    t.end(0);
    expect(t.log.done).toBe(1);
    expect(t.log.errors).toEqual([]);
  });
});

describe("kokoro engine: memory", () => {
  it("frees the model after it has been idle for a while, and loads it again for the next read", async () => {
    const t = setup();
    t.run(["One."]);
    await flush();
    expect(t.runtime.loads).toBe(1);
    t.jobs[0].resolve(audio(1));
    await flush(40);
    t.start(0);
    t.end(0);
    const timer = t.scheduled.at(-1)!;
    expect(timer.ms).toBe(45_000);
    timer.fn();
    await flush();
    expect(t.runtime.releases).toBe(1);

    t.run(["Two."]);
    await flush();
    expect(t.runtime.loads).toBe(2);
  });

  it("keeps the model while a read is paused and resumed", async () => {
    const t = setup();
    t.run(["One.", "Two."]);
    await flush();
    t.engine.stop(); // a pause
    const timer = t.scheduled.at(-1)!;
    t.run(["One.", "Two."]);
    expect(timer.cleared).toBe(true);
  });

  it("frees the model at once on dispose", async () => {
    const t = setup();
    t.run(["One."]);
    await flush();
    t.jobs[0].resolve(audio(1)); // the model is never freed mid-sentence
    await t.engine.dispose();
    expect(t.runtime.releases).toBe(1);
    expect(t.output.closes).toBeGreaterThan(0);
  });
});
