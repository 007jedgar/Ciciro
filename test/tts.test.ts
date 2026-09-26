import { beforeEach, describe, expect, it, vi } from "vitest";
import { clampRate, splitSentences, SpeechReader, type UtteranceLike } from "@/lib/tts";

function texts(input: string) {
  return splitSentences(input).map((r) => input.slice(r.start, r.end));
}

describe("splitSentences", () => {
  it("splits on terminators and keeps closing quotes", () => {
    expect(texts('She ran. "Stop!" he cried. Why?')).toEqual(['She ran.', '"Stop!" he cried.', "Why?"]);
  });

  it("does not split on common abbreviations or decimals", () => {
    expect(texts("Dr. Lee met Mr. Park at 3.5 miles. Then left.")).toEqual([
      "Dr. Lee met Mr. Park at 3.5 miles.",
      "Then left.",
    ]);
  });

  it("keeps a trailing fragment and skips blanks", () => {
    expect(texts("One.  \n Two without end")).toEqual(["One.", "Two without end"]);
    expect(splitSentences("   ")).toEqual([]);
  });

  it("returns offsets into the original text", () => {
    const [a, b] = splitSentences("Hi there. Bye.");
    expect([a.start, a.end, b.start, b.end]).toEqual([0, 9, 10, 14]);
  });
});

describe("clampRate", () => {
  it("bounds and defaults", () => {
    expect(clampRate(9)).toBe(2);
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate("x")).toBe(1);
    expect(clampRate(1.25)).toBe(1.25);
  });
});

describe("SpeechReader", () => {
  let spoken: UtteranceLike[];
  let synth: { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> };
  let events: Array<[string, number]>;
  let reader: SpeechReader;

  beforeEach(() => {
    spoken = [];
    events = [];
    synth = {
      speak: vi.fn((u: UtteranceLike) => spoken.push(u)),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    };
    reader = new SpeechReader(
      synth,
      (text) => ({ text, rate: 1, voice: null, onend: null, onerror: null }),
      (state, index) => events.push([state, index])
    );
  });

  const last = () => spoken[spoken.length - 1];

  it("reads sentences in order and returns to idle", () => {
    reader.start(["A.", "B."], { rate: 1.5, voice: "v" });
    expect(last().text).toBe("A.");
    expect(last().rate).toBe(1.5);
    expect(last().voice).toBe("v");
    last().onend!();
    expect(last().text).toBe("B.");
    expect(reader.current).toEqual({ state: "playing", index: 1 });
    last().onend!();
    expect(reader.current.state).toBe("idle");
  });

  it("pauses, resumes the same sentence, and stops", () => {
    reader.start(["A.", "B."]);
    last().onend!();
    reader.pause();
    expect(synth.pause).toHaveBeenCalled();
    expect(reader.current.state).toBe("paused");
    reader.resume();
    expect(last().text).toBe("B.");
    expect(reader.current.state).toBe("playing");
    reader.stop();
    expect(reader.current).toEqual({ state: "idle", index: 0 });
  });

  it("ignores stale end events after stop", () => {
    reader.start(["A.", "B."]);
    const first = last();
    reader.stop();
    first.onend!();
    expect(spoken).toHaveLength(1);
  });

  it("restarts the current sentence when speed or voice changes", () => {
    reader.start(["A.", "B."]);
    reader.setRate(2);
    expect(spoken).toHaveLength(2);
    expect(last().text).toBe("A.");
    expect(last().rate).toBe(2);
    reader.setVoice("x");
    expect(last().voice).toBe("x");
  });

  it("goes idle on a real error but not on our own cancel", () => {
    reader.start(["A."]);
    last().onerror!({ error: "canceled" });
    expect(reader.current.state).toBe("playing");
    last().onerror!({ error: "synthesis-failed" });
    expect(reader.current.state).toBe("idle");
  });

  it("does nothing for empty input", () => {
    reader.start(["  ", ""]);
    expect(reader.current.state).toBe("idle");
    expect(synth.speak).not.toHaveBeenCalled();
  });
});
