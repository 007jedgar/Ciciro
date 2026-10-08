import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import ManuscriptsScreen from "../app/manuscripts";
import { ManuscriptTabBar } from "../components/ManuscriptTabBar";
import { newWritingReminder } from "../lib/writing-reminders";

const initialMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function renderInSafeArea(ui: ReactElement) {
  return render(<SafeAreaProvider initialMetrics={initialMetrics}>{ui}</SafeAreaProvider>);
}

const mockPush = jest.fn();
let mockStoredReminders = [newWritingReminder({ id: "wr_existing", projectId: "p1" })];

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
    navigate: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
  useSegments: () => ["project", "p1", "chapters"],
  useIsFocused: () => true,
  Redirect: () => null,
}));

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Warning: "warning" },
}));

jest.mock("../lib/settings", () => {
  const theme = require("../lib/theme") as typeof import("../lib/theme");
  return {
    useAppTheme: () => ({
      colors: theme.colors,
      layout: theme.layout,
      dark: false,
      settings: { reduceMotion: false, autoCorrect: true },
    }),
    useOptionalAppTheme: () => ({ settings: { reduceMotion: false, autoCorrect: true } }),
  };
});

jest.mock("../lib/session", () => ({
  useSession: () => ({
    user: { id: "u1", email: "ada@example.com", name: "Ada" },
    ready: true,
    logout: jest.fn(),
  }),
}));

jest.mock("../lib/api", () => ({
  ApiError: class extends Error {},
  useProjectsQuery: () => ({
    data: [],
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: jest.fn(),
  }),
  useFoldersQuery: () => ({
    data: [],
    isPending: false,
    isRefetching: false,
    error: null,
    refetch: jest.fn(),
  }),
}));

jest.mock("../lib/project", () => ({
  useProject: () => ({
    addChapter: jest.fn(),
    project: { id: "p1", title: "Night Watch" },
  }),
}));

jest.mock("../lib/writing-reminder-store", () => ({
  loadWritingReminders: () => mockStoredReminders,
  useWritingReminderList: () => mockStoredReminders,
  subscribeWritingReminders: () => () => {},
}));

const mockTrack = jest.fn();
jest.mock("../lib/analytics-client", () => ({ getAnalytics: () => ({ track: mockTrack }) }));

describe("adding a writing reminder", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockTrack.mockClear();
    mockStoredReminders = [newWritingReminder({ id: "wr_existing", projectId: "p1" })];
  });

  it("keeps the manuscripts + menu to things you can create", () => {
    renderInSafeArea(<ManuscriptsScreen />);
    fireEvent.press(screen.getByRole("button", { name: "New manuscript", expanded: false }));
    expect(screen.getByLabelText("Import manuscript")).toBeTruthy();
    expect(screen.getByLabelText("New folder")).toBeTruthy();
    expect(screen.queryByLabelText("Writing reminder")).toBeNull();
    expect(screen.queryByLabelText("Writing history")).toBeNull();
  });

  it("fires cta_clicked for the New manuscript menu item, distinct from the + trigger", () => {
    renderInSafeArea(<ManuscriptsScreen />);
    fireEvent.press(screen.getByRole("button", { name: "New manuscript", expanded: false }));
    // The trigger, the empty list's own button, then the menu item.
    const matches = screen.getAllByRole("button", { name: "New manuscript" });
    fireEvent.press(matches[matches.length - 1]);
    expect(mockPush).toHaveBeenCalledWith("/new-manuscript");
    expect(mockTrack).toHaveBeenCalledWith("cta_clicked", { cta: "new_manuscript", surface: "library" });
  });

  it("edits the existing reminder for the current manuscript", () => {
    renderInSafeArea(<ManuscriptTabBar projectId="p1" />);
    fireEvent.press(screen.getByLabelText("Writing tools"));
    fireEvent.press(screen.getByLabelText("Reminder"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/writing-reminder",
      params: { id: "wr_existing", projectId: "p1", projectTitle: "Night Watch" },
    });
  });

  it("creates a reminder when the manuscript has none", () => {
    mockStoredReminders = [];
    renderInSafeArea(<ManuscriptTabBar projectId="p1" />);
    fireEvent.press(screen.getByLabelText("Writing tools"));
    fireEvent.press(screen.getByLabelText("Reminder"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/writing-reminder",
      params: { projectId: "p1", projectTitle: "Night Watch" },
    });
  });

  it("opens the list when the manuscript already has more than one reminder", () => {
    mockStoredReminders = [
      newWritingReminder({ id: "wr_a", projectId: "p1" }),
      newWritingReminder({ id: "wr_b", projectId: "p1" }),
    ];
    renderInSafeArea(<ManuscriptTabBar projectId="p1" />);
    fireEvent.press(screen.getByLabelText("Writing tools"));
    fireEvent.press(screen.getByLabelText("Reminder"));
    expect(mockPush).toHaveBeenCalledWith("/writing-reminders");
  });
});
