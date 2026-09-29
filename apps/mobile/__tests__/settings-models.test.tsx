import { act, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import SettingsScreen from "../app/settings";
import { useModelsQuery } from "../lib/api/hooks";
import type { ModelsResponse } from "../lib/api/types";
import { defaultSettings } from "../lib/app-settings";
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
}));

jest.mock("../lib/writing-reminder-store", () => ({
  useWritingReminderList: () => [],
}));

jest.mock("../lib/api/hooks", () => ({
  useModelsQuery: jest.fn(),
  useEntitlementQuery: () => ({ data: undefined }),
}));

const useModelsQueryMock = useModelsQuery as jest.MockedFunction<typeof useModelsQuery>;

const MODELS: ModelsResponse = {
  slots: [
    { key: "editor", role: "Editor", id: "claude-opus-5-5", name: "Claude Opus 5.5" },
    { key: "drafter", role: "Drafter", id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
    { key: "quickDrafts", role: "Quick drafts", id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
  ],
  router: { key: "router", role: "Router", id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", provider: "groq" },
};

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

describe("Settings models section", () => {
  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("shows each pinned model under a Models heading with its raw id", async () => {
    useModelsQueryMock.mockReturnValue({ data: MODELS } as ReturnType<typeof useModelsQuery>);
    renderSettings();
    await act(async () => {});

    expect(screen.getByRole("header", { name: "Models" })).toBeTruthy();
    for (const [label, name, id] of [
      ["Editor", "Claude Opus 5.5", "claude-opus-5-5"],
      ["Drafter", "Claude Sonnet 5.5", "claude-sonnet-5-5"],
      ["Quick drafts", "Claude Haiku 4.5", "claude-haiku-4-5"],
      ["Router", "Llama 3.1 8B (Groq)", "llama-3.1-8b-instant"],
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByText(name)).toBeTruthy();
      expect(screen.getByText(id)).toBeTruthy();
    }
    expect(useModelsQueryMock).toHaveBeenCalledWith({ enabled: true });
  });

  it("translates the heading and role labels instead of showing the server's English", async () => {
    useModelsQueryMock.mockReturnValue({ data: MODELS } as ReturnType<typeof useModelsQuery>);
    await act(async () => {
      await i18n.changeLanguage("es");
    });
    renderSettings();
    await act(async () => {});

    expect(screen.getByRole("header", { name: "Modelos" })).toBeTruthy();
    for (const label of ["Redactor", "Borradores rápidos", "Enrutador"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.queryByText("Drafter")).toBeNull();
    expect(screen.queryByText("Quick drafts")).toBeNull();
    expect(screen.queryByText("Router")).toBeNull();
    expect(screen.getByText("Claude Sonnet 5.5")).toBeTruthy();
  });

  it("leaves the section out while the models are unknown, and drops the router row without Groq", async () => {
    useModelsQueryMock.mockReturnValue({ data: undefined } as ReturnType<typeof useModelsQuery>);
    const { rerender } = renderSettings();
    await act(async () => {});
    expect(screen.queryByRole("header", { name: "Models" })).toBeNull();
    expect(screen.queryByText("Claude Opus 5.5")).toBeNull();

    useModelsQueryMock.mockReturnValue({ data: { ...MODELS, router: null } } as ReturnType<typeof useModelsQuery>);
    const settings = defaultSettings();
    const colors = THEME_PALETTES[settings.theme];
    rerender(
      <AppThemeContext.Provider
        value={{ settings, colors, layout: makeLayout(colors, settings.editorFont), dark: false, patch: jest.fn() }}
      >
        <SettingsScreen />
      </AppThemeContext.Provider>
    );
    await act(async () => {});
    expect(screen.getByText("Claude Opus 5.5")).toBeTruthy();
    expect(screen.queryByText("Router")).toBeNull();
  });
});
