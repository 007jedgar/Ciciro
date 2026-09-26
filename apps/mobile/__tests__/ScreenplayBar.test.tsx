import { fireEvent, render, screen } from "@testing-library/react-native";
import { ScreenplayBar } from "../components/ScreenplayBar";

describe("ScreenplayBar", () => {
  it("marks the current element and sets another on tap", () => {
    const onSetElement = jest.fn();
    render(<ScreenplayBar element="character" onSetElement={onSetElement} />);
    expect(screen.getByLabelText("Character").props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByLabelText("Dialogue"));
    expect(onSetElement).toHaveBeenCalledWith("dialogue");
  });

  it("steps to the next element like Tab", () => {
    const onSetElement = jest.fn();
    render(<ScreenplayBar element="dialogue" onSetElement={onSetElement} />);
    fireEvent.press(screen.getByLabelText("Next element"));
    expect(onSetElement).toHaveBeenCalledWith("parenthetical");
  });

  it("does nothing while the editor is not focused", () => {
    const onSetElement = jest.fn();
    render(<ScreenplayBar element="action" disabled onSetElement={onSetElement} />);
    fireEvent.press(screen.getByLabelText("Character"));
    expect(onSetElement).not.toHaveBeenCalled();
  });
});
