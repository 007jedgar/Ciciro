import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import SettingsScreen from "../app/settings";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

const mockPush = jest.fn();
const mockRefresh = jest.fn(async () => {});
const mockResend = jest.fn();
const mockLogout = jest.fn(async () => {});
const mockResetTo = jest.fn();
let mockUser: { id: string; email: string; emailVerified?: boolean } = { id: "u1", email: "writer@example.com" };
const mockRunExport = jest.fn();
let mockExportBusy = false;

jest.mock("../lib/use-days-written", () => ({ useDaysWrittenInLast7: () => null }));
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
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => {},
}));
jest.mock("../lib/use-stack-back", () => ({
  useStackBack: () => ({ backOr: jest.fn(), resetTo: mockResetTo }),
}));
jest.mock("../components/AppHeader", () => ({ AppHeader: () => null, useAppHeaderHeight: () => 0, useMeasuredAppHeaderHeight: () => [0, () => {}] }));
jest.mock("../components/GlassSheet", () => ({ GlassSheet: () => null }));
jest.mock("../lib/session", () => ({
  useSession: () => ({ user: mockUser, ready: true, logout: mockLogout, refresh: mockRefresh }),
}));
jest.mock("../lib/api", () => {
  const actual = jest.requireActual("../lib/api/client");
  return {
    ApiError: actual.ApiError,
    ciciro: { auth: { resendVerification: () => mockResend() } },
    useEntitlementQuery: () => ({ data: undefined, refetch: jest.fn() }),
  };
});
jest.mock("../lib/writing-reminder-notifications", () => ({
  getReminderPermission: jest.fn(async () => "granted"),
  requestReminderPermission: jest.fn(async () => "granted"),
}));
jest.mock("../lib/writing-reminder-store", () => ({ useWritingReminderList: () => [] }));
jest.mock("../lib/api/hooks", () => ({
  useProjectQuery: () => ({ data: undefined }),
  useModelsQuery: () => ({ data: undefined }),
  useEmailPreferencesQuery: () => ({ data: undefined }),
  usePatchEmailPreferencesMutation: () => ({ mutate: jest.fn() }),
  usePushPreferencesQuery: () => ({ data: undefined }),
  usePatchPushPreferencesMutation: () => ({ mutate: jest.fn() }),
}));
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
    mockUser = { id: "u1", email: "writer@example.com" };
    mockResend.mockReset();
    mockRefresh.mockClear();
    mockLogout.mockClear();
    mockResetTo.mockClear();
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

  it("resets the stack to the root on sign out instead of a plain in-place replace", async () => {
    renderSettings();
    await act(async () => {});
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    });
    expect(mockLogout).toHaveBeenCalled();
    // resetTo, not router.replace: it dismisses settings' nested ancestors
    // instead of leaving them mounted underneath the welcome screen.
    expect(mockResetTo).toHaveBeenCalledWith("/");
  });

  it("hides the confirmation row once the address is confirmed", async () => {
    mockUser = { ...mockUser, emailVerified: true };
    renderSettings();
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Resend confirmation email" })).toBeNull();
    expect(screen.getByText("Signed in to Ciciro")).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("offers to resend the confirmation email to an unconfirmed address", async () => {
    mockUser = { ...mockUser, emailVerified: false };
    mockResend.mockResolvedValue({ ok: true, status: "sent" });
    renderSettings();
    await act(async () => {});
    expect(screen.getByText("Email not confirmed yet")).toBeTruthy();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Resend confirmation email" }));
    });
    expect(mockResend).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Sent. Check writer@example.com for the link.")).toBeTruthy();
  });

  it("explains the cooldown instead of the server's message", async () => {
    const { ApiError } = jest.requireActual("../lib/api/client");
    mockUser = { ...mockUser, emailVerified: false };
    mockResend.mockRejectedValue(new ApiError("A link just went out.", 429));
    renderSettings();
    await act(async () => {});
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Resend confirmation email" }));
    });
    expect(screen.getByText("A link just went out. Try again in a minute.")).toBeTruthy();
  });
});
