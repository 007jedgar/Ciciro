import { act, fireEvent, render, screen } from "@testing-library/react-native";
import SettingsScreen from "../app/settings";
import { defaultSettings, type AppSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";
import { resetReadAloudPrefsForTests, setReadAloudPrefs } from "../lib/read-aloud";

const mockPush = jest.fn();
let mockModel: { status: "ready"; bytes: number } | { status: "absent" } = { status: "absent" };
let mockNative = true;

jest.mock("../lib/use-days-written", () => ({ useDaysWrittenInLast7: () => null }));

jest.mock("../lib/natural-model-store", () => ({
  useNaturalModelState: () => mockModel,
}));

jest.mock("../lib/natural-engine", () => ({
  naturalNativeAvailable: () => mockNative,
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
  useWritingReminderList: () => [],
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

describe("Settings: Listening", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockModel = { status: "absent" };
    mockNative = true;
    resetReadAloudPrefsForTests();
  });

  it("shows the system voice until a natural voice is downloaded, and opens the Listening screen", async () => {
    await renderSettings();
    fireEvent.press(screen.getByLabelText("Voice, System voice"));
    expect(mockPush).toHaveBeenLastCalledWith("/listening");
  });

  it("names the natural voice once it is downloaded", async () => {
    mockModel = { status: "ready", bytes: 401_239_297 };
    await renderSettings();
    expect(screen.getByLabelText("Voice, Natural · Heart")).toBeTruthy();
  });

  it("keeps saying system voice when the writer chose it even though the model is there", async () => {
    mockModel = { status: "ready", bytes: 401_239_297 };
    setReadAloudPrefs({ engine: "system" });
    await renderSettings();
    expect(screen.getByLabelText("Voice, System voice")).toBeTruthy();
  });

  it("says system voice where the natural voice cannot run", async () => {
    mockModel = { status: "ready", bytes: 401_239_297 };
    mockNative = false;
    await renderSettings();
    expect(screen.getByLabelText("Voice, System voice")).toBeTruthy();
  });
});
