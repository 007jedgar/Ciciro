import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import SettingsScreen from "../app/settings";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

const mockPush = jest.fn();
const mockRunExport = jest.fn();
let mockExportBusy = false;

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));
jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  Redirect: () => null,
}));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backOr: jest.fn() }) }));
jest.mock("../components/AppHeader", () => ({ AppHeader: () => null, useAppHeaderHeight: () => 0 }));
jest.mock("../components/GlassSheet", () => ({ GlassSheet: () => null }));
jest.mock("../lib/session", () => ({
  useSession: () => ({ user: { id: "u1", email: "writer@example.com" }, ready: true, logout: jest.fn() }),
}));
jest.mock("../lib/writing-reminder-notifications", () => ({
  getReminderPermission: jest.fn(async () => "granted"),
}));
jest.mock("../lib/writing-reminder-store", () => ({ useWritingReminderList: () => [] }));
jest.mock("../lib/api/hooks", () => ({ useModelsQuery: () => ({ data: undefined }) }));
jest.mock("../lib/use-export-account-data", () => ({
  useExportAccountData: () => ({ busy: mockExportBusy, run: mockRunExport }),
}));

function renderSettings() {
  const settings = defaultSettings();
  const colors = THEME_PALETTES[settings.theme];
  return render(
    <AppThemeContext.Provider
      value={{ settings, colors, layout: makeLayout(colors, settings.editorFont), dark: false, patch: jest.fn() }}
    >
      <SettingsScreen />
    </AppThemeContext.Provider>
  );
}

describe("Settings account rows", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  beforeEach(() => {
    mockExportBusy = false;
  });

  it("exports the account's data from its row", async () => {
    renderSettings();
    await act(async () => {});
    fireEvent.press(screen.getByRole("button", { name: "Export my data" }));
    expect(mockRunExport).toHaveBeenCalled();
  });

  it("shows the export is under way", async () => {
    mockExportBusy = true;
    renderSettings();
    await act(async () => {});
    expect(screen.getByText("Preparing…")).toBeTruthy();
  });

  it("opens the delete confirmation from its row", async () => {
    renderSettings();
    await act(async () => {});
    fireEvent.press(screen.getByRole("button", { name: "Delete account" }));
    expect(mockPush).toHaveBeenCalledWith("/delete-account");
  });
});
