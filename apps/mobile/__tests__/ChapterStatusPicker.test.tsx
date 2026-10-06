import { fireEvent, render, screen } from "@testing-library/react-native";
import { ChapterStatusPicker } from "../components/ChapterStatusPicker";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

describe("ChapterStatusPicker", () => {
  it("marks only the current status as selected", () => {
    render(<ChapterStatusPicker status="revised" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Revised" })).toHaveProp(
      "accessibilityState",
      expect.objectContaining({ selected: true })
    );
    for (const name of ["Draft", "Final"]) {
      expect(screen.getByRole("button", { name })).toHaveProp(
        "accessibilityState",
        expect.objectContaining({ selected: false })
      );
    }
  });

  it("changes status on another chip and moves the selection when the parent updates", () => {
    const onChange = jest.fn();
    const { rerender } = render(<ChapterStatusPicker status="draft" onChange={onChange} />);
    fireEvent.press(screen.getByRole("button", { name: "Final" }));
    expect(onChange).toHaveBeenCalledWith("final");
    rerender(<ChapterStatusPicker status="final" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Final" })).toHaveProp(
      "accessibilityState",
      expect.objectContaining({ selected: true })
    );
    expect(screen.getByRole("button", { name: "Draft" })).toHaveProp(
      "accessibilityState",
      expect.objectContaining({ selected: false })
    );
  });

  it("ignores a tap on the current status or while disabled", () => {
    const onChange = jest.fn();
    const { rerender } = render(<ChapterStatusPicker status="draft" onChange={onChange} />);
    fireEvent.press(screen.getByRole("button", { name: "Draft" }));
    rerender(<ChapterStatusPicker status="draft" onChange={onChange} disabled />);
    fireEvent.press(screen.getByRole("button", { name: "Revised" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
