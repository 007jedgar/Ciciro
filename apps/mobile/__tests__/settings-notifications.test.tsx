import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import SettingsScreen from "../app/settings";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";
import { getReminderPermission, requestReminderPermission } from "../lib/writing-reminder-notifications";
import { usePatchPushPreferencesMutation, usePushPreferencesQuery } from "../lib/api/hooks";

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

const mockPatchMutate = jest.fn();
let mockPrefs: Record<string, boolean> | undefined = { shareComments: true, writingNudge: true, chatFinished: false };

jest.mock("../lib/api/hooks", () => ({
  useModelsQuery: () => ({ data: undefined }),
  useEntitlementQuery: () => ({ data: undefined }),
  useEmailPreferencesQuery: () => ({ data: undefined }),
  usePatchEmailPreferencesMutation: () => ({ mutate: jest.fn() }),
  usePushPreferencesQuery: jest.fn(),
  usePatchPushPreferencesMutation: jest.fn(),
}));

const getPermissionMock = getReminderPermission as jest.Mock;
const requestPermissionMock = requestReminderPermission as jest.Mock;
const usePushPreferencesQueryMock = usePushPreferencesQuery as jest.Mock;
const usePatchPushPreferencesMutationMock = usePatchPushPreferencesMutation as jest.Mock;

const NOTIFICATIONS_HEADER = /^notifications$/i;

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

describe("Settings: Notifications", () => {
  beforeEach(() => {
    mockPatchMutate.mockClear();
    usePushPreferencesQueryMock.mockReturnValue({ data: mockPrefs });
    usePatchPushPreferencesMutationMock.mockReturnValue({ mutate: mockPatchMutate });
  });

  it("shows the three category toggles once permission is granted", async () => {
    getPermissionMock.mockResolvedValueOnce("granted");
    renderSettings();
    await act(async () => {});
    expect(screen.getByText("Reader comments")).toBeTruthy();
    expect(screen.getByText("Writing nudge")).toBeTruthy();
    expect(screen.getByText("Chat finished")).toBeTruthy();
  });

  it("flips a category when its toggle is switched", async () => {
    getPermissionMock.mockResolvedValueOnce("granted");
    renderSettings();
    await act(async () => {});
    fireEvent(screen.getByLabelText("Reader comments"), "valueChange", false);
    expect(mockPatchMutate).toHaveBeenCalledWith({ shareComments: false });
  });

  it("offers to turn on notifications when permission was never asked", async () => {
    getPermissionMock.mockResolvedValueOnce("undetermined");
    renderSettings();
    await act(async () => {});
    expect(screen.queryByText("Reader comments")).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByText("Turn on notifications"));
    });
    expect(requestPermissionMock).toHaveBeenCalled();
  });

  it("links to OS Settings when notifications were denied", async () => {
    getPermissionMock.mockResolvedValueOnce("denied");
    const openSettings = jest.spyOn(Linking, "openSettings").mockImplementation(async () => {});
    renderSettings();
    await act(async () => {});
    fireEvent.press(screen.getByText("Open system settings"));
    expect(openSettings).toHaveBeenCalled();
    openSettings.mockRestore();
  });

  it("renders nothing extra when push is unavailable on this platform", async () => {
    getPermissionMock.mockResolvedValueOnce("unavailable");
    renderSettings();
    await act(async () => {});
    expect(screen.queryByText("Reader comments")).toBeNull();
    expect(screen.queryByText("Turn on notifications")).toBeNull();
    expect(screen.queryByText(NOTIFICATIONS_HEADER)).toBeNull();
  });

  it("shows no Notifications header until the preferences load", async () => {
    usePushPreferencesQueryMock.mockReturnValue({ data: undefined });
    getPermissionMock.mockResolvedValueOnce("granted");
    renderSettings();
    await act(async () => {});
    expect(screen.queryByText(NOTIFICATIONS_HEADER)).toBeNull();
  });

  it("shows the Notifications header with its toggles", async () => {
    getPermissionMock.mockResolvedValueOnce("granted");
    renderSettings();
    await act(async () => {});
    expect(screen.getByText(NOTIFICATIONS_HEADER)).toBeTruthy();
  });
});
