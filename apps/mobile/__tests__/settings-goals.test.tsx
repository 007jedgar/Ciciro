import { act, fireEvent, render, screen } from "@testing-library/react-native";
import SettingsScreen from "../app/settings";
import { defaultSettings, type AppSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";
import { newWritingReminder, type WritingReminder } from "../lib/writing-reminders";

const mockPush = jest.fn();
let mockReminders: WritingReminder[] = [];
let mockDaysWritten: number | null = null;

jest.mock("../lib/use-days-written", () => ({ useDaysWrittenInLast7: () => mockDaysWritten }));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  Redirect: () => null,
  useLocalSearchParams: () => ({}),
  useFocusEffect: () => {},
}));

jest.mock("../lib/use-stack-back", () => ({
  useStackBack: () => ({ backOr: jest.fn() }),
}));

jest.mock("../components/AppHeader", () => ({
  AppHeader: () => null,
  useAppHeaderHeight: () => 0,
  useMeasuredAppHeaderHeight: () => [0, () => {}],
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
  useWritingReminderList: () => mockReminders,
}));

jest.mock("../lib/api/hooks", () => ({
  useProjectQuery: () => ({ data: undefined }),
  useModelsQuery: () => ({ data: undefined }),
  useEntitlementQuery: () => ({ data: undefined }),
  useEmailPreferencesQuery: () => ({ data: undefined }),
  usePatchEmailPreferencesMutation: () => ({ mutate: jest.fn() }),
  usePushPreferencesQuery: () => ({ data: undefined }),
  usePatchPushPreferencesMutation: () => ({ mutate: jest.fn() }),
}));

async function renderSettings(overrides: Partial<AppSettings> = {}) {
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
  await act(async () => {});
  return patch;
}

describe("Settings: goals and reminders", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockReminders = [];
    mockDaysWritten = null;
  });

  it("is three plain rows that open their own screens, with nothing to adjust inline", async () => {
    await renderSettings();

    expect(screen.queryByLabelText("Daily words")).toBeNull();
    expect(screen.queryByLabelText("Days per week")).toBeNull();

    fireEvent.press(screen.getByLabelText("Word goal, 250 words a day"));
    expect(mockPush).toHaveBeenLastCalledWith("/word-goal");
    fireEvent.press(screen.getByLabelText("Writing reminders, Off"));
    expect(mockPush).toHaveBeenLastCalledWith("/writing-reminders");
    fireEvent.press(screen.getByLabelText("Writing history"));
    expect(mockPush).toHaveBeenLastCalledWith("/writing-history");
  });

  it("summarises each row's current value", async () => {
    mockReminders = [{ ...newWritingReminder({ id: "r1" }), days: [1, 2, 3, 4, 5], hour: 20 }];
    mockDaysWritten = 3;
    await renderSettings({ showDailyGoal: true, dailyWordGoal: 500 });

    expect(screen.getByLabelText("Word goal, 500 words a day")).toBeTruthy();
    expect(screen.getByLabelText(/^Writing reminders, Weekdays at 8\sPM$/)).toBeTruthy();
    expect(screen.getByLabelText("Writing history, 3 of the last 7 days")).toBeTruthy();
  });
});
