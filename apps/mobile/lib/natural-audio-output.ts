/**
 * The natural voice's speaker: react-native-audio-api behind the engine's
 * `AudioOutput`, plus the lock-screen controls and the short voice samples.
 *
 * Sentences are enqueued on one native buffer queue, which plays them back to
 * back on the audio thread (no JS timers between them, so no gap) and keeps
 * running silently if it drains, picking up whatever is enqueued next. That is
 * why a slow sentence is a pause, not a restart.
 *
 * The package's config plugin adds the iOS `audio` background mode and the
 * Android media foreground service; `nowPlaying` shows the lock-screen /
 * notification card whose Play, Pause and Stop come back as commands. On
 * Android 13+ that card is a notification, so it appears only when the author
 * has already allowed notifications (the writing reminders ask for it): Listen
 * never puts up a permission prompt of its own the moment Play is pressed.
 */
import { Platform } from "react-native";
import type { AudioOutput, OutputEvents } from "./kokoro-engine";

export type RemoteCommand = "play" | "pause" | "stop";
export type NowPlayingInfo = { title: string; artist?: string };

type Subscription = { remove(): void } | undefined;

/** The slice of react-native-audio-api this module uses. */
export type AudioApiLike = {
  AudioContext: new (options?: { sampleRate?: number }) => ContextLike;
  AudioManager: {
    setAudioSessionOptions(options: { iosCategory?: string; iosMode?: string; iosOptions?: string[] }): void;
    setAudioSessionActivity(enabled: boolean): Promise<void>;
    checkNotificationPermissions?(): Promise<unknown>;
  };
  PlaybackNotificationManager: {
    show(info: { title?: string; artist?: string; state?: "playing" | "paused" }): Promise<void>;
    hide(): Promise<void>;
    enableControl(control: "play" | "pause" | "stop", enabled: boolean): Promise<void>;
    addEventListener(name: string, callback: () => void): Subscription;
  };
};

type BufferLike = unknown;
type QueueNodeLike = {
  connect(destination: unknown): unknown;
  disconnect(): void;
  enqueueBuffer(buffer: BufferLike): string;
  clearBuffers(): void;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
  onBufferEnded: ((event: { bufferId: string; isLastBufferInQueue: boolean }) => void) | null;
};
type SourceNodeLike = {
  buffer: BufferLike;
  connect(destination: unknown): unknown;
  disconnect(): void;
  start(when?: number): void;
  stop(when?: number): void;
  onEnded: ((event: unknown) => void) | null;
};
type ContextLike = {
  destination: unknown;
  createBuffer(channels: number, length: number, sampleRate: number): {
    copyToChannel(source: Float32Array, channel: number): void;
  };
  createBufferQueueSource(): QueueNodeLike;
  createBufferSource(): SourceNodeLike;
  decodeAudioData(input: number | string | ArrayBuffer): Promise<BufferLike>;
  resume(): Promise<void>;
  suspend(): Promise<void>;
};

export type NaturalAudioOutput = AudioOutput & {
  nowPlaying: {
    show(info: NowPlayingInfo, state: "playing" | "paused"): void;
    /** Takes the card down and lets the phone's other audio have the speaker back. */
    hide(): void;
    onCommand(handler: (command: RemoteCommand) => void): () => void;
  };
  /** Plays a short bundled clip (a voice sample). `stop` ends it early; `done` resolves either way. */
  playClip(source: number | string): { done: Promise<void>; stop(): void };
};

const SAMPLE_RATE = 24000;

export function createAudioApiOutput(
  api: AudioApiLike,
  options: { cardNeedsNotificationPermission?: boolean } = {}
): NaturalAudioOutput {
  let context: ContextLike | null = null;
  let node: QueueNodeLike | null = null;
  let events: OutputEvents | null = null;
  /** Tags in the order they were enqueued and have not yet ended. */
  let pending: number[] = [];
  const idByTag = new Map<number, string>();
  const tagById = new Map<string, number>();
  let playing = false;
  let sessionReady = false;
  const handlers = new Set<(command: RemoteCommand) => void>();
  let subscriptions: Subscription[] = [];
  let cardShown = false;
  /** Between `show` and `hide`: the card is wanted, so a permission check that resolves late may still raise it. */
  let cardWanted = false;
  /** Clips between `playClip` and their end; the speaker is handed back only when none is left. */
  let clipsActive = 0;

  const getContext = () => (context ??= new api.AudioContext({ sampleRate: SAMPLE_RATE }));

  const prepareSession = () => {
    if (sessionReady) return;
    sessionReady = true;
    try {
      // Spoken word: it takes the speaker from music and is allowed to play on in the background.
      api.AudioManager.setAudioSessionOptions({ iosCategory: "playback", iosMode: "spokenAudio", iosOptions: [] });
      void api.AudioManager.setAudioSessionActivity(true).catch(() => {});
    } catch {
      /* an older dev client without the call: playback still works */
    }
  };

  const teardownNode = () => {
    const current = node;
    node = null;
    if (!current) return;
    current.onBufferEnded = null;
    try {
      current.stop();
      current.clearBuffers();
      current.disconnect();
    } catch {
      /* already released */
    }
  };

  const handleEnded = (event: { bufferId: string }) => {
    const tag = tagById.get(event.bufferId);
    if (tag === undefined || !events) return;
    tagById.delete(event.bufferId);
    idByTag.delete(tag);
    pending = pending.filter((t) => t !== tag);
    const sink = events;
    sink.onEnded(tag);
    if (pending.length > 0) sink.onStarted(pending[0]);
    else playing = false;
  };

  return {
    open(sink) {
      teardownNode();
      pending = [];
      idByTag.clear();
      tagById.clear();
      playing = false;
      events = sink;
      prepareSession();
      try {
        const ctx = getContext();
        void ctx.resume().catch(() => {});
        node = ctx.createBufferQueueSource();
        node.connect(ctx.destination);
        node.onBufferEnded = handleEnded;
        // An explicit offset: the library's own default (-1) fails its own range check on a queue source.
        node.start(0, 0);
      } catch {
        node = null;
        sink.onError("audio");
      }
    },
    enqueue(tag, samples, sampleRate) {
      if (!node || !events) return;
      try {
        const ctx = getContext();
        const buffer = ctx.createBuffer(1, samples.length, sampleRate);
        buffer.copyToChannel(samples, 0);
        const id = node.enqueueBuffer(buffer);
        idByTag.set(tag, id);
        tagById.set(id, tag);
        pending.push(tag);
        if (!playing) {
          playing = true;
          events.onStarted(tag);
        }
      } catch {
        events.onError("audio");
      }
    },
    close() {
      events = null;
      pending = [];
      idByTag.clear();
      tagById.clear();
      playing = false;
      teardownNode();
      void context?.suspend().catch(() => {});
    },
    nowPlaying: {
      show(info, state) {
        cardWanted = true;
        const raise = () => {
          if (!cardWanted) return;
          if (!cardShown) {
            cardShown = true;
            const manager = api.PlaybackNotificationManager;
            const emit = (command: RemoteCommand) => () => handlers.forEach((h) => h(command));
            subscriptions = [
              manager.addEventListener("playbackNotificationPlay", emit("play")),
              manager.addEventListener("playbackNotificationPause", emit("pause")),
              manager.addEventListener("playbackNotificationStop", emit("stop")),
            ];
            for (const control of ["play", "pause", "stop"] as const) {
              void manager.enableControl(control, true).catch(() => {});
            }
          }
          void api.PlaybackNotificationManager.show({ title: info.title, artist: info.artist, state }).catch(() => {});
        };
        if (!options.cardNeedsNotificationPermission) return raise();
        void Promise.resolve(api.AudioManager.checkNotificationPermissions?.())
          .then((status) => {
            if (status === "Granted") raise();
          })
          .catch(() => {});
      },
      hide() {
        cardWanted = false;
        if (!cardShown) return;
        cardShown = false;
        for (const s of subscriptions) s?.remove();
        subscriptions = [];
        void api.PlaybackNotificationManager.hide().catch(() => {});
        void api.AudioManager.setAudioSessionActivity(false).catch(() => {});
        sessionReady = false;
      },
      onCommand(handler) {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
    },
    playClip(source) {
      let stopClip = () => {};
      // Counted here, before any await: stopping one sample and starting the next in the same tick must
      // not let the first one's cleanup suspend the context under the second.
      clipsActive++;
      const done = (async () => {
        try {
          const ctx = getContext();
          prepareSession();
          await ctx.resume().catch(() => {});
          const buffer = await ctx.decodeAudioData(source);
          await new Promise<void>((resolve) => {
            const clip = ctx.createBufferSource();
            clip.buffer = buffer;
            clip.connect(ctx.destination);
            let finished = false;
            const end = () => {
              if (finished) return;
              finished = true;
              try {
                clip.onEnded = null;
                clip.disconnect();
              } catch {
                /* already released */
              }
              resolve();
            };
            clip.onEnded = end;
            stopClip = () => {
              try {
                clip.stop();
              } catch {
                /* not started */
              }
              end();
            };
            clip.start();
          });
        } finally {
          clipsActive--;
          // Nothing else is playing: give the speaker back.
          if (clipsActive === 0 && !playing) void getContext().suspend().catch(() => {});
        }
      })().catch(() => {});
      return { done, stop: () => stopClip() };
    },
  };
}

let shared: NaturalAudioOutput | null = null;

/** The one speaker the app uses for natural voices, or null where the native module is missing. */
export function getNaturalAudioOutput(): NaturalAudioOutput | null {
  if (shared) return shared;
  try {
    const api = require("react-native-audio-api") as AudioApiLike;
    if (!api.AudioContext) return null;
    shared = createAudioApiOutput(api, { cardNeedsNotificationPermission: Platform.OS === "android" });
    return shared;
  } catch {
    return null;
  }
}
