import {
  CLEAR_TIMING,
  clearSchedule,
  collapseProgress,
  offersUndo,
  showsMark,
  showsThread,
} from "../lib/chat-clear";

describe("clearSchedule", () => {
  it("runs collapse, absorb, offer, then lets go — in that order", () => {
    const steps = clearSchedule();
    expect(steps.map((step) => step.phase)).toEqual([
      "collapsing",
      "absorbed",
      "offered",
      "idle",
    ]);
    const times = steps.map((step) => step.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBe(0);
  });

  it("plays the mark's hop before the thread has finished arriving", () => {
    expect(CLEAR_TIMING.hopAtMs).toBeLessThan(CLEAR_TIMING.collapseMs);
  });

  it("holds Undo open for several seconds, not a blink", () => {
    const steps = clearSchedule();
    const offered = steps.find((step) => step.phase === "offered")!.at;
    const gone = steps.find((step) => step.phase === "idle")!.at;
    expect(gone - offered).toBe(CLEAR_TIMING.offerMs);
    expect(CLEAR_TIMING.offerMs).toBeGreaterThanOrEqual(5_000);
  });
});

describe("what is on screen at each phase", () => {
  it("shows the thread until it has been absorbed", () => {
    expect(showsThread("idle")).toBe(true);
    expect(showsThread("collapsing")).toBe(true);
    expect(showsThread("absorbed")).toBe(false);
    expect(showsThread("offered")).toBe(false);
  });

  it("shows the mark only while it is catching the thread", () => {
    expect(showsMark("idle")).toBe(false);
    expect(showsMark("collapsing")).toBe(true);
    expect(showsMark("absorbed")).toBe(true);
    // By the time Undo is offered the page is empty and the mark has gone.
    expect(showsMark("offered")).toBe(false);
  });
});

describe("offersUndo", () => {
  it("waits for the page to settle before offering", () => {
    expect(offersUndo("collapsing", "2026-09-14T00:00:00.000Z")).toBe(false);
    expect(offersUndo("absorbed", "2026-09-14T00:00:00.000Z")).toBe(false);
    expect(offersUndo("offered", "2026-09-14T00:00:00.000Z")).toBe(true);
  });

  it("stays quiet when there is nothing to restore", () => {
    // An empty chat archives nothing, so the server hands back no stamp.
    expect(offersUndo("offered", null)).toBe(false);
  });
});

describe("collapseProgress", () => {
  it("runs 0 to 1 over the collapse and clamps outside it", () => {
    expect(collapseProgress(0)).toBe(0);
    expect(collapseProgress(CLEAR_TIMING.collapseMs / 2)).toBeCloseTo(0.5);
    expect(collapseProgress(CLEAR_TIMING.collapseMs)).toBe(1);
    expect(collapseProgress(CLEAR_TIMING.collapseMs * 3)).toBe(1);
    expect(collapseProgress(-100)).toBe(0);
  });
});
