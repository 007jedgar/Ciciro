import { act, render, screen } from "@testing-library/react-native";
import SettingsScreen from "../app/settings";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

const mockParams: { project?: string } = {};
const mockProject = jest.fn();

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
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  Redirect: () => null,
  useLocalSearchParams: () => mockParams,
  useFocusEffect: () => {},
}));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backOr: jest.fn() }) }));
jest.mock("../components/AppHeader", () => ({
  AppHeader: () => null,
  useAppHeaderHeight: () => 0,
  useMeasuredAppHeaderHeight: () => [0, () => {}],
}));
jest.mock("../components/GlassSheet", () => ({ GlassSheet: () => null }));
jest.mock("../lib/session", () => ({
  useSession: () => ({ user: { id: "u1", email: "writer@example.com" }, ready: true, logout: jest.fn() }),
}));
jest.mock("../lib/writing-reminder-notifications", () => ({
  getReminderPermission: jest.fn(async () => "granted"),
  requestReminderPermission: jest.fn(async () => "granted"),
}));
jest.mock("../lib/writing-reminder-store", () => ({ useWritingReminderList: () => [] }));
jest.mock("../lib/api/hooks", () => ({
  useProjectQuery: (...args: unknown[]) => mockProject(...args),
  useModelsQuery: () => ({ data: undefined }),
  useEntitlementQuery: () => ({ data: undefined }),
  useEmailPreferencesQuery: () => ({ data: undefined }),
  usePatchEmailPreferencesMutation: () => ({ mutate: jest.fn() }),
  usePushPreferencesQuery: () => ({ data: undefined }),
  usePatchPushPreferencesMutation: () => ({ mutate: jest.fn() }),
}));

async function renderSettings() {
  const settings = defaultSettings();
  const colors = THEME_PALETTES[settings.theme];
  render(
    <AppThemeContext.Provider
      value={{ settings, colors, layout: makeLayout(colors, settings.editorFont), dark: false, patch: jest.fn() }}
    >
      <SettingsScreen />
    </AppThemeContext.Provider>
  );
  await act(async () => {});
}

describe("Settings: the open manuscript's own settings", () => {
  beforeEach(() => {
    delete mockParams.project;
    mockProject.mockReset();
    mockProject.mockReturnValue({ data: undefined });
  });

  it("shows nothing when Settings is not opened from a manuscript", async () => {
    await renderSettings();
    expect(screen.queryByText("Script format")).toBeNull();
    // The query is never asked for a manuscript.
    expect(mockProject).toHaveBeenCalledWith("", { enabled: false });
  });

  it("shows the screenplay settings at the top, marked Beta, with the format locked", async () => {
    mockParams.project = "p1";
    mockProject.mockReturnValue({ data: { id: "p1", kind: "screenplay" } });
    await renderSettings();
    expect(screen.getByText("Screenplay")).toBeTruthy();
    expect(screen.getByTestId("settings-beta-badge")).toBeTruthy();
    expect(screen.getByText("Script format")).toBeTruthy();
    expect(screen.getByText("Courier Prime 12 pt")).toBeTruthy();
    expect(screen.getByText("Locked")).toBeTruthy();
    expect(screen.getByText(/Tab steps through: Action, Character, Dialogue, Parenthetical, Transition, Shot, Scene heading\./)).toBeTruthy();
    expect(mockProject).toHaveBeenCalledWith("p1", { enabled: true });
  });

  it.each(["novel", "blog", "journal"])("shows no manuscript section for a %s", async (kind) => {
    mockParams.project = "p1";
    mockProject.mockReturnValue({ data: { id: "p1", kind } });
    await renderSettings();
    expect(screen.queryByText("Script format")).toBeNull();
    expect(screen.queryByTestId("settings-beta-badge")).toBeNull();
  });

  it("waits for the manuscript before showing anything", async () => {
    mockParams.project = "p1";
    await renderSettings();
    expect(screen.queryByText("Script format")).toBeNull();
  });
});
