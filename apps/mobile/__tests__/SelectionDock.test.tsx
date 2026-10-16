import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Dimensions, ScrollView, StyleSheet } from "react-native";
import { SelectionDock, SelectionDockHost } from "../components/SelectionDock";
import {
  DOCK_ACTIONS_ROW,
  DOCK_ROW_HEIGHT,
  DOCK_SYNONYMS_ROW,
  setSelectionDock,
  type SelectionDockModel,
} from "../lib/selection-dock";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

const ready = {
  status: "ready" as const,
  list: ["homeland", "nation", "bush", "state", "land"],
};

function model(overrides: Partial<SelectionDockModel> = {}): SelectionDockModel {
  return {
    target: "passage",
    word: "who had been pushing",
    synonyms: { status: "idle", list: [] },
    onAction: jest.fn(),
    onSynonym: jest.fn(),
    ...overrides,
  };
}

describe("SelectionDock", () => {
  it("offers a passage Comment, Rewrite, Describe, Expand and Fix", () => {
    const m = model();
    render(<SelectionDock model={m} />);
    for (const label of ["Comment", "Rewrite", "Describe", "Expand", "Fix"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    fireEvent.press(screen.getByLabelText("Expand"));
    expect(m.onAction).toHaveBeenCalledWith("expand");
  });

  it("offers a word Comment, Describe and Fix, with every synonym after them in the one row", () => {
    const m = model({ target: "word", word: "country", synonyms: ready });
    render(<SelectionDock model={m} />);
    expect(screen.queryByLabelText("Rewrite")).toBeNull();
    expect(screen.queryByLabelText("Expand")).toBeNull();
    fireEvent.press(screen.getByLabelText("Fix"));
    expect(m.onAction).toHaveBeenCalledWith("fix");
    for (const synonym of ready.list) {
      expect(screen.getByLabelText(`Replace country with ${synonym}`)).toBeTruthy();
    }
    // The rest are a scroll away, not behind a control that could spill past the card.
    expect(screen.queryByTestId("selection-synonyms-more")).toBeNull();
    expect(screen.queryByLabelText(/more\.\.\./)).toBeNull();
  });

  it("reports a pick, and whether it was past the first few", () => {
    const m = model({ target: "word", word: "country", synonyms: ready });
    render(<SelectionDock model={m} />);
    fireEvent.press(screen.getByLabelText("Replace country with nation"));
    expect(m.onSynonym).toHaveBeenLastCalledWith("nation", false);
    fireEvent.press(screen.getByLabelText("Replace country with land"));
    expect(m.onSynonym).toHaveBeenLastCalledWith("land", true);
  });

  it("scrolls sideways rather than wrapping or growing, so nothing can leave the page", () => {
    render(<SelectionDock model={model({ target: "word", word: "country", synonyms: ready })} />);
    const scroller = screen.getByTestId("selection-dock").findByType(ScrollView);
    expect(scroller.props.horizontal).toBe(true);
    const row = StyleSheet.flatten(scroller.props.contentContainerStyle);
    expect(row.flexWrap).toBeUndefined();
    expect(scroller.props.keyboardShouldPersistTaps).toBe("always");
  });

  it("keeps a long multi-word synonym on one line, capped to the page", () => {
    const window = jest.spyOn(Dimensions, "get").mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
    const long = "a deliberately long and winding phrase that no chip should be allowed to hold in full";
    render(
      <SelectionDock
        model={model({ target: "word", word: "country", synonyms: { status: "ready", list: [long, "land"] } })}
      />
    );
    const chip = screen.getByLabelText(`Replace country with ${long}`);
    const style = StyleSheet.flatten(chip.props.style);
    expect(style.maxWidth).toBeGreaterThan(0);
    expect(style.maxWidth).toBeLessThan(390);
    const label = screen.getByText(long);
    expect(label.props.numberOfLines).toBe(1);
    expect(label.props.ellipsizeMode).toBe("tail");
    window.mockRestore();
  });

  it("in one row, the actions and the synonyms follow each other in a single scroller", () => {
    render(<SelectionDock model={model({ target: "word", word: "country", synonyms: ready })} />);
    expect(screen.getByTestId("selection-dock").findAllByType(ScrollView)).toHaveLength(1);
  });

  it("stacked, the actions sit over the synonyms, each row scrolling on its own", () => {
    const m = model({ target: "word", word: "country", synonyms: ready });
    render(<SelectionDock model={m} stacked />);
    const scrollers = screen.getByTestId("selection-dock").findAllByType(ScrollView);
    expect(scrollers).toHaveLength(2);
    for (const scroller of scrollers) {
      expect(scroller.props.horizontal).toBe(true);
      expect(scroller.props.keyboardShouldPersistTaps).toBe("always");
      expect(StyleSheet.flatten(scroller.props.contentContainerStyle).flexWrap).toBeUndefined();
    }
    const [actions, chips] = scrollers;
    expect(actions.findByProps({ testID: "selection-action-fix" })).toBeTruthy();
    expect(actions.findAll((node) => node.props.testID === "selection-synonym-nation")).toHaveLength(0);
    expect(chips.findAll((node) => node.props.testID === "selection-synonym-nation").length).toBeGreaterThan(0);
    fireEvent.press(screen.getByLabelText("Replace country with bush"));
    expect(m.onSynonym).toHaveBeenLastCalledWith("bush", false);
    fireEvent.press(screen.getByLabelText("Fix"));
    expect(m.onAction).toHaveBeenCalledWith("fix");
  });

  it("stacked, a passage (or a word with no synonyms) is just the actions row", () => {
    const { unmount } = render(<SelectionDock model={model()} stacked />);
    expect(screen.getByTestId("selection-dock").findAllByType(ScrollView)).toHaveLength(1);
    unmount();
    render(<SelectionDock model={model({ target: "word", word: "country", synonyms: { status: "none", list: [] } })} stacked />);
    expect(screen.getByTestId("selection-dock").findAllByType(ScrollView)).toHaveLength(1);
  });

  it("holds the chips' place while synonyms load, and leaves them out when there are none", () => {
    const { unmount } = render(
      <SelectionDock model={model({ target: "word", word: "country", synonyms: { status: "loading", list: [] } })} />
    );
    expect(screen.getByTestId("selection-synonyms-loading")).toBeTruthy();
    unmount();
    render(<SelectionDock model={model({ target: "word", word: "country", synonyms: { status: "none", list: [] } })} />);
    expect(screen.queryByTestId("selection-synonyms-loading")).toBeNull();
    expect(screen.getByLabelText("Fix")).toBeTruthy();
  });
});

const PLACE = { visible: true, headerHeight: 210, safeTop: 59, focused: false, meterShown: true };

describe("SelectionDockHost", () => {
  afterEach(() => {
    act(() => setSelectionDock(null));
  });

  it("draws nothing until the screen publishes a selection", () => {
    render(<SelectionDockHost {...PLACE} />);
    expect(screen.queryByTestId("selection-dock")).toBeNull();
    act(() => setSelectionDock(model()));
    expect(screen.getByTestId("selection-dock")).toBeTruthy();
    act(() => setSelectionDock(null));
    expect(screen.queryByTestId("selection-dock")).toBeNull();
  });

  it("covers the header's pills and meter rows with two rows for a word, hanging from the header's bottom edge", () => {
    render(<SelectionDockHost {...PLACE} />);
    act(() => setSelectionDock(model({ target: "word", word: "country", synonyms: ready })));
    const style = StyleSheet.flatten(screen.getByTestId("selection-dock-host").props.style);
    const height = DOCK_ACTIONS_ROW + DOCK_SYNONYMS_ROW;
    expect(style).toMatchObject({ position: "absolute", top: PLACE.headerHeight - height, height, left: 0, right: 0 });
    expect(style.zIndex).toBeGreaterThan(20);
    expect(screen.getByTestId("selection-dock").findAllByType(ScrollView)).toHaveLength(2);
  });

  it("covers only the pills row for a passage, leaving the meter showing", () => {
    render(<SelectionDockHost {...PLACE} />);
    act(() => setSelectionDock(model()));
    const style = StyleSheet.flatten(screen.getByTestId("selection-dock-host").props.style);
    expect(style).toMatchObject({
      top: PLACE.headerHeight - DOCK_ACTIONS_ROW - DOCK_SYNONYMS_ROW,
      height: DOCK_ACTIONS_ROW,
    });
  });

  it("is one row where the meter is off", () => {
    render(<SelectionDockHost {...PLACE} meterShown={false} />);
    act(() => setSelectionDock(model({ target: "word", word: "country", synonyms: ready })));
    const style = StyleSheet.flatten(screen.getByTestId("selection-dock-host").props.style);
    expect(style).toMatchObject({ top: PLACE.headerHeight - DOCK_ROW_HEIGHT, height: DOCK_ROW_HEIGHT });
    expect(screen.getByTestId("selection-dock").findAllByType(ScrollView)).toHaveLength(1);
  });

  it("sits under the status bar in focus mode, where the header is away", () => {
    render(<SelectionDockHost {...PLACE} focused />);
    act(() => setSelectionDock(model({ target: "word", word: "country", synonyms: ready })));
    const style = StyleSheet.flatten(screen.getByTestId("selection-dock-host").props.style);
    expect(style).toMatchObject({ top: PLACE.safeTop, height: DOCK_ROW_HEIGHT });
    expect(screen.getByTestId("selection-dock").findAllByType(ScrollView)).toHaveLength(1);
  });

  it("stays away off the manuscript tab", () => {
    render(<SelectionDockHost {...PLACE} visible={false} />);
    act(() => setSelectionDock(model()));
    expect(screen.queryByTestId("selection-dock")).toBeNull();
  });
});
