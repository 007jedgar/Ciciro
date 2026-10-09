import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import WordGoalScreen from "../app/word-goal";
import { defaultSettings, type AppSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  Redirect: () => null,
}));

jest.mock("../lib/use-stack-back", () => ({
  useStackBack: () => ({ backOr: jest.fn() }),
}));

jest.mock("../components/AppHeader", () => ({
  AppHeader: () => null,
  useMeasuredAppHeaderHeight: () => [0, () => {}],
}));

jest.mock("../lib/session", () => ({
  useSession: () => ({ user: { id: "u1", email: "writer@example.com" }, ready: true }),
}));

function renderScreen(overrides: Partial<AppSettings> = {}) {
  const settings = { ...defaultSettings(), ...overrides };
  const colors = THEME_PALETTES[settings.theme];
  const patch = jest.fn();
  const view = render(
    <AppThemeContext.Provider
      value={{ settings, colors, layout: makeLayout(colors, settings.editorFont), dark: false, patch }}
    >
      <WordGoalScreen />
    </AppThemeContext.Provider>
  );
  return { patch, view };
}

const selected = (label: string) => screen.getByRole("radio", { name: label }).props.accessibilityState.selected;

describe("Word goal screen", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("shows No goal selected when the goal is off, with no days-per-week choice to make", () => {
    renderScreen({ showDailyGoal: false });
    expect(selected("No goal")).toBe(true);
    expect(selected("250 words a day")).toBe(false);
    expect(screen.queryByText("Days per week")).toBeNull();
  });

  it("sets a goal, which also turns the meter on", () => {
    const { patch } = renderScreen({ showDailyGoal: false });
    fireEvent.press(screen.getByRole("radio", { name: "500 words a day" }));
    expect(patch).toHaveBeenCalledWith({ showDailyGoal: true, dailyWordGoal: 500 });
  });

  it("clears the goal back to none without forgetting the number", () => {
    const { patch } = renderScreen({ showDailyGoal: true, dailyWordGoal: 250 });
    expect(selected("250 words a day")).toBe(true);
    expect(selected("No goal")).toBe(false);
    fireEvent.press(screen.getByRole("radio", { name: "No goal" }));
    expect(patch).toHaveBeenCalledWith({ showDailyGoal: false });
  });

  it("offers days per week only while a goal is set", () => {
    const { patch } = renderScreen({ showDailyGoal: true, weeklyDayTarget: 4 });
    expect(screen.getByText("Days per week")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("5 days"));
    expect(patch).toHaveBeenCalledWith({ weeklyDayTarget: 5 });
  });

  it("lists a saved goal that is not a preset, so it can be seen as chosen", () => {
    renderScreen({ showDailyGoal: true, dailyWordGoal: 300 });
    expect(selected("300 words a day")).toBe(true);
  });

  it.each([
    ["es", "Sin meta"],
    ["hi", "कोई लक्ष्य नहीं"],
    ["zh", "不设目标"],
  ])("translates in %s", async (lang, none) => {
    await act(async () => {
      await i18n.changeLanguage(lang);
    });
    renderScreen();
    expect(screen.getByRole("radio", { name: none })).toBeTruthy();
  });
});
