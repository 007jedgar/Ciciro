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
      />
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
});
