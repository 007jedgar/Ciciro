import {
  clampRate,
  getReadAloudSelection,
  readAloudSentences,
  SentenceReader,
  setReadAloudSelection,
  splitSentences,
  type SpeechEngine,
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
  it("ignores a collapsed caret", () => {
    setReadAloudSelection({ chapterId: "c", start: 3, end: 9 });
    expect(getReadAloudSelection()).toEqual({ chapterId: "c", start: 3, end: 9 });
    setReadAloudSelection({ chapterId: "c", start: 4, end: 4 });
    expect(getReadAloudSelection()).toBeNull();
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
