import {
  applySpans,
  caretAfterSpans,
  endedOnSentence,
  GrammarLoop,
  matchingSpans,
  selectPopupSpan,
  shouldRequestCorrect,
} from "../lib/grammar";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("grammar helpers", () => {
  it("detects sentence terminators", () => {
    expect(endedOnSentence("Their going.")).toBe(true);
    expect(endedOnSentence('Wait!"')).toBe(true);
    expect(endedOnSentence("好。")).toBe(true);
    expect(endedOnSentence("Their going")).toBe(false);
  });

  it("does not request when autoCorrect is off or the block is composing", () => {
    expect(shouldRequestCorrect({ autoCorrect: false, composing: false, text: "Their going." })).toBe(
      false
    );
    expect(shouldRequestCorrect({ autoCorrect: true, composing: true, text: "Their going." })).toBe(
      false
    );
    expect(shouldRequestCorrect({ autoCorrect: true, composing: false, text: "  " })).toBe(false);
    expect(shouldRequestCorrect({ autoCorrect: true, composing: false, text: "Their going." })).toBe(
      true
    );
  });

  it("drops a correction span when the user kept typing through it", () => {
    const original = "Their going home.";
    const span = { start: 0, end: 5, replacement: "They're" };
    expect(matchingSpans(original, original, [span])).toEqual([span]);
    expect(matchingSpans("There going home.", original, [span])).toEqual([]);
    expect(matchingSpans("Their going home now.", original, [span])).toEqual([span]);
    expect(applySpans(original, [span])).toBe("They're going home.");
    expect(caretAfterSpans(5, [span])).toBe(7);
    expect(selectPopupSpan("There going home.", original, [span])).toBeNull();
  });
});

describe("GrammarLoop", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("is a no-op when autoCorrect is off", () => {
    const request = jest.fn();
    const loop = new GrammarLoop(request, jest.fn());
    loop.onKeystroke({
      chapterId: "c1",
      blockId: "b1",
      text: "Their going.",
      revision: 2,
      autoCorrect: false,
    });
    jest.advanceTimersByTime(1000);
    expect(request).not.toHaveBeenCalled();
    expect(loop.suggestion).toBeNull();
    loop.dispose();
  });

  it("drops a shown span after the focused block keeps typing", async () => {
    const notify = jest.fn();
    const loop = new GrammarLoop(async () => ({ spans: [{ start: 0, end: 5, replacement: "They're" }] }), notify);
    loop.onKeystroke({
      chapterId: "c1",
      blockId: "b1",
      text: "Their going.",
      revision: 2,
      autoCorrect: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(loop.suggestion?.spans).toEqual([{ start: 0, end: 5, replacement: "They're" }]);

    loop.onKeystroke({
      chapterId: "c1",
      blockId: "b1",
      text: "There going.",
      revision: 2,
      autoCorrect: true,
    });
    expect(loop.suggestion).toBeNull();
    expect(notify).toHaveBeenLastCalledWith(null);
    loop.dispose();
  });

  it("keeps a span on another block and aborts an in-flight request after a keystroke", async () => {
    const first = deferred<{ spans: { start: number; end: number; replacement: string }[] }>();
    const request = jest.fn(() => {
      if (request.mock.calls.length === 1) return first.promise;
      return Promise.resolve({ spans: [] });
    });
    const loop = new GrammarLoop(request, jest.fn());
    loop.onKeystroke({
      chapterId: "c1",
      blockId: "b1",
      text: "Their going.",
      revision: 2,
      autoCorrect: true,
    });
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    loop.onKeystroke({
      chapterId: "c1",
      blockId: "b1",
      text: "Their going home.",
      revision: 2,
      autoCorrect: true,
    });
    expect(request.mock.calls[0][0].signal.aborted).toBe(true);

    first.resolve({ spans: [{ start: 0, end: 5, replacement: "They're" }] });
    await Promise.resolve();
    await Promise.resolve();
    expect(loop.suggestion).toBeNull();

    loop.setSuggestion({
      chapterId: "c1",
      blockId: "b1",
      text: "Their going.",
      spans: [{ start: 0, end: 5, replacement: "They're" }],
    });
    loop.onKeystroke({
      chapterId: "c1",
      blockId: "b2",
      text: "Next paragraph",
      revision: 2,
      autoCorrect: true,
    });
    expect(loop.suggestion?.blockId).toBe("b1");
    expect(loop.acceptableSpans("b1", "Their going.")).toHaveLength(1);
    loop.dispose();
  });
});
