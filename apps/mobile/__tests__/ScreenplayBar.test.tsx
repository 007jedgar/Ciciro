import { fireEvent, render, screen } from "@testing-library/react-native";
import { ScrollView } from "react-native";
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
    for (const label of ["Scene heading", "Action", "Character", "Dialogue", "Parenthetical", "Transition", "Shot", "Centered"]) {
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

  it("offers centered text", () => {
    const onSetElement = jest.fn();
    render(<ScreenplayBar element="action" onSetElement={onSetElement} />);
    fireEvent.press(screen.getByLabelText("Centered"));
    expect(onSetElement).toHaveBeenCalledWith("centered");
  });

  describe("dual dialogue", () => {
    it("is not offered by a bar that has no way to set it", () => {
      render(<ScreenplayBar element="character" onSetElement={jest.fn()} />);
      expect(screen.queryByLabelText("Dual")).toBeNull();
    });

    it("is grayed out away from a speech that can pair", () => {
      const onToggleDual = jest.fn();
      render(<ScreenplayBar element="action" dual={null} onSetElement={jest.fn()} onToggleDual={onToggleDual} />);
      expect(screen.getByLabelText("Dual").props.accessibilityState).toMatchObject({ disabled: true, selected: false });
      fireEvent.press(screen.getByLabelText("Dual"));
      expect(onToggleDual).not.toHaveBeenCalled();
    });

    it("toggles for a speech beside another, and shows when it is already on", () => {
      const onToggleDual = jest.fn();
      const { rerender } = render(
        <ScreenplayBar element="dialogue" dual={{ on: false }} onSetElement={jest.fn()} onToggleDual={onToggleDual} />
      );
      expect(screen.getByLabelText("Dual").props.accessibilityState).toMatchObject({ disabled: false, selected: false });
      fireEvent.press(screen.getByLabelText("Dual"));
      expect(onToggleDual).toHaveBeenCalledTimes(1);
      rerender(
        <ScreenplayBar element="dialogue" dual={{ on: true }} onSetElement={jest.fn()} onToggleDual={onToggleDual} />
      );
      expect(screen.getByLabelText("Dual").props.accessibilityState.selected).toBe(true);
    });
  });
});

describe("ScreenplayBar reveal", () => {
  const layout = (x: number, width: number) => ({ nativeEvent: { layout: { x, y: 0, width, height: 32 } } });

  // Chips are 80 wide, 4 apart, in a 240 wide window onto a 7 chip row.
  function lay() {
    const scroller = screen.UNSAFE_getByType(ScrollView);
    const scrollTo = jest.fn();
    scroller.instance.scrollTo = scrollTo;
    fireEvent(scroller, "layout", layout(0, 240));
    fireEvent(scroller, "contentSizeChange", 7 * 84, 40);
    ["Scene heading", "Action", "Character", "Dialogue", "Parenthetical", "Transition", "Shot"].forEach((label, i) => {
      fireEvent(screen.getByLabelText(label).parent!.parent!, "layout", layout(i * 84, 80));
    });
    return { scroller, scrollTo };
  }

  it("brings a lit chip that is out of view to the middle, within the row's ends", () => {
    const { rerender } = render(<ScreenplayBar element="action" onSetElement={jest.fn()} />);
    const { scrollTo } = lay();
    scrollTo.mockClear();
    rerender(<ScreenplayBar element="dialogue" onSetElement={jest.fn()} />);
    // Dialogue sits at 252..332: its middle (292) in a 240 window starts at 172.
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 172, animated: true });
    rerender(<ScreenplayBar element="shot" onSetElement={jest.fn()} />);
    // The last chip cannot centre: stop at the row's end (588 - 240).
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 348, animated: true });
    rerender(<ScreenplayBar element="scene-heading" onSetElement={jest.fn()} />);
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 0, animated: true });
  });

  it("leaves the row alone while the lit chip is already comfortably in view", () => {
    const { rerender } = render(<ScreenplayBar element="action" onSetElement={jest.fn()} />);
    const { scroller, scrollTo } = lay();
    // Scrolled to 100 in a 240 window, 108..300 is clear room: Character (168..248) is inside it.
    fireEvent.scroll(scroller, { nativeEvent: { contentOffset: { x: 100 } } });
    scrollTo.mockClear();
    rerender(<ScreenplayBar element="character" onSetElement={jest.fn()} />);
    expect(scrollTo).not.toHaveBeenCalled();
    // Dialogue (252..332) runs into the fade at the right edge, so it is brought round.
    rerender(<ScreenplayBar element="dialogue" onSetElement={jest.fn()} />);
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 172, animated: true });
  });
});
