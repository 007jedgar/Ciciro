import {
  clampRate,
  lineYForOffset,
  readAloudScrollTarget,
  readAloudSelectionFor,
  readAloudSentences,
  SentenceReader,
  setReadAloudSelection,
  splitSentences,
  voiceChoices,
  type SpeechEngine,
  type SpeechRun,
} from "../lib/read-aloud";
import { blocksPlainText } from "../lib/read-aloud-text";

describe("splitSentences", () => {
  it("splits on terminators, keeps closers, skips abbreviations", () => {
    const text = 'Dr. Lee ran. "Stop!" he cried. Why?';
    expect(splitSentences(text).map((r) => text.slice(r.start, r.end))).toEqual([
      "Dr. Lee ran.",
      '"Stop!"',
      "he cried.",
      "Why?",
    ]);
  });

  it("ends a Hindi sentence at the danda, so a paragraph is read and highlighted a sentence at a time", () => {
    const text = "सुबह बहुत ठंड थी। घाट पर किसी ने कुछ नहीं कहा। वह खड़ी रही॥";
    expect(splitSentences(text).map((r) => text.slice(r.start, r.end))).toEqual([
      "सुबह बहुत ठंड थी।",
      "घाट पर किसी ने कुछ नहीं कहा।",
      "वह खड़ी रही॥",
    ]);
  });
});

describe("readAloudSentences", () => {
  const plain = "One. Two.\nThree here.";

  it("tracks the line of each sentence", () => {
    expect(readAloudSentences(plain).map((s) => [s.line, s.text])).toEqual([
      [0, "One."],
      [0, "Two."],
      [1, "Three here."],
    ]);
  });

  it("narrows to a selection using plain-text offsets", () => {
    const start = plain.indexOf("Two");
    const out = readAloudSentences(plain, { start, end: plain.length });
    expect(out.map((s) => s.text)).toEqual(["Two.", "Three here."]);
    const partial = readAloudSentences(plain, { start: plain.indexOf("here"), end: plain.length });
    expect(partial.map((s) => s.text)).toEqual(["here."]);
  });

  it("uses the editor's paragraph-joined offsets", () => {
    expect(blocksPlainText("<p>Hi there.</p><p>Bye.</p>")).toBe("Hi there.\nBye.");
  });
});

describe("selection store", () => {
  const plain = "One. Two.\nThree.";

  it("ignores a collapsed caret", () => {
    setReadAloudSelection({ chapterId: "c", start: 5, end: 9, text: "Two." });
    expect(readAloudSelectionFor("c", plain)).toEqual({ start: 5, end: 9 });
    expect(readAloudSelectionFor("other", plain)).toBeNull();
    setReadAloudSelection({ chapterId: "c", start: 4, end: 4, text: "" });
    expect(readAloudSelectionFor("c", plain)).toBeNull();
  });

  it("drops the selection once the chapter text under it changes", () => {
    setReadAloudSelection({ chapterId: "c", start: 5, end: 9, text: "Two." });
    expect(readAloudSelectionFor("c", "Uno. One. Two.\nThree.")).toBeNull();
  });
});

describe("voiceChoices", () => {
  const voice = (identifier: string, language: string, name = identifier, quality?: string) => ({
    identifier,
    name,
    language,
    quality,
  });

  it("puts the device language first, then groups the other languages", () => {
    const voices = [
      voice("zed", "fr-FR"),
      voice("bob", "en-GB"),
      voice("amy", "de-DE"),
      voice("cat", "en-US"),
      voice("eva", "fr-CA"),
      voice("ben", "de-AT"),
    ];
    expect(voiceChoices(voices, "en-US", null).map((v) => v.identifier)).toEqual([
      "bob",
      "cat",
      "amy",
      "ben",
      "eva",
      "zed",
    ]);
  });

  it("lists other languages when none match the device", () => {
    const voices = [voice("zed", "fr-FR"), voice("amy", "de-DE")];
    expect(voiceChoices(voices, "en-US", null).map((v) => v.identifier)).toEqual(["amy", "zed"]);
  });

  it("offers every natural voice without a cap", () => {
    const voices = Array.from({ length: 30 }, (_, i) => voice(`v${i}`, i % 2 ? "fr-FR" : "en-US"));
    expect(voiceChoices(voices, "en-US", null)).toHaveLength(30);
  });

  it("drops sound-effect and robotic voices and ranks by quality", () => {
    const voices = [
      voice("com.apple.speech.synthesis.voice.BadNews", "en-US", "Bad News"),
      voice("com.apple.voice.compact.en-US.Bells", "en-US", "Bells"),
      voice("a", "en-US", "Zoe", "Default"),
      voice("b", "en-US", "Ava", "Enhanced"),
      voice("c", "en-US", "Fred (Enhanced)", "Enhanced"),
      voice("d", "en-US", "Mia", "Premium"),
    ];
    expect(voiceChoices(voices, "en-US", null).map((v) => v.name)).toEqual(["Mia", "Ava", "Zoe"]);
    expect(voiceChoices(voices, "en-US", "com.apple.speech.synthesis.voice.BadNews").map((v) => v.name)).toContain("Bad News");
  });
});

describe("SentenceReader", () => {
  let calls: Array<{ text: string; rate: number; voice?: string; onDone: () => void; onError: () => void }>;
  let engine: SpeechEngine & { stop: jest.Mock };
  let events: Array<[string, number]>;
  let reader: SentenceReader;
  const last = () => calls[calls.length - 1];

  beforeEach(() => {
    calls = [];
    events = [];
    engine = {
      speak: (text, options) => {
        calls.push({ text, ...options });
      },
      stop: jest.fn(),
    };
    reader = new SentenceReader(engine, (state, index) => events.push([state, index]));
  });

  it("reads through and returns to idle", () => {
    reader.start(["A.", "B."], { rate: 1.5, voice: "v" });
    expect(last()).toMatchObject({ text: "A.", rate: 1.5, voice: "v" });
    last().onDone();
    expect(last().text).toBe("B.");
    last().onDone();
    expect(reader.current.state).toBe("idle");
  });

  it("pauses by stopping and resumes the same sentence", () => {
    reader.start(["A.", "B."]);
    last().onDone();
    reader.pause();
    expect(engine.stop).toHaveBeenCalled();
    expect(reader.current).toEqual({ state: "paused", index: 1 });
    reader.resume();
    expect(last().text).toBe("B.");
    expect(reader.current.state).toBe("playing");
  });

  it("ignores stale completion after stop and restarts on speed change", () => {
    reader.start(["A.", "B."]);
    const first = last();
    reader.setRate(2);
    expect(last()).toMatchObject({ text: "A.", rate: 2 });
    first.onDone();
    expect(calls).toHaveLength(2);
    reader.stop();
    last().onDone();
    expect(reader.current).toEqual({ state: "idle", index: 0 });
  });

  it("goes idle on an engine error and clamps rates", () => {
    reader.start(["A."]);
    last().onError();
    expect(reader.current.state).toBe("idle");
    expect(clampRate(10)).toBe(2);
    expect(clampRate("x")).toBe(1);
  });
});

describe("SentenceReader with a read-ahead engine", () => {
  let runs: SpeechRun[];
  let spoken: Array<{ text: string; rate: number; voice?: string; onDone: () => void }>;
  let primary: SpeechEngine & { stop: jest.Mock };
  let fallbackEngine: SpeechEngine & { stop: jest.Mock };
  let events: Array<[string, number]>;
  let notices: Array<{ reason: string; index: number }>;
  let buffering: boolean[];
  let reader: SentenceReader;
  const run = () => runs[runs.length - 1];

  beforeEach(() => {
    runs = [];
    spoken = [];
    events = [];
    notices = [];
    buffering = [];
    primary = { speak: jest.fn(), stop: jest.fn(), playRun: (r) => void runs.push(r) };
    fallbackEngine = {
      speak: (text, options) => void spoken.push({ text, ...options }),
      stop: jest.fn(),
    };
    reader = new SentenceReader(primary, (state, index) => events.push([state, index]), {
      fallback: () => fallbackEngine,
      onFallback: (info) => notices.push(info),
      onBuffering: (b) => buffering.push(b),
    });
  });

  it("hands the whole read to the engine and follows the sentence it reports", () => {
    reader.start(["A.", "B.", "C."], { rate: 1.25, voice: "af_heart", fallbackVoice: "sys" });
    expect(run()).toMatchObject({ texts: ["A.", "B.", "C."], from: 0, rate: 1.25, voice: "af_heart" });
    expect(primary.speak).not.toHaveBeenCalled();
    run().onSentence(0);
    run().onSentence(1);
    expect(reader.current).toEqual({ state: "playing", index: 1 });
    run().onSentence(2);
    run().onDone();
    expect(reader.current).toEqual({ state: "idle", index: 0 });
  });

  it("pauses by stopping the engine and resumes from the sentence it was on", () => {
    reader.start(["A.", "B.", "C."]);
    run().onSentence(1);
    reader.pause();
    expect(primary.stop).toHaveBeenCalled();
    expect(reader.current).toEqual({ state: "paused", index: 1 });
    reader.resume();
    expect(runs).toHaveLength(2);
    expect(run().from).toBe(1);
  });

  it("restarts at the current sentence when the speed or voice changes", () => {
    reader.start(["A.", "B."], { rate: 1, voice: "af_heart" });
    run().onSentence(1);
    reader.setRate(1.5);
    expect(run()).toMatchObject({ from: 1, rate: 1.5, voice: "af_heart" });
    reader.setVoice("bf_emma");
    expect(run()).toMatchObject({ from: 1, voice: "bf_emma" });
  });

  it("ignores callbacks from a run that was stopped or replaced", () => {
    reader.start(["A.", "B."]);
    const first = run();
    reader.stop();
    first.onSentence(1);
    first.onDone();
    first.onError({ reason: "failed", index: 1 });
    expect(reader.current).toEqual({ state: "idle", index: 0 });
    expect(notices).toEqual([]);
    reader.start(["A.", "B."]);
    first.onSentence(1);
    expect(reader.current.index).toBe(0);
  });

  it("passes the engine's buffering through, and clears it when the read halts", () => {
    reader.start(["A."]);
    run().onBuffering?.(true);
    run().onBuffering?.(false);
    reader.pause();
    expect(buffering).toEqual([false, true, false, false]);
  });

  it("carries on with the fallback engine from the sentence the engine gave up at", () => {
    reader.start(["A.", "B.", "C."], { rate: 1.5, voice: "af_heart", fallbackVoice: "sys-voice" });
    run().onSentence(0);
    run().onSentence(1);
    run().onError({ reason: "too-slow", index: 2 });
    expect(primary.stop).toHaveBeenCalled();
    expect(notices).toEqual([{ reason: "too-slow", index: 2 }]);
    expect(reader.usingFallback).toBe(true);
    expect(spoken[0]).toMatchObject({ text: "C.", rate: 1.5, voice: "sys-voice" });
    expect(reader.current).toEqual({ state: "playing", index: 2 });
    spoken[0].onDone();
    expect(reader.current).toEqual({ state: "idle", index: 0 });
  });

  it("keeps using the fallback after a pause and a speed change, then returns to the engine on the next start", () => {
    reader.start(["A.", "B."], { voice: "af_heart", fallbackVoice: "sys" });
    run().onError({ reason: "failed", index: 0 });
    reader.pause();
    reader.resume();
    expect(spoken.at(-1)).toMatchObject({ text: "A.", voice: "sys" });
    reader.setRate(2);
    expect(spoken.at(-1)).toMatchObject({ text: "A.", rate: 2 });
    reader.start(["X."], { voice: "af_heart" });
    expect(reader.usingFallback).toBe(false);
    expect(run().texts).toEqual(["X."]);
  });

  it("ends the read when the engine gives up and there is no fallback, or the fallback itself fails", () => {
    const bare = new SentenceReader(primary, (state, index) => events.push([state, index]));
    bare.start(["A.", "B."]);
    run().onError({ reason: "too-slow", index: 1 });
    expect(bare.current).toEqual({ state: "idle", index: 0 });

    const twice = new SentenceReader(
      { ...primary, playRun: (r) => void runs.push(r) },
      () => {},
      { fallback: () => ({ speak: jest.fn(), stop: jest.fn(), playRun: (r) => void runs.push(r) }) }
    );
    twice.start(["A.", "B."]);
    run().onError({ reason: "failed", index: 0 });
    expect(twice.usingFallback).toBe(true);
    run().onError({ reason: "failed", index: 0 });
    expect(twice.current.state).toBe("idle");
  });
});

describe("read-aloud scroll target", () => {
  const lines = [
    { text: "The river ran high that ", y: 0 },
    { text: "spring, and Marra stood ", y: 30 },
    { text: "at the ford.", y: 60 },
  ];

  it("finds the rendered line a character offset falls on", () => {
    expect(lineYForOffset(lines, 0)).toBe(0);
    expect(lineYForOffset(lines, 23)).toBe(0);
    expect(lineYForOffset(lines, 24)).toBe(30);
    expect(lineYForOffset(lines, 50)).toBe(60);
    expect(lineYForOffset(lines, 500)).toBe(60);
    expect(lineYForOffset([], 3)).toBe(0);
  });

  it("keeps the sentence at 40% of the viewport height and never scrolls above the top", () => {
    expect(readAloudScrollTarget({ bodyY: 100, paragraphY: 900, lineY: 30, viewportHeight: 700 })).toBe(750);
    expect(readAloudScrollTarget({ bodyY: 100, paragraphY: 10, lineY: 0, viewportHeight: 700 })).toBe(0);
  });
});
