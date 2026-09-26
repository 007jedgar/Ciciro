import { fireEvent, render, screen } from "@testing-library/react-native";
import { FormatBar } from "../components/FormatBar";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

describe("FormatBar", () => {
  it("toggles marks and block type from the rail", () => {
    const onToggleMark = jest.fn();
    const onSetKind = jest.fn();
    const { unmount } = render(
      <FormatBar
        marks={{ bold: true, italic: false, underline: false, strike: false }}
        kind="paragraph"
        onToggleMark={onToggleMark}
        onSetKind={onSetKind}
      />,
    );
    expect(screen.getByLabelText("Bold")).toHaveProp("accessibilityState", {
      selected: true,
      disabled: false,
    });
    fireEvent.press(screen.getByLabelText("Italic"));
    expect(onToggleMark).toHaveBeenCalledWith("italic");
    fireEvent.press(screen.getByLabelText("Heading"));
    expect(onSetKind).toHaveBeenCalledWith("heading");
    unmount();
  });

  it("shows the microphone only when dictation is offered", () => {
    const base = { onToggleMark: jest.fn(), onSetKind: jest.fn() };
    const { rerender } = render(<FormatBar {...base} />);
    expect(screen.queryByLabelText("Dictate")).toBeNull();
    const onToggle = jest.fn();
    rerender(<FormatBar {...base} dictation={{ active: false, onToggle }} />);
    fireEvent.press(screen.getByLabelText("Dictate"));
    expect(onToggle).toHaveBeenCalled();
    rerender(
      <FormatBar {...base} disabled dictation={{ active: true, onToggle }} />,
    );
    expect(screen.getByLabelText("Stop dictating")).toHaveProp(
      "accessibilityState",
      {
        selected: true,
        disabled: false,
      },
    );
  });
});
