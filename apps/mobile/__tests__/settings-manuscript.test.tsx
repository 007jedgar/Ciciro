import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import SettingsScreen from "../app/settings";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import i18n from "../lib/i18n";
import { getScriptLayout, setScriptLayout } from "../lib/script-layout";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

const mockParams: { project?: string } = {};
const mockProject = jest.fn();
const mockPatchProject = jest.fn();

const mockPrefs = new Map<string, string>();
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({
    getString: (key: string) => mockPrefs.get(key),
    set: (key: string, value: string) => {
      mockPrefs.set(key, value);
    },
  }),
}));
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
  usePatchProjectMutation: () => ({ mutate: mockPatchProject, isPending: false }),
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
    mockPatchProject.mockReset();
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
    expect(screen.getByText(/Tab steps through: Action, Character, Dialogue, Parenthetical, Transition, Shot, Centered, Scene heading\./)).toBeTruthy();
    expect(mockProject).toHaveBeenCalledWith("p1", { enabled: true });
  });

  describe("the script's own settings", () => {
    const stored = JSON.stringify({
      titlePage: { title: "NIGHT SHIFT", credit: "", author: "", source: "", draftDate: "", contact: "" },
      showTitlePage: true,
      more: true,
      contd: false,
      sceneNumbers: true,
    });

    function open(scriptSettings?: string) {
      mockParams.project = "p1";
      mockProject.mockReturnValue({
        data: { id: "p1", kind: "screenplay", title: "Night Shift", author: "Mara Quill", scriptSettings },
      });
    }

    it("shows each switch as stored, every one on by default except scene numbers", async () => {
      open(stored);
      await renderSettings();
      expect(screen.getByLabelText("(MORE)").props.value).toBe(true);
      expect(screen.getByLabelText("(CONT'D)").props.value).toBe(false);
      expect(screen.getByLabelText("Scene numbers").props.value).toBe(true);
      expect(screen.getByLabelText("Title page in the PDF").props.value).toBe(true);
    });

    it("starts a script that never saved any from the defaults", async () => {
      open(undefined);
      await renderSettings();
      expect(screen.getByLabelText("(MORE)").props.value).toBe(true);
      expect(screen.getByLabelText("(CONT'D)").props.value).toBe(true);
      expect(screen.getByLabelText("Scene numbers").props.value).toBe(false);
    });

    it("saves a switch with a project PATCH and shows it at once", async () => {
      open(stored);
      await renderSettings();
      fireEvent(screen.getByLabelText("(CONT'D)"), "valueChange", true);
      expect(mockPatchProject).toHaveBeenCalledTimes(1);
      const [vars] = mockPatchProject.mock.calls[0];
      expect(vars.id).toBe("p1");
      expect(vars.body.scriptSettings).toMatchObject({ more: true, contd: true, sceneNumbers: true, showTitlePage: true });
      expect(vars.body.scriptSettings.titlePage.title).toBe("NIGHT SHIFT");
      expect(screen.getByLabelText("(CONT'D)").props.value).toBe(true);
    });

    it("puts a switch back and says so when the server refuses it", async () => {
      open(stored);
      await renderSettings();
      fireEvent(screen.getByLabelText("Scene numbers"), "valueChange", false);
      expect(screen.getByLabelText("Scene numbers").props.value).toBe(false);
      await act(async () => {
        mockPatchProject.mock.calls[0][1].onError(new Error("offline"));
      });
      expect(screen.getByLabelText("Scene numbers").props.value).toBe(true);
      expect(screen.getByText("Couldn't save the script settings.")).toBeTruthy();
    });

    it("edits the title page, falling back to the manuscript's own title and author", async () => {
      open(stored);
      await renderSettings();
      expect(screen.getByLabelText("Title").props.value).toBe("NIGHT SHIFT");
      // A blank author shows the manuscript's, as the PDF sets it.
      expect(screen.getByLabelText("Author").props.placeholder).toBe("Mara Quill");
      const save = screen.getByLabelText("Save title page");
      expect(save.props.accessibilityState.disabled).toBe(true);
      fireEvent.changeText(screen.getByLabelText("Credit"), "Written by");
      fireEvent.changeText(screen.getByLabelText("Contact"), "Mara Quill\nmara@example.com");
      fireEvent.press(screen.getByLabelText("Save title page"));
      expect(mockPatchProject).toHaveBeenCalledTimes(1);
      const { titlePage } = mockPatchProject.mock.calls[0][0].body.scriptSettings;
      expect(titlePage).toMatchObject({ title: "NIGHT SHIFT", credit: "Written by", contact: "Mara Quill\nmara@example.com" });
    });

    it("keeps what is typed on the title page when a switch changes", async () => {
      open(stored);
      await renderSettings();
      fireEvent.changeText(screen.getByLabelText("Source"), "Based on a true story");
      fireEvent(screen.getByLabelText("(MORE)"), "valueChange", false);
      expect(screen.getByLabelText("Source").props.value).toBe("Based on a true story");
    });

    it("shows no switches until the manuscript has loaded", async () => {
      mockParams.project = "p1";
      mockProject.mockReturnValue({ data: undefined });
      await renderSettings();
      expect(screen.queryByLabelText("(MORE)")).toBeNull();
    });
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

  describe("the page layout switch", () => {
    const original = Platform.OS;
    beforeEach(() => {
      mockParams.project = "p1";
      mockProject.mockReturnValue({ data: { id: "p1", kind: "screenplay" } });
    });
    afterEach(async () => {
      Platform.OS = original;
      await act(async () => {
        setScriptLayout(false);
        await i18n.changeLanguage("en");
      });
    });

    it("is off until the author turns it on, and says what it does", async () => {
      await renderSettings();
      expect(screen.getByText("Page layout while typing")).toBeTruthy();
      expect(screen.getByText(/Indents each line as it prints/)).toBeTruthy();
      expect(screen.getByLabelText("Page layout while typing").props.value).toBe(false);
      expect(screen.getByText(/Pages shows the script as it prints, with page numbers\. The phone edits plain lines/)).toBeTruthy();
      expect(getScriptLayout()).toBe(false);

      await act(async () => {
        fireEvent(screen.getByLabelText("Page layout while typing"), "valueChange", true);
      });
      expect(getScriptLayout()).toBe(true);
      expect(screen.getByLabelText("Page layout while typing").props.value).toBe(true);
      expect(screen.getByText(/With page layout on, the editor sets each line/)).toBeTruthy();
    });

    it("is not offered where the editor cannot do it yet", async () => {
      Platform.OS = "android";
      await renderSettings();
      expect(screen.getByText("Script format")).toBeTruthy();
      expect(screen.queryByText("Page layout while typing")).toBeNull();
    });

    it("is grayed out, with an info button, in a language script formatting does not cover", async () => {
      setScriptLayout(true);
      await act(async () => {
        await i18n.changeLanguage("zh");
      });
      await renderSettings();
      const toggle = screen.getByLabelText("输入时显示页面排版");
      expect(toggle.props.disabled).toBe(true);
      expect(toggle.props.value).toBe(false);
      expect(screen.getByTestId("page-layout-language-info")).toBeTruthy();
    });
  });
});
