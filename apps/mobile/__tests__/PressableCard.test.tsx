import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { PressableCard } from "../components/PressableCard";

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
});
