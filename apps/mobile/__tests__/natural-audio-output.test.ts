import { createAudioApiOutput, type AudioApiLike, type RemoteCommand } from "../lib/natural-audio-output";
import type { OutputEvents } from "../lib/kokoro-engine";

/** A stand-in for react-native-audio-api that records what the output does to it. */
function fakeApi(notifications: string = "Granted") {
  const calls: string[] = [];
  const listeners = new Map<string, () => void>();
  let queue!: {
    ended: ((e: { bufferId: string; isLastBufferInQueue: boolean }) => void) | null;
    enqueued: unknown[];
    stopped: boolean;
    cleared: boolean;
  };
  let clipEnd: (() => void) | null = null;
  let nextId = 1;
  const api: AudioApiLike = {
    AudioContext: class {
      destination = {};
      createBuffer(channels: number, length: number, sampleRate: number) {
        calls.push(`buffer ${channels}x${length}@${sampleRate}`);
        return { copyToChannel: () => calls.push("copy") };
      }
      createBufferQueueSource() {
        queue = { ended: null, enqueued: [], stopped: false, cleared: false };
        return {
          connect: () => calls.push("connect"),
          disconnect: () => calls.push("disconnect"),
          enqueueBuffer(b: unknown) {
            queue.enqueued.push(b);
            return String(nextId++);
          },
          clearBuffers: () => (queue.cleared = true),
          // react-native-audio-api's own check: its default offset of -1 is rejected, so an explicit one is needed.
          start: (when = 0, offset = -1) => {
            if (when < 0) throw new RangeError(`when must be a finite non-negative number: ${when}`);
            if (offset && offset < 0) throw new RangeError(`offset must be a finite non-negative number: ${offset}`);
            calls.push("start");
          },
          stop: () => (queue.stopped = true),
          get onBufferEnded() {
            return queue.ended;
          },
          set onBufferEnded(fn) {
            queue.ended = fn;
          },
        };
      }
      createBufferSource() {
        const node = {
          buffer: null as unknown,
          connect: () => {},
          disconnect: () => {},
          start: () => calls.push("clip start"),
          stop: () => calls.push("clip stop"),
          onEnded: null as null | ((e: unknown) => void),
        };
        clipEnd = () => node.onEnded?.({});
        return node;
      }
      async decodeAudioData(input: unknown) {
        calls.push(`decode ${String(input)}`);
        return {};
      }
      async resume() {
        calls.push("resume");
      }
      async suspend() {
        calls.push("suspend");
      }
    },
    AudioManager: {
      setAudioSessionOptions: (o) => calls.push(`session ${o.iosCategory}/${o.iosMode}`),
      setAudioSessionActivity: async (on) => void calls.push(`activity ${on}`),
      checkNotificationPermissions: async () => {
        calls.push("check notifications");
        return notifications;
      },
      // Listen must never ask: a test that reaches this fails.
      requestNotificationPermissions: async () => {
        calls.push("REQUESTED notifications");
        return notifications;
      },
    },
    PlaybackNotificationManager: {
      show: async (info) => void calls.push(`card ${info.title} ${info.state}`),
      hide: async () => void calls.push("card hidden"),
      enableControl: async (c) => void calls.push(`control ${c}`),
      addEventListener: (name, cb) => {
        listeners.set(name, cb);
        return { remove: () => listeners.delete(name) };
      },
    },
  };
  return {
    api,
    calls,
    listeners,
    endBuffer: (bufferId: string, isLast = false) => queue.ended?.({ bufferId, isLastBufferInQueue: isLast }),
    endClip: () => clipEnd?.(),
    queue: () => queue,
  };
}

function sink() {
  const log: string[] = [];
  const events: OutputEvents = {
    onStarted: (t) => log.push(`started ${t}`),
    onEnded: (t) => log.push(`ended ${t}`),
    onError: (m) => log.push(`error ${m}`),
  };
  return { events, log };
}

const samples = new Float32Array(240);

describe("audio api output", () => {
  it("opens a session for spoken audio and starts one queue", () => {
    const f = fakeApi();
    createAudioApiOutput(f.api).open(sink().events);
    expect(f.calls).toEqual(expect.arrayContaining(["session playback/spokenAudio", "activity true", "resume", "connect", "start"]));
  });

  it("starts its queue without raising the library's offset error", () => {
    const f = fakeApi();
    const s = sink();
    createAudioApiOutput(f.api).open(s.events);
    expect(s.log).toEqual([]);
    expect(f.calls).toContain("start");
  });

  it("starts the first sentence at once and each next one when the one before it ends", () => {
    const f = fakeApi();
    const { events, log } = sink();
    const out = createAudioApiOutput(f.api);
    out.open(events);
    out.enqueue(0, samples, 24000);
    out.enqueue(1, samples, 24000);
    out.enqueue(2, samples, 24000);
    expect(log).toEqual(["started 0"]);
    f.endBuffer("1");
    f.endBuffer("2");
    f.endBuffer("3", true);
    expect(log).toEqual(["started 0", "ended 0", "started 1", "ended 1", "started 2", "ended 2"]);
  });

  it("starts a sentence enqueued after the queue ran dry as soon as it arrives", () => {
    const f = fakeApi();
    const { events, log } = sink();
    const out = createAudioApiOutput(f.api);
    out.open(events);
    out.enqueue(0, samples, 24000);
    f.endBuffer("1", true);
    out.enqueue(1, samples, 24000);
    expect(log).toEqual(["started 0", "ended 0", "started 1"]);
  });

  it("creates the buffer at the sentence's own sample rate", () => {
    const f = fakeApi();
    const out = createAudioApiOutput(f.api);
    out.open(sink().events);
    out.enqueue(0, samples, 22050);
    expect(f.calls).toContain("buffer 1x240@22050");
  });

  it("stops the queue, drops what is left, and ignores late events after close", () => {
    const f = fakeApi();
    const { events, log } = sink();
    const out = createAudioApiOutput(f.api);
    out.open(events);
    out.enqueue(0, samples, 24000);
    const queue = f.queue();
    out.close();
    expect(queue.stopped).toBe(true);
    expect(queue.cleared).toBe(true);
    expect(f.calls).toContain("suspend");
    log.length = 0;
    f.endBuffer("1", true);
    out.enqueue(1, samples, 24000);
    expect(log).toEqual([]);
  });

  it("reports an error when the native queue cannot be created", () => {
    const f = fakeApi();
    f.api.AudioContext = class {
      constructor() {
        throw new Error("no audio");
      }
    } as unknown as AudioApiLike["AudioContext"];
    const { events, log } = sink();
    createAudioApiOutput(f.api).open(events);
    expect(log).toEqual(["error audio"]);
  });
});

describe("audio api output: the lock-screen card", () => {
  it("shows the card with Play, Pause and Stop and passes their presses on", () => {
    const f = fakeApi();
    const out = createAudioApiOutput(f.api);
    const commands: RemoteCommand[] = [];
    const off = out.nowPlaying.onCommand((c) => commands.push(c));
    out.nowPlaying.show({ title: "Chapter 3", artist: "My Novel" }, "playing");
    expect(f.calls).toEqual(expect.arrayContaining(["control play", "control pause", "control stop", "card Chapter 3 playing"]));
    f.listeners.get("playbackNotificationPause")?.();
    f.listeners.get("playbackNotificationPlay")?.();
    f.listeners.get("playbackNotificationStop")?.();
    expect(commands).toEqual(["pause", "play", "stop"]);
    off();
    f.listeners.get("playbackNotificationPause")?.();
    expect(commands).toHaveLength(3);
  });

  it("updates the card in place and hides it, giving the speaker back", () => {
    const f = fakeApi();
    const out = createAudioApiOutput(f.api);
    out.nowPlaying.show({ title: "T" }, "playing");
    out.nowPlaying.show({ title: "T" }, "paused");
    expect(f.calls.filter((c) => c === "control play")).toHaveLength(1);
    expect(f.calls).toContain("card T paused");
    out.nowPlaying.hide();
    expect(f.calls).toEqual(expect.arrayContaining(["card hidden", "activity false"]));
    expect(f.listeners.size).toBe(0);
    out.nowPlaying.hide();
    expect(f.calls.filter((c) => c === "card hidden")).toHaveLength(1);
  });
});

describe("audio api output: giving the speaker back without a card", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("gives the speaker back when Listen ends on a phone that never raised the card (Android, no notifications)", async () => {
    const f = fakeApi("Denied");
    const out = createAudioApiOutput(f.api, { cardNeedsNotificationPermission: true });
    out.open(sink().events);
    out.nowPlaying.show({ title: "T" }, "playing");
    await flush();
    out.close();
    out.nowPlaying.hide();
    expect(f.calls).not.toContain("card hidden");
    expect(f.calls.filter((c) => c === "activity false")).toHaveLength(1);
    out.nowPlaying.hide();
    expect(f.calls.filter((c) => c === "activity false")).toHaveLength(1);
  });

  it("gives the speaker back once a voice sample is over", async () => {
    const f = fakeApi();
    const out = createAudioApiOutput(f.api);
    const clip = out.playClip(7);
    await flush();
    expect(f.calls).toContain("activity true");
    expect(f.calls).not.toContain("activity false");
    f.endClip();
    await clip.done;
    expect(f.calls).toContain("activity false");
  });

  it("keeps the session for a chapter being read while a sample ends", async () => {
    const f = fakeApi();
    const out = createAudioApiOutput(f.api);
    out.open(sink().events);
    const clip = out.playClip(7);
    await flush();
    f.endClip();
    await clip.done;
    expect(f.calls).not.toContain("activity false");
  });
});

describe("audio api output: the lock-screen card needs notification permission (Android)", () => {
  const androidOutput = (f: ReturnType<typeof fakeApi>) =>
    createAudioApiOutput(f.api, { cardNeedsNotificationPermission: true });
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("raises the card when notifications are already allowed", async () => {
    const f = fakeApi("Granted");
    androidOutput(f).nowPlaying.show({ title: "T" }, "playing");
    await flush();
    expect(f.calls).toContain("card T playing");
  });

  it.each(["Denied", "Undetermined"])("shows nothing and never asks when notifications are %s", async (status) => {
    const f = fakeApi(status);
    const out = androidOutput(f);
    out.nowPlaying.show({ title: "T" }, "playing");
    await flush();
    expect(f.calls).toContain("check notifications");
    expect(f.calls.some((c) => c.startsWith("card ") || c.startsWith("control "))).toBe(false);
    expect(f.calls).not.toContain("REQUESTED notifications");
  });

  it("does not raise a card that was hidden while the permission was being checked", async () => {
    const f = fakeApi("Granted");
    const out = androidOutput(f);
    out.nowPlaying.show({ title: "T" }, "playing");
    out.nowPlaying.hide();
    await flush();
    expect(f.calls.some((c) => c.startsWith("card "))).toBe(false);
  });

  it("does not look at permissions where the card is not a notification (iOS)", () => {
    const f = fakeApi("Denied");
    createAudioApiOutput(f.api).nowPlaying.show({ title: "T" }, "playing");
    expect(f.calls).toContain("card T playing");
    expect(f.calls).not.toContain("check notifications");
  });
});

describe("audio api output: voice samples", () => {
  it("decodes a clip, plays it, and resolves when it ends", async () => {
    const f = fakeApi();
    const out = createAudioApiOutput(f.api);
    const clip = out.playClip(7);
    let resolved = false;
    void clip.done.then(() => (resolved = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls).toEqual(expect.arrayContaining(["decode 7", "clip start"]));
    expect(resolved).toBe(false);
    f.endClip();
    await clip.done;
    expect(resolved).toBe(true);
  });

  it("stops a clip early and still resolves", async () => {
    const f = fakeApi();
    const out = createAudioApiOutput(f.api);
    const clip = out.playClip(7);
    await new Promise((r) => setTimeout(r, 0));
    clip.stop();
    await clip.done;
    expect(f.calls).toContain("clip stop");
  });

  it("does not suspend the speaker under a second sample started as the first one is stopped", async () => {
    const f = fakeApi();
    const out = createAudioApiOutput(f.api);
    const first = out.playClip(1);
    await new Promise((r) => setTimeout(r, 0));
    // The writer taps another voice: the first is stopped and the next begins in the same tick.
    first.stop();
    const second = out.playClip(2);
    await first.done;
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls).not.toContain("suspend");
    f.endClip();
    await second.done;
    expect(f.calls.filter((c) => c === "suspend")).toHaveLength(1);
  });

  it("gives the speaker back once the last sample is over, but not while the chapter is being read", async () => {
    const f = fakeApi();
    const out = createAudioApiOutput(f.api);
    out.open({ onStarted: () => {}, onEnded: () => {}, onError: () => {} });
    out.enqueue(1, new Float32Array(10), 24000);
    f.calls.length = 0;
    const clip = out.playClip(3);
    await new Promise((r) => setTimeout(r, 0));
    f.endClip();
    await clip.done;
    expect(f.calls).not.toContain("suspend");
  });

  it("resolves quietly when the clip cannot be decoded", async () => {
    const f = fakeApi();
    const ctxProto = f.api.AudioContext.prototype as { decodeAudioData: () => Promise<unknown> };
    ctxProto.decodeAudioData = async () => {
      throw new Error("bad file");
    };
    await expect(createAudioApiOutput(f.api).playClip(7).done).resolves.toBeUndefined();
  });
});
