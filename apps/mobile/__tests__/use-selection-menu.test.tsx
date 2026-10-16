import { act, renderHook } from "@testing-library/react-native";
import { getSelectionDock, setSelectionDock } from "../lib/selection-dock";
import type { GestureResponderEvent } from "react-native";
import { SELECTION_SETTLE_MS, TOUCH_GUARD_MS, useSelectionMenu } from "../lib/use-selection-menu";

const mockLookup = jest.fn();
jest.mock("../lib/synonyms-lookup", () => ({ lookupSynonyms: (context: unknown) => mockLookup(context) }));
jest.mock("../lib/analytics-client", () => ({ getAnalytics: () => ({ track: jest.fn() }) }));
jest.mock("../lib/announce", () => ({ announce: jest.fn() }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const TEXT = "She opened the letter slowly and read every word twice.";

function setup(initial: { focused?: boolean } = {}) {
  const onAction = jest.fn();
  const view = renderHook(
    ({ focused }: { focused: boolean }) =>
      useSelectionMenu({
        chapterId: "c1",
        focused,
        getText: () => TEXT,
        replaceWord: async () => true,
        onAction,
      }),
    { initialProps: { focused: initial.focused ?? true } }
  );
  return { ...view, onAction };
}

const select = (view: ReturnType<typeof setup>, start: number, end: number) =>
  act(() => view.result.current.onChangeSelection(start, end));
const touches = (count: number) =>
  ({ nativeEvent: { touches: new Array(count).fill({}) } }) as unknown as GestureResponderEvent;
const touchStart = (view: ReturnType<typeof setup>) => act(() => view.result.current.onTouchStart(touches(1)));
const touchEnd = (view: ReturnType<typeof setup>, remaining = 0) =>
  act(() => view.result.current.onTouchEnd(touches(remaining)));

/** Moves the clock and lets whatever it set off (a synonym lookup resolving) land inside `act`. */
const wait = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });

describe("useSelectionMenu settle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLookup.mockReset();
    mockLookup.mockResolvedValue(["unhurriedly", "leisurely"]);
    act(() => setSelectionDock(null));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("holds off long enough to outlast a double-tap and a writer's pause between handle moves", async () => {
    // The old 220ms opened the strip between two moves of a handle.
    expect(SELECTION_SETTLE_MS).toBeGreaterThanOrEqual(400);
  });

  it("opens only once the selection has held still", async () => {
    const view = setup();
    select(view, 4, 10);
    await wait(SELECTION_SETTLE_MS - 1);
    expect(getSelectionDock()).toBeNull();
    await wait(1);
    expect(getSelectionDock()?.target).toBe("word");
  });

  it("does not open while a handle is still being dragged, however long the drag", async () => {
    const view = setup();
    // The selection grows every 150ms for three seconds: a pause that short never lets it settle.
    for (let end = 10; end < 40; end += 1) {
      select(view, 4, end);
      await wait(150);
      expect(getSelectionDock()).toBeNull();
    }
    await wait(SELECTION_SETTLE_MS);
    const dock = getSelectionDock();
    expect(dock?.target).toBe("passage");
    expect(dock?.word).toBe(TEXT.slice(4, 39));
  });

  it("closes the moment the selection moves again, and reopens after it settles", async () => {
    const view = setup();
    select(view, 4, 10);
    await wait(SELECTION_SETTLE_MS);
    expect(getSelectionDock()?.target).toBe("word");
    select(view, 4, 22);
    expect(getSelectionDock()).toBeNull();
    await wait(SELECTION_SETTLE_MS);
    expect(getSelectionDock()?.target).toBe("passage");
  });

  it("offers nothing for a caret, and closes when the selection collapses", async () => {
    const view = setup();
    select(view, 4, 10);
    await wait(SELECTION_SETTLE_MS);
    select(view, 7, 7);
    await wait(SELECTION_SETTLE_MS * 2);
    expect(getSelectionDock()).toBeNull();
  });

  it("closes when the editor loses focus and never opens without it", async () => {
    const view = setup();
    select(view, 4, 10);
    await wait(SELECTION_SETTLE_MS);
    expect(getSelectionDock()).not.toBeNull();
    view.rerender({ focused: false });
    expect(getSelectionDock()).toBeNull();
    select(view, 4, 10);
    await wait(SELECTION_SETTLE_MS * 2);
    expect(getSelectionDock()).toBeNull();
  });

  it("shows a word's synonyms once the lookup lands", async () => {
    let release: (list: string[]) => void = () => {};
    mockLookup.mockReturnValue(new Promise<string[]>((resolve) => (release = resolve)));
    const view = setup();
    select(view, 4, 10);
    await wait(SELECTION_SETTLE_MS);
    expect(getSelectionDock()?.synonyms.status).toBe("loading");
    await act(async () => {
      release(["unhurriedly", "leisurely"]);
      await Promise.resolve();
    });
    expect(getSelectionDock()?.synonyms).toEqual({ status: "ready", list: ["unhurriedly", "leisurely"] });
  });

  it("clears the strip when the screen goes away", async () => {
    const view = setup();
    select(view, 4, 10);
    await wait(SELECTION_SETTLE_MS);
    view.unmount();
    expect(getSelectionDock()).toBeNull();
  });

  describe("with a finger on the page", () => {
    // On iOS the editor reports nothing while a handle is dragged; the selection arrives once, at the lift.
    it("closes the strip the moment a finger lands, and keeps it closed however long the finger stays", async () => {
      const view = setup();
      select(view, 4, 10);
      await wait(SELECTION_SETTLE_MS);
      expect(getSelectionDock()).not.toBeNull();
      touchStart(view);
      expect(getSelectionDock()).toBeNull();
      await wait(SELECTION_SETTLE_MS * 4);
      expect(getSelectionDock()).toBeNull();
    });

    it("opens it for the selection the drag ended on, a settle after the finger lifts", async () => {
      const view = setup();
      select(view, 4, 10);
      await wait(SELECTION_SETTLE_MS);
      touchStart(view);
      await wait(2000);
      // The selection grows by one report, at the lift.
      select(view, 4, 39);
      touchEnd(view);
      await wait(SELECTION_SETTLE_MS - 1);
      expect(getSelectionDock()).toBeNull();
      await wait(1);
      expect(getSelectionDock()?.target).toBe("passage");
      expect(getSelectionDock()?.word).toBe(TEXT.slice(4, 39));
    });

    it("does not open for a selection reported while the finger is still down", async () => {
      const view = setup();
      touchStart(view);
      select(view, 4, 10);
      await wait(SELECTION_SETTLE_MS * 2);
      expect(getSelectionDock()).toBeNull();
      touchEnd(view);
      await wait(SELECTION_SETTLE_MS);
      expect(getSelectionDock()?.target).toBe("word");
    });

    it("waits for the last finger of several", async () => {
      const view = setup();
      select(view, 4, 10);
      touchStart(view);
      touchEnd(view, 1);
      await wait(SELECTION_SETTLE_MS * 2);
      expect(getSelectionDock()).toBeNull();
      touchEnd(view, 0);
      await wait(SELECTION_SETTLE_MS);
      expect(getSelectionDock()).not.toBeNull();
    });

    it("counts a touch that never ends as lifted after a while, so the strip cannot be held off for good", async () => {
      const view = setup();
      select(view, 4, 10);
      touchStart(view);
      await wait(TOUCH_GUARD_MS - 1);
      expect(getSelectionDock()).toBeNull();
      await wait(1);
      await wait(SELECTION_SETTLE_MS);
      expect(getSelectionDock()).not.toBeNull();
    });

    it("offers nothing for a tap that leaves a caret", async () => {
      const view = setup();
      select(view, 4, 10);
      await wait(SELECTION_SETTLE_MS);
      touchStart(view);
      select(view, 7, 7);
      touchEnd(view);
      await wait(SELECTION_SETTLE_MS * 2);
      expect(getSelectionDock()).toBeNull();
    });
  });
});
