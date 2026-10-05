import { fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { Text } from "react-native";
import { TapPressable } from "../components/TapPressable";
import { PressableCard } from "../components/PressableCard";
import { setHapticsEnabled } from "../lib/haptics";

jest.mock("../lib/prefs", () => {
  const disk = new Map<string, string>();
  return {
    getPrefs: () => ({
      getString: (key: string) => disk.get(key),
      set: (key: string, value: string) => void disk.set(key, value),
    }),
  };
});

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

describe("press taps", () => {
  beforeEach(() => {
    setHapticsEnabled(true);
    jest.clearAllMocks();
  });

  it.each([
    ["TapPressable", TapPressable],
    ["PressableCard", PressableCard],
  ])("%s gives a light tap and still calls onPress", (_name, Button) => {
    const onPress = jest.fn();
    render(
      <Button onPress={onPress} accessibilityRole="button" accessibilityLabel="Go">
        <Text>Go</Text>
      </Button>
    );
    fireEvent.press(screen.getByLabelText("Go"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith("light");
  });

  it("stays silent with haptics off", () => {
    setHapticsEnabled(false);
    const onPress = jest.fn();
    render(
      <TapPressable onPress={onPress} accessibilityLabel="Go">
        <Text>Go</Text>
      </TapPressable>
    );
    fireEvent.press(screen.getByLabelText("Go"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });
});
