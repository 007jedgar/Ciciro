import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { defaultSettings, type AppSettings } from "../lib/app-settings";
import { SettingsProvider, useAppTheme } from "../lib/settings";
import { useThemePreview } from "../lib/theme-preview-context";

const store = new Map<string, string>();
const mockPrefs = {
  getString: (key: string) => store.get(key),
  set: (key: string, value: string) => void store.set(key, value),
  remove: (key: string) => void store.delete(key),
};
jest.mock("../lib/prefs", () => ({ getPrefs: () => mockPrefs }));

let mockUser: { id: string } | null = { id: "u1" };
jest.mock("../lib/session", () => ({ useSession: () => ({ user: mockUser }) }));

const mockGet = jest.fn();
const mockPut = jest.fn(async () => ({}));
const mockPatch = jest.fn(async () => ({}));
jest.mock("../lib/api/resources", () => ({
  ciciro: { settings: { get: () => mockGet(), put: (b: unknown) => mockPut(b), patch: (b: unknown) => mockPatch(b) } },
}));

const CREATED = "2026-09-01T00:00:00.000Z";
const blankServer = (over: Partial<AppSettings> = {}): AppSettings => ({
  ...defaultSettings(),
  theme: "parchment",
  updatedAt: CREATED,
  ...over,
});

function Theme() {
  return <Text testID="theme">{useAppTheme().settings.theme}</Text>;
}

async function launch() {
  render(
    <SettingsProvider>
      <Theme />
    </SettingsProvider>
  );
  await act(async () => {});
  return screen.getByTestId("theme").props.children as string;
}

function cache(settings: AppSettings, extra: Record<string, string> = {}) {
  store.set("settings", JSON.stringify(settings));
  store.set("settings-user-id", "u1");
  for (const [k, v] of Object.entries(extra)) store.set(k, v);
}

describe("SettingsProvider: the phone's default theme", () => {
  beforeEach(() => {
    store.clear();
    mockUser = { id: "u1" };
    mockGet.mockReset();
  });

  it("moves an older install's cached blank Parchment to Ciciro when the account never saved settings", async () => {
    cache(blankServer());
    mockGet.mockResolvedValue({ settings: blankServer(), settingsSaved: false });
    expect(await launch()).toBe("ciciro");
    expect(store.get("settings-saved")).toBe("0");
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("keeps a Parchment the account saved, on a new phone and on the same one", async () => {
    mockGet.mockResolvedValue({ settings: blankServer(), settingsSaved: true });
    expect(await launch()).toBe("parchment");
    expect(store.get("settings-saved")).toBe("1");

    screen.unmount();
    expect(await launch()).toBe("parchment");
  });

  it("shows a cached never-saved copy as Ciciro before the server answers, and signed out", async () => {
    cache(blankServer(), { "settings-saved": "0" });
    mockGet.mockReturnValue(new Promise(() => {}));
    expect(await launch()).toBe("ciciro");

    screen.unmount();
    mockUser = null;
    expect(await launch()).toBe("ciciro");
  });

  it("leaves a stored theme alone when the server does not report whether settings were saved", async () => {
    cache(blankServer());
    mockGet.mockResolvedValue({ settings: blankServer() });
    expect(await launch()).toBe("parchment");
    expect(store.has("settings-saved")).toBe(false);
  });
});

describe("SettingsProvider: defaults for a brand-new account", () => {
  const server = blankServer();

  function Adopter({ patch, userId = "u1" }: { patch: Partial<AppSettings>; userId?: string }) {
    const { adoptNewAccount } = useThemePreview();
    return <Text testID="adopt" onPress={() => adoptNewAccount(patch, userId)} />;
  }
  function Analytics() {
    return <Text testID="analytics">{String(useAppTheme().settings.analyticsEnabled)}</Text>;
  }

  beforeEach(() => {
    store.clear();
    mockUser = { id: "u1" };
    mockGet.mockReset();
    mockPatch.mockClear();
  });

  it("applies the defaults once the settings have loaded, and syncs them", async () => {
    jest.useFakeTimers();
    mockGet.mockResolvedValue({ settings: server, settingsSaved: false });
    render(
      <SettingsProvider>
        <Analytics />
        <Adopter patch={{ analyticsEnabled: true }} />
      </SettingsProvider>
    );
    await act(async () => {});
    expect(screen.getByTestId("analytics").props.children).toBe("false");
    await act(async () => {
      screen.getByTestId("adopt").props.onPress();
    });
    expect(screen.getByTestId("analytics").props.children).toBe("true");
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(mockPatch).toHaveBeenCalledWith(expect.objectContaining({ analyticsEnabled: true }));
    jest.useRealTimers();
  });

  it("waits for a settings fetch still in flight, so it cannot undo them", async () => {
    let answer: (value: unknown) => void = () => {};
    mockGet.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(
      <SettingsProvider>
        <Analytics />
        <Adopter patch={{ analyticsEnabled: true }} />
      </SettingsProvider>
    );
    await act(async () => {
      screen.getByTestId("adopt").props.onPress();
    });
    expect(screen.getByTestId("analytics").props.children).toBe("false");
    await act(async () => {
      answer({ settings: server, settingsSaved: false });
    });
    expect(screen.getByTestId("analytics").props.children).toBe("true");
  });

  it("never gives them to an account other than the one they were meant for", async () => {
    mockGet.mockResolvedValue({ settings: server, settingsSaved: true });
    render(
      <SettingsProvider>
        <Analytics />
        <Adopter patch={{ analyticsEnabled: true }} userId="someone-else" />
      </SettingsProvider>
    );
    await act(async () => {});
    await act(async () => {
      screen.getByTestId("adopt").props.onPress();
    });
    expect(screen.getByTestId("analytics").props.children).toBe("false");
  });
});
