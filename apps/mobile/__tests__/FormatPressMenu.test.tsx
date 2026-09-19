import { fireEvent, render, screen } from "@testing-library/react-native";
import { FormatPressMenu } from "../components/FormatPressMenu";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

describe("FormatPressMenu", () => {
  it("sets heading from a long-press chip and can return to a paragraph", () => {
    const onSetKind = jest.fn();
    render(<FormatPressMenu kind="paragraph" onSetKind={onSetKind} />);
    expect(screen.getByTestId("format-press")).toBeTruthy();
    fireEvent(screen.getByLabelText("Heading"), "pressIn");
    expect(onSetKind).toHaveBeenCalledWith("heading");
    fireEvent(screen.getByLabelText("Paragraph"), "pressIn");
    expect(onSetKind).toHaveBeenCalledWith("paragraph");
  });
});
