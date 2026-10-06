import { renderHook } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";
import { useSelectionPop } from "../lib/use-selection-pop";

describe("useSelectionPop", () => {
  let timing: jest.SpyInstance;
  let sequence: jest.SpyInstance;

  beforeEach(() => {
    timing = jest.spyOn(Reanimated, "withTiming");
    sequence = jest.spyOn(Reanimated, "withSequence");
  });

  afterEach(() => {
    timing.mockRestore();
    sequence.mockRestore();
  });

  it("starts at rest without animating on mount", () => {
    const selected = renderHook(() => useSelectionPop(true, false));
    expect(selected.result.current.progress.value).toBe(1);
    expect(selected.result.current.scale.value).toBe(1);
    const unselected = renderHook(() => useSelectionPop(false, false));
    expect(unselected.result.current.progress.value).toBe(0);
    expect(timing).not.toHaveBeenCalled();
    expect(sequence).not.toHaveBeenCalled();
  });

  it("crossfades and pops when a pill becomes selected", () => {
    const { result, rerender } = renderHook(({ active }) => useSelectionPop(active, false), {
      initialProps: { active: false },
    });
    rerender({ active: true });
    expect(result.current.progress.value).toBe(1);
    expect(timing).toHaveBeenCalledWith(1, expect.objectContaining({ duration: 180 }));
    // The pop overshoots, then springs back to rest.
    expect(sequence).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenCalledWith(1.06, expect.anything());
    expect(result.current.scale.value).toBe(1);
  });

  it("crossfades out without a pop when a pill loses selection", () => {
    const { result, rerender } = renderHook(({ active }) => useSelectionPop(active, false), {
      initialProps: { active: true },
    });
    rerender({ active: false });
    expect(result.current.progress.value).toBe(0);
    expect(timing).toHaveBeenCalledWith(0, expect.objectContaining({ duration: 180 }));
    expect(sequence).not.toHaveBeenCalled();
  });

  it("keeps the color crossfade but drops the pop under reduce motion", () => {
    const { result, rerender } = renderHook(({ active }) => useSelectionPop(active, true), {
      initialProps: { active: false },
    });
    rerender({ active: true });
    expect(result.current.progress.value).toBe(1);
    expect(timing).toHaveBeenCalledWith(1, expect.objectContaining({ duration: 180 }));
    expect(sequence).not.toHaveBeenCalled();
  });
});
