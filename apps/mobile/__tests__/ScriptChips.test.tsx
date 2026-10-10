import { fireEvent, render, screen } from "@testing-library/react-native";
import { ScriptChips } from "../components/ScriptChips";
import type { Completion } from "../lib/screenplay";

const choice = (label: string, insert = label): Completion => ({ kind: "name", label, from: 0, insert });

describe("ScriptChips", () => {
  it("shows nothing when there is nothing to offer", () => {
    render(
      <ScriptChips choices={[]} cue={false} extensionLit={() => false} onPick={jest.fn()} onToggleExtension={jest.fn()} />
    );
    expect(screen.queryByTestId("script-chips")).toBeNull();
  });

  it("offers each choice and hands the tapped one back", () => {
    const onPick = jest.fn();
    render(
      <ScriptChips
        choices={[choice("MARA (CONT'D)"), choice("MARCUS")]}
        cue={false}
        extensionLit={() => false}
        onPick={onPick}
        onToggleExtension={jest.fn()}
      />
    );
    fireEvent.press(screen.getByLabelText("MARCUS"));
    expect(onPick).toHaveBeenCalledWith(choice("MARCUS"));
    expect(screen.queryByLabelText("V.O.")).toBeNull();
  });

  it("sets the extensions of a cue with a name and lights the ones it carries", () => {
    const onToggle = jest.fn();
    render(
      <ScriptChips
        choices={[]}
        cue
        extensionLit={(ext) => ext === "V.O."}
        onPick={jest.fn()}
        onToggleExtension={onToggle}
      />
    );
    expect(screen.getByLabelText("V.O., on").props.accessibilityState.selected).toBe(true);
    expect(screen.getByLabelText("O.S.").props.accessibilityState.selected).toBe(false);
    fireEvent.press(screen.getByLabelText("CONT'D"));
    expect(onToggle).toHaveBeenCalledWith("CONT'D");
  });

  it("grays the extensions out with an info button in a language script formatting does not cover", () => {
    const onToggle = jest.fn();
    render(
      <ScriptChips
        choices={[]}
        cue
        extensionLit={() => false}
        extensionsEnabled={false}
        onPick={jest.fn()}
        onToggleExtension={onToggle}
      />
    );
    fireEvent.press(screen.getByLabelText("V.O."));
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByTestId("script-extensions-info")).toBeTruthy();
  });
});
