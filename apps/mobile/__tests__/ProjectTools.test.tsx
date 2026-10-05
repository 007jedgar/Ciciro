import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { ProjectTools, type ProjectTool } from "../components/ProjectTools";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

const tool = (key: string, label: string, over: Partial<ProjectTool> = {}): ProjectTool => ({
  key,
  label,
  icon: <Text>*</Text>,
  onPress: jest.fn(),
  ...over,
});

function renderTools(tools: readonly ProjectTool[]) {
  const settings = defaultSettings();
  const colors = THEME_PALETTES[settings.theme];
  render(
    <AppThemeContext.Provider
      value={{ settings, colors, layout: makeLayout(colors, settings.editorFont), dark: false, patch: jest.fn() }}
    >
      <ProjectTools tools={tools} />
    </AppThemeContext.Provider>
  );
}

const TOOLS = [
  tool("bible", "Bible"),
  tool("continuity", "Continuity check across chapters"),
  tool("comments", "Comments", { badge: "3" }),
];

describe("ProjectTools", () => {
  it("opens a tool from its tile", () => {
    renderTools(TOOLS);
    fireEvent.press(screen.getByLabelText("Bible"));
    expect(TOOLS[0].onPress).toHaveBeenCalledTimes(1);
  });

  it("labels every tile, numbers the ones without a badge, and shows a tool's count", () => {
    renderTools(TOOLS);
    for (const { label } of TOOLS) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("01")).toBeTruthy();
    expect(screen.getByText("02")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByText("03")).toBeNull();
  });

  it("does not open a busy tool", () => {
    const busy = tool("export", "Export", { busy: true });
    renderTools([busy]);
    fireEvent.press(screen.getByLabelText("Export"));
    expect(busy.onPress).not.toHaveBeenCalled();
  });
});
