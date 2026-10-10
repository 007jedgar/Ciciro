import { act, renderHook } from "@testing-library/react-native";
import {
  HANDOFF,
  finishHandoff,
  handoffClock,
  resetHandoff,
  setWelcomeTargets,
  useHandoffPhase,
  useWelcomeTargets,
  type WelcomeTargets,
} from "../lib/splash-handoff";

const targets = (y = 500): WelcomeTargets => ({
  bars: [
    { x: 50, y, width: 262 },
    { x: 50, y: y + 32, width: 230 },
    { x: 50, y: y + 64, width: 154 },
  ],
  caretTop: y - 9,
  caretHeight: 24,
});

describe("splash hand-off", () => {
  beforeEach(() => resetHandoff(false));

  it("starts hidden and pending on a cold start", () => {
    expect(handoffClock.value).toBe(0);
    const { result } = renderHook(() => useHandoffPhase());
    expect(result.current).toBe("pending");
  });

  it("finishing jumps the clock to the end and says so", () => {
    const { result } = renderHook(() => useHandoffPhase());
    act(() => finishHandoff());
    expect(result.current).toBe("done");
    expect(handoffClock.value).toBe(HANDOFF.totalMs);
  });

  it("holds the card's measured lines and drops them when the card leaves", () => {
    const { result } = renderHook(() => useWelcomeTargets());
    expect(result.current).toBeNull();
    act(() => setWelcomeTargets(targets()));
    expect(result.current?.bars[0].y).toBe(500);
    act(() => setWelcomeTargets(null));
    expect(result.current).toBeNull();
  });

  it("does not notify when a re-measure finds the same lines", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useWelcomeTargets();
    });
    act(() => setWelcomeTargets(targets()));
    const after = renders;
    act(() => setWelcomeTargets(targets()));
    expect(renders).toBe(after);
    act(() => setWelcomeTargets(targets(520)));
    expect(renders).toBeGreaterThan(after);
  });

  it("keeps the sequence's own beats in order", () => {
    expect(HANDOFF.dotStartMs + 2 * HANDOFF.dotStaggerMs + HANDOFF.dotMs).toBeLessThan(HANDOFF.collapseStartMs);
    expect(HANDOFF.bgFadeStartMs + HANDOFF.bgFadeMs).toBeLessThanOrEqual(HANDOFF.riseStartMs + HANDOFF.riseMs);
    expect(HANDOFF.collapseStartMs + 2 * HANDOFF.collapseStaggerMs + HANDOFF.collapseMs).toBeLessThanOrEqual(HANDOFF.totalMs);
  });
});
