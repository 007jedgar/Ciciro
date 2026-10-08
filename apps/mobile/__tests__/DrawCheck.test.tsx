import { renderHook } from "@testing-library/react-native";
import { useDrawProgress } from "../components/DrawCheck";

function firstRenderValue(play: boolean, options?: { drawOnMount?: boolean }) {
  const seen: number[] = [];
  const { result } = renderHook(() => {
    const progress = useDrawProgress(play, 0, options);
    seen.push(progress.value);
    return progress;
  });
  return { first: seen[0], settled: result.current.value };
}

describe("useDrawProgress", () => {
  it("starts complete when already playing on mount, so an earlier goal does not replay", () => {
    expect(firstRenderValue(true)).toEqual({ first: 1, settled: 1 });
  });

  it("draws from empty on mount with drawOnMount", () => {
    expect(firstRenderValue(true, { drawOnMount: true })).toEqual({ first: 0, settled: 1 });
  });

  it("stays empty while not playing", () => {
    expect(firstRenderValue(false, { drawOnMount: true })).toEqual({ first: 0, settled: 0 });
  });
});
