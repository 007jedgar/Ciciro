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

  it("offers Shot and steps to it from a transition", () => {
    const onSetElement = jest.fn();
    render(<ScreenplayBar element="transition" onSetElement={onSetElement} />);
    fireEvent.press(screen.getByLabelText("Shot"));
    expect(onSetElement).toHaveBeenCalledWith("shot");
    fireEvent.press(screen.getByLabelText("Next element"));
    expect(onSetElement).toHaveBeenLastCalledWith("shot");
  });

  it("marks the format Beta", () => {
    render(<ScreenplayBar element="action" onSetElement={jest.fn()} />);
    expect(screen.getByTestId("beta-badge")).toBeTruthy();
    expect(screen.getByLabelText("Beta")).toBeTruthy();
  });

  it("marks no element for a line a newer client styled, and Tab steps from action", () => {
    const onSetElement = jest.fn();
    render(<ScreenplayBar element={null} onSetElement={onSetElement} />);
    for (const label of ["Scene heading", "Action", "Character", "Dialogue", "Parenthetical", "Transition", "Shot"]) {
      expect(screen.getByLabelText(label).props.accessibilityState.selected).toBe(false);
    }
    fireEvent.press(screen.getByLabelText("Next element"));
    expect(onSetElement).toHaveBeenCalledWith("character");
  });

  it("does nothing while the editor is not focused", () => {
    const onSetElement = jest.fn();
    render(<ScreenplayBar element="action" disabled onSetElement={onSetElement} />);
    fireEvent.press(screen.getByLabelText("Character"));
    expect(onSetElement).not.toHaveBeenCalled();
  });
});
