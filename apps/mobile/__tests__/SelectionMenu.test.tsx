import { fireEvent, render, screen } from "@testing-library/react-native";
import { SelectionMenu } from "../components/SelectionMenu";

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

function menu(props: Partial<Parameters<typeof SelectionMenu>[0]> = {}) {
  const onAction = jest.fn();
  const onSynonym = jest.fn();
  render(
    <SelectionMenu
      target="passage"
      word="who had been pushing"
      synonyms={{ status: "idle", list: [] }}
      maxWidth={360}
      onAction={onAction}
      onSynonym={onSynonym}
      {...props}
    />
  );
  return { onAction, onSynonym };
}

describe("SelectionMenu", () => {
  it("offers a passage Comment, Rewrite, Describe, Expand and Fix", () => {
    const { onAction } = menu();
    for (const label of ["Comment", "Rewrite", "Describe", "Expand", "Fix"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(screen.queryByTestId("selection-synonyms-more")).toBeNull();
    fireEvent.press(screen.getByLabelText("Expand"));
    expect(onAction).toHaveBeenCalledWith("expand");
  });

  it("offers a word Comment, Describe and Fix, with its synonyms under them", () => {
    const { onAction, onSynonym } = menu({ target: "word", word: "country", synonyms: ready });
    expect(screen.queryByLabelText("Rewrite")).toBeNull();
    expect(screen.queryByLabelText("Expand")).toBeNull();
    fireEvent.press(screen.getByLabelText("Fix"));
    expect(onAction).toHaveBeenCalledWith("fix");
    expect(screen.getByLabelText("Replace country with homeland")).toBeTruthy();
    expect(screen.getByLabelText("Replace country with bush")).toBeTruthy();
    expect(screen.queryByLabelText("Replace country with state")).toBeNull();
    fireEvent.press(screen.getByLabelText("Replace country with nation"));
    expect(onSynonym).toHaveBeenCalledWith("nation", false);
  });

  it("opens the rest behind 'N more...' and reports a pick from it as such", () => {
    const { onSynonym } = menu({ target: "word", word: "country", synonyms: ready });
    fireEvent.press(screen.getByLabelText("2 more..."));
    fireEvent.press(screen.getByLabelText("Replace country with land"));
    expect(onSynonym).toHaveBeenCalledWith("land", true);
  });

  it("closes the list again with Fewer", () => {
    menu({ target: "word", word: "country", synonyms: ready });
    fireEvent.press(screen.getByLabelText("2 more..."));
    fireEvent.press(screen.getByLabelText("Fewer"));
    expect(screen.queryByLabelText("Replace country with land")).toBeNull();
    expect(screen.getByLabelText("2 more...")).toBeTruthy();
  });

  it("holds the chips' place while synonyms load, and leaves them out when there are none", () => {
    menu({ target: "word", word: "country", synonyms: { status: "loading", list: [] } });
    expect(screen.getByTestId("selection-synonyms-loading")).toBeTruthy();
    screen.unmount();
    menu({ target: "word", word: "country", synonyms: { status: "none", list: [] } });
    expect(screen.queryByTestId("selection-synonyms-loading")).toBeNull();
    expect(screen.getByLabelText("Fix")).toBeTruthy();
  });
});
