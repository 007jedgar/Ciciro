import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { GrammarPopup } from "../components/GrammarPopup";
import { GRAMMAR_AUTO_ACCEPT_MS } from "../lib/grammar";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

describe("GrammarPopup", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows a determinate auto-accept meter and fills it over 3s", () => {
    let clock = 1_000;
    const { unmount } = render(
      <GrammarPopup
        original="Their"
        replacement="They're"
        shownAt={1_000}
        now={() => clock}
        onAccept={jest.fn()}
        onIgnore={jest.fn()}
      />
    );
    expect(screen.getByTestId("grammar-auto-accept")).toHaveProp("accessibilityValue", {
      min: 0,
      max: 100,
      now: 0,
    });
    clock = 1_000 + GRAMMAR_AUTO_ACCEPT_MS / 2;
    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(screen.getByTestId("grammar-auto-accept")).toHaveProp("accessibilityValue", {
      min: 0,
      max: 100,
      now: 50,
    });
    unmount();
  });

  it("does not auto-accept from the popup when Ignore is pressed", () => {
    const onAccept = jest.fn();
    const onIgnore = jest.fn();
    const { unmount } = render(
      <GrammarPopup
        original="Their"
        replacement="They're"
        shownAt={Date.now()}
        onAccept={onAccept}
        onIgnore={onIgnore}
      />
    );
    fireEvent.press(screen.getByTestId("grammar-ignore"));
    expect(onIgnore).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(GRAMMAR_AUTO_ACCEPT_MS);
    });
    expect(onAccept).not.toHaveBeenCalled();
    unmount();
  });

  it("still shows a determinate meter when reduceMotion is on", () => {
    let clock = 1_000;
    const { unmount } = render(
      <GrammarPopup
        original="Their"
        replacement="They're"
        shownAt={1_000}
        now={() => clock}
        reduceMotion
        onAccept={jest.fn()}
        onIgnore={jest.fn()}
      />
    );
    expect(screen.getByTestId("grammar-auto-accept")).toBeTruthy();
    clock = 1_250;
    act(() => {
      jest.advanceTimersByTime(250);
    });
    expect(screen.getByTestId("grammar-auto-accept").props.accessibilityValue.now).toBeGreaterThan(0);
    unmount();
  });
});
