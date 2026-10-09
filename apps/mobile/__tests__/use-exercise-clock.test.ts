import { act, renderHook } from "@testing-library/react-native";
import { useExerciseClock } from "../lib/use-exercise-clock";

let mockReduceMotion = false;
jest.mock("../lib/use-reduce-motion", () => ({ useReduceMotion: () => mockReduceMotion }));

describe("useExerciseClock", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockReduceMotion = false;
  });
  afterEach(() => jest.useRealTimers());

  it("keeps counting when Reduce Motion changes mid-part", () => {
    const { result, rerender } = renderHook(() => useExerciseClock(true, 60_000));
    act(() => jest.advanceTimersByTime(20_000));
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(19_750);

    mockReduceMotion = true;
    rerender({});
    act(() => jest.advanceTimersByTime(1_000));
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(20_750);
    expect(result.current.progress.value).toBeCloseTo(result.current.elapsedMs / 60_000, 5);
  });

  it("holds at the total and calls onDone once, without stopping anything", () => {
    const onDone = jest.fn();
    const { result } = renderHook(() => useExerciseClock(true, 1_000, onDone));
    act(() => jest.advanceTimersByTime(5_000));
    expect(result.current.elapsedMs).toBe(1_000);
    expect(result.current.done).toBe(true);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
