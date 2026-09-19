import { fireEvent, render, screen } from "@testing-library/react-native";
import { FormatBubble } from "../components/FormatBubble";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

describe("FormatBubble", () => {
  it("toggles a mark from the highlight chip", () => {
    const onToggleMark = jest.fn();
    render(
      <FormatBubble
        marks={{ bold: true, italic: false, underline: false, strike: false }}
        onToggleMark={onToggleMark}
      />
    );
    expect(screen.getByTestId("format-bubble")).toBeTruthy();
    fireEvent(screen.getByLabelText("Italic"), "pressIn");
    expect(onToggleMark).toHaveBeenCalledWith("italic");
  });
});
