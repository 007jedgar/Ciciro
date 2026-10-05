import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";
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

  it("keeps every tile at least the 96pt tile, and lets the whole row grow together with large text", () => {
    renderTools(TOOLS);
    const row = StyleSheet.flatten(screen.getByTestId("project-tools").props.contentContainerStyle);
    expect(row.alignItems ?? "stretch").toBe("stretch");
    for (const { key, label } of TOOLS) {
      const tile = StyleSheet.flatten(screen.getByTestId(`tool-${key}`).props.style);
      expect(tile.minHeight).toBe(96);
      expect(tile.height).toBeUndefined();
      expect(tile.maxHeight).toBeUndefined();
      expect(tile.flexGrow).toBe(1);
      const text = screen.getByText(label);
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(text.props.maxFontSizeMultiplier).toBeUndefined();
    }
  });
});
