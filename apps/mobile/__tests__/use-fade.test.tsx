import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { useFade } from "../lib/use-fade";

function Probe({ on, enabled = true }: { on: boolean; enabled?: boolean }) {
  const level = useFade(on ? 1 : 0, 150, enabled);
  return <Text testID="level">{level.toFixed(2)}</Text>;
}

describe("useFade", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("eases toward the target over the duration and settles there", () => {
    const { rerender } = render(<Probe on={false} />);
    expect(screen.getByTestId("level").props.children).toBe("0.00");
    rerender(<Probe on />);
    act(() => {
      jest.advanceTimersByTime(75);
    });
    const mid = Number(screen.getByTestId("level").props.children);
    expect(mid).toBeGreaterThan(0.1);
    expect(mid).toBeLessThan(0.95);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(screen.getByTestId("level").props.children).toBe("1.00");
  });

  it("jumps straight to the target when motion is off", () => {
    const { rerender } = render(<Probe on={false} enabled={false} />);
    rerender(<Probe on enabled={false} />);
    expect(screen.getByTestId("level").props.children).toBe("1.00");
  });
});
