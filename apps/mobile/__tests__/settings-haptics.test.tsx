import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import SettingsScreen from "../app/settings";
import { defaultSettings, type AppSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import * as Haptics from "expo-haptics";
import { getHapticsEnabled, setHapticsEnabled } from "../lib/haptics";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

const mockDisk = new Map<string, string>();
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({
    getString: (key: string) => mockDisk.get(key),
    set: (key: string, value: string) => {
      mockDisk.set(key, value);
    },
  }),
}));

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
  useAppHeaderHeight: () => 0,
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

describe("Settings: Haptics", () => {
  beforeEach(() => {
    setHapticsEnabled(true);
    jest.clearAllMocks();
  });

  it("is on by default and turning it off silences every later tap", async () => {
    renderSettings();
    await act(async () => {});

    const toggle = screen.getByLabelText("Haptics");
    expect(toggle.props.value).toBe(true);

    fireEvent(toggle, "valueChange", false);
    expect(getHapticsEnabled()).toBe(false);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText("Delete account"));
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("taps on a Settings row press while on", async () => {
    renderSettings();
    await act(async () => {});
    fireEvent.press(screen.getByLabelText("Delete account"));
    expect(Haptics.impactAsync).toHaveBeenCalledWith("light");
  });
});
