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
    // And it has to be visible, or nothing tells the reader it can be tapped.
    expect(scrim.backgroundColor).toBeTruthy();
    unmount();
  });
});
