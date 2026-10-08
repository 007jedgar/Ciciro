import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import SettingsScreen from "../app/settings";
import { defaultSettings, type AppSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  Redirect: () => null,
  useFocusEffect: () => {},
}));

jest.mock("../lib/use-stack-back", () => ({
  useStackBack: () => ({ backOr: jest.fn() }),
}));

jest.mock("../components/AppHeader", () => ({
  AppHeader: () => null,
  useAppHeaderHeight: () => 0, useMeasuredAppHeaderHeight: () => [0, () => {}],
}));

jest.mock("../components/GlassSheet", () => ({
  GlassSheet: () => null,
}));

jest.mock("../lib/session", () => ({
  useSession: () => ({ user: { id: "u1", email: "writer@example.com" }, ready: true, logout: jest.fn() }),
}));

jest.mock("../lib/writing-reminder-notifications", () => ({
  getReminderPermission: jest.fn(async () => "granted"),
  requestReminderPermission: jest.fn(async () => "granted"),
}));

jest.mock("../lib/writing-reminder-store", () => ({
  useWritingReminderList: () => [],
}));

jest.mock("../lib/api/hooks", () => ({
  useModelsQuery: () => ({ data: undefined }),
  useEntitlementQuery: () => ({ data: undefined }),
  useEmailPreferencesQuery: () => ({ data: undefined }),
  usePatchEmailPreferencesMutation: () => ({ mutate: jest.fn() }),
  usePushPreferencesQuery: () => ({ data: undefined }),
  usePatchPushPreferencesMutation: () => ({ mutate: jest.fn() }),
}));

function renderSettings(overrides: Partial<AppSettings> = {}) {
  const settings = { ...defaultSettings(), ...overrides };
  const colors = THEME_PALETTES[settings.theme];
  const patch = jest.fn();
  render(
    <AppThemeContext.Provider
      value={{ settings, colors, layout: makeLayout(colors, settings.editorFont), dark: false, patch }}
    >
      <SettingsScreen />
    </AppThemeContext.Provider>
  );
  return patch;
}

describe("Settings: Experimental writing prompt", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("is off by default and turns on through the synced settings patch", async () => {
    const patch = renderSettings();
    await act(async () => {});

    const toggle = screen.getByLabelText("Experimental writing prompt");
    expect(toggle.props.value).toBe(false);
    expect(
      screen.getByText("Ciciro drafts with rules against common AI writing habits, then checks each draft.")
    ).toBeTruthy();

    fireEvent(toggle, "valueChange", true);
    expect(patch).toHaveBeenCalledWith({ craftDefaults: true });
  });

  it("shows the stored value and turns it off", async () => {
    const patch = renderSettings({ craftDefaults: true });
    await act(async () => {});

    const toggle = screen.getByLabelText("Experimental writing prompt");
    expect(toggle.props.value).toBe(true);
    fireEvent(toggle, "valueChange", false);
    expect(patch).toHaveBeenCalledWith({ craftDefaults: false });
  });

  it.each([
    ["es", "Indicación de escritura experimental"],
    ["hi", "प्रायोगिक लेखन प्रॉम्प्ट"],
    ["zh", "实验性写作提示"],
  ])("translates the label in %s", async (lang, label) => {
    await act(async () => {
      await i18n.changeLanguage(lang);
    });
    renderSettings();
    await act(async () => {});
    expect(screen.getByLabelText(label)).toBeTruthy();
    expect(screen.queryByText("Experimental writing prompt")).toBeNull();
  });
});
