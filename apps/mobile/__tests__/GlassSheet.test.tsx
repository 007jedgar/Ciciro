import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GlassSheet } from "../components/GlassSheet";

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function wrap(ui: ReactNode) {
  return <SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>;
}

describe("GlassSheet", () => {
  it("closes when the backdrop behind it is tapped", () => {
    const onClose = jest.fn();
    const { unmount } = render(
      wrap(
        <GlassSheet visible onClose={onClose} title="Theme">
          <Text>Ash</Text>
        </GlassSheet>
      )
    );
    fireEvent.press(screen.getByTestId("glass-sheet-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  /**
   * The sheet lives in a Modal, which covers the whole screen whether or not
   * anything is drawn in it. Waiting on the exit animation to unmount it left
   * roughly a second where taps meant for the screen below went into an
   * invisible sheet — three or four presses before a row would respond.
   */
  it("stops taking touches the moment it starts closing", () => {
    const { rerender, unmount } = render(
      wrap(
        <GlassSheet visible onClose={jest.fn()} title="Theme">
          <Text>Ash</Text>
        </GlassSheet>
      )
    );
    // The open path waits for the sheet to measure itself before it slides.
    fireEvent(screen.getByTestId("glass-sheet-measure"), "layout", {
      nativeEvent: { layout: { height: 240, width: 390, x: 0, y: 0 } },
    });
    expect(screen.getByTestId("glass-sheet").props.pointerEvents).toBe("auto");

    rerender(
      wrap(
        <GlassSheet visible={false} onClose={jest.fn()} title="Theme">
          <Text>Ash</Text>
        </GlassSheet>
      )
    );
    expect(screen.getByTestId("glass-sheet").props.pointerEvents).toBe("none");
    unmount();
  });

  /**
   * Auto sheets used to measure inside a 42% stub, so Theme clipped Candle
   * and Formatting never showed its last row. Measure in a full-height pane,
   * then shrink to the body.
   */
  it("grows to the measured body instead of stopping at a short stub", () => {
    const { unmount } = render(
      wrap(
        <GlassSheet visible onClose={jest.fn()} title="Theme">
          <Text>Parchment</Text>
          <Text>Sage</Text>
          <Text>Ember</Text>
          <Text>Walnut</Text>
          <Text>Inkwell</Text>
          <Text>Candle</Text>
        </GlassSheet>
      )
    );
    const before = StyleSheet.flatten(screen.getByTestId("glass-sheet-card").props.style);
    fireEvent(screen.getByTestId("glass-sheet-measure"), "layout", {
      nativeEvent: { layout: { height: 400, width: 390, x: 0, y: 0 } },
    });
    const after = StyleSheet.flatten(screen.getByTestId("glass-sheet-card").props.style);
    expect(before.height).toBeGreaterThan(400);
    expect(after.height).toBe(458);
    expect(after.height).toBeLessThan(before.height);
    unmount();
  });

  /**
   * A sheet with fixed snap heights holds a scrolling list (open questions,
   * suggestions). Its body used to hug its content like an auto sheet's, so a
   * flex: 1 ScrollView inside had no height and the sheet opened blank.
   */
  it("lets a fixed-height sheet's body fill the card and an auto sheet's hug its content", () => {
    const fixed = render(
      wrap(
        <GlassSheet visible onClose={jest.fn()} title="Questions" snapPoints={[0.62, 0.92]}>
          <Text>List</Text>
        </GlassSheet>
      )
    );
    expect(StyleSheet.flatten(screen.getByTestId("glass-sheet-measure").props.style)).toMatchObject({ flex: 1 });
    fixed.unmount();

    const auto = render(
      wrap(
        <GlassSheet visible onClose={jest.fn()} title="Theme">
          <Text>Ash</Text>
        </GlassSheet>
      )
    );
    expect(StyleSheet.flatten(screen.getByTestId("glass-sheet-measure").props.style)).toMatchObject({
      flexGrow: 0,
      flexShrink: 0,
    });
    auto.unmount();
  });

  /**
   * React Native 0.86 dropped `StyleSheet.absoluteFillObject`. Spreading it
   * left the backdrop with a background colour and no geometry, so it covered
   * nothing, tinted nothing, and swallowed no taps.
   */
  it("gives the backdrop real geometry, so it can be seen and tapped", () => {
    const { unmount } = render(
      wrap(
        <GlassSheet visible onClose={jest.fn()} title="Theme">
          <Text>Ash</Text>
        </GlassSheet>
      )
    );
    const scrim = StyleSheet.flatten(screen.getByTestId("glass-sheet-scrim").props.style);
    expect(scrim).toMatchObject({ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 });
    expect(scrim.backgroundColor).toBeTruthy();
    unmount();
  });
});
