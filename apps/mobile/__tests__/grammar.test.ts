import {
  applySpans,
  autoAcceptProgress,
  caretAnchorFromLines,
  caretAfterSpans,
  acceptedCorrection,
  endedOnSentence,
  estimateSpanAnchor,
  GrammarLoop,
  GRAMMAR_AUTO_ACCEPT_MS,
  matchingSpans,
  placeCallout,
  selectPopupSpan,
  shouldRequestCorrect,
  spanAnchorFromLines,
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
    expect(
      acceptedCorrection({
        suggestion: {
          blockId: "b1",
          text: original,
          spans: [span],
        },
        liveText: original,
        caret: 5,
      })
    ).toEqual({ blockId: "b1", nextText: "They're going home.", caret: 7 });
    expect(
      acceptedCorrection({
        suggestion: { blockId: "b1", text: original, spans: [span] },
        liveText: "There going home.",
        caret: 5,
      })
    ).toBeNull();
  });

  it("pins a callout to the line that still holds the span", () => {
    const lines = [
      { x: 0, y: 0, width: 200, height: 22, text: "Hello " },
      { x: 0, y: 24, width: 180, height: 22, text: "Their going." },
    ];
    const anchor = spanAnchorFromLines(lines, 6, 11);
    expect(anchor).toMatchObject({ y: 24, height: 22 });
    expect(anchor && anchor.x).toBe(0);
    const placed = placeCallout({
      anchor: anchor!,
      popup: { width: 160, height: 80 },
      blockWidth: 200,
    });
    expect(placed.top).toBe(24 + 22 + 6);
    expect(placed.left).toBe(0);
    expect(
      placeCallout({
        anchor: { x: 10, y: 120, width: 40, height: 22 },
        popup: { width: 160, height: 80 },
        blockWidth: 200,
      })
    ).toEqual({ top: 120 - 80 - 6, left: 10 });
    expect(estimateSpanAnchor({
      text: "Their going.",
      start: 0,
      end: 5,
      width: 200,
      fontSize: 16,
      lineHeight: 24,
    }).y).toBe(0);
    expect(autoAcceptProgress(0, GRAMMAR_AUTO_ACCEPT_MS, 1500)).toBe(0.5);
  });

  it("places a caret at a collapsed offset on the painted line", () => {
    const lines = [{ x: 0, y: 0, width: 200, height: 28, text: "Hello world." }];
    expect(caretAnchorFromLines(lines, 0)).toEqual({ x: 0, y: 0, height: 28 });
    expect(caretAnchorFromLines(lines, 12)).toEqual({ x: 200, y: 0, height: 28 });
    expect(caretAnchorFromLines([], 0)).toBeNull();
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
      shownAt: Date.now(),
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

  it("auto-accepts after 3s unless ignored or the span went stale", async () => {
    const onAutoAccept = jest.fn();
    const loop = new GrammarLoop(
      async () => ({ spans: [{ start: 0, end: 5, replacement: "They're" }] }),
      jest.fn(),
      800,
      onAutoAccept
    );
    loop.onKeystroke({
      chapterId: "c1",
      blockId: "b1",
      text: "Their going.",
      revision: 2,
      autoCorrect: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(loop.suggestion?.spans).toHaveLength(1);

    jest.advanceTimersByTime(GRAMMAR_AUTO_ACCEPT_MS - 1);
    expect(onAutoAccept).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onAutoAccept).toHaveBeenCalledTimes(1);
    loop.dispose();

    const cancelled = jest.fn();
    const stale = new GrammarLoop(
      async () => ({ spans: [{ start: 0, end: 5, replacement: "They're" }] }),
      jest.fn(),
      800,
      cancelled
    );
    stale.onKeystroke({
      chapterId: "c1",
      blockId: "b1",
      text: "Their going.",
      revision: 2,
      autoCorrect: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    stale.onKeystroke({
      chapterId: "c1",
      blockId: "b1",
      text: "There going.",
      revision: 2,
      autoCorrect: true,
    });
    expect(stale.suggestion).toBeNull();
    jest.advanceTimersByTime(GRAMMAR_AUTO_ACCEPT_MS);
    expect(cancelled).not.toHaveBeenCalled();
    stale.dispose();

    const ignored = jest.fn();
    const ignoreLoop = new GrammarLoop(
      async () => ({ spans: [{ start: 0, end: 5, replacement: "They're" }] }),
      jest.fn(),
      800,
      ignored
    );
    ignoreLoop.onKeystroke({
      chapterId: "c1",
      blockId: "b1",
      text: "Their going.",
      revision: 2,
      autoCorrect: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    ignoreLoop.setSuggestion(null);
    jest.advanceTimersByTime(GRAMMAR_AUTO_ACCEPT_MS);
    expect(ignored).not.toHaveBeenCalled();
    ignoreLoop.dispose();
  });
});
