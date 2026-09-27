import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { accentPressedColor, PressableCard } from "../components/PressableCard";
import { contrastRatio } from "../lib/color";
import { THEME_PALETTES } from "../lib/theme";

describe("PressableCard", () => {
  it("is a button that forwards presses and press events", () => {
    const onPress = jest.fn();
    const onPressIn = jest.fn();
    render(
      <PressableCard accessibilityRole="button" accessibilityLabel="Open" onPress={onPress} onPressIn={onPressIn}>
        <Text>Open</Text>
      </PressableCard>
    );
    fireEvent(screen.getByRole("button"), "pressIn");
    fireEvent.press(screen.getByRole("button"));
    expect(onPressIn).toHaveBeenCalled();
    expect(onPress).toHaveBeenCalled();
  });

  it("renders an accent card outside SettingsProvider", () => {
    const onPress = jest.fn();
    render(
      <PressableCard accessibilityRole="button" accent onPress={onPress}>
        <Text>New note</Text>
      </PressableCard>
    );
    fireEvent.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalled();
  });

  it("does not fire when disabled", () => {
    const onPress = jest.fn();
    render(
      <PressableCard accessibilityRole="button" disabled onPress={onPress}>
        <Text>Open</Text>
      </PressableCard>
    );
    fireEvent.press(screen.getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it.each(Object.entries(THEME_PALETTES))(
    "keeps the accent label readable while pressed in %s",
    (_id, palette) => {
      const pressed = accentPressedColor(palette.accent, palette.ink);
      const rest = contrastRatio(palette.panel, palette.accent);
      expect(contrastRatio(palette.panel, pressed)).toBeGreaterThanOrEqual(rest);
      // The old target, accentSoft, dropped the label below 2:1 in the light themes.
      expect(contrastRatio(palette.panel, pressed)).toBeGreaterThan(contrastRatio(palette.panel, palette.accentSoft));
    }
  );
});
