import { act, fireEvent, render, screen } from "@testing-library/react-native";
import ManuscriptsScreen from "../app/manuscripts";
import { ApiError } from "../lib/api";

type Project = { id: string; title: string; folderId: string | null; kind: string; _count: { chapters: number } };

let mockSession = { user: { id: "u1" } as { id: string } | null, ready: true };
let mockProjectsData: Project[] | undefined;
let mockProjectsError: Error | null = null;
let mockFoldersData: unknown[] | undefined = [];
let mockFoldersError: Error | null = null;
const mockProjectsRefetch = jest.fn(async () => ({ isError: mockProjectsError !== null }));
const mockFoldersRefetch = jest.fn(async () => ({ isError: mockFoldersError !== null }));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  Redirect: () => null,
  useIsFocused: () => true,
}));
jest.mock("../lib/session", () => ({ useSession: () => mockSession }));
jest.mock("../lib/api", () => ({
  ApiError: class extends Error {},
  useProjectsQuery: () => ({
    data: mockProjectsData,
    isPending: false,
    error: mockProjectsError,
    refetch: mockProjectsRefetch,
  }),
  useFoldersQuery: () => ({
    data: mockFoldersData,
    isPending: false,
    error: mockFoldersError,
    refetch: mockFoldersRefetch,
  }),
}));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: false } };
  },
  useOptionalAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: false } };
  },
}));
jest.mock("../lib/app-restart", () => ({ restartApp: jest.fn(async () => {}) }));
jest.mock("../components/AppHeader", () => ({ AppHeader: () => null, useAppHeaderHeight: () => 0 }));
jest.mock("../components/HeaderNewMenu", () => ({ HeaderNewMenu: () => null }));
jest.mock("../lib/import", () => ({
  importManuscriptFile: jest.fn(),
  isImportable: () => true,
  pickImportFile: jest.fn(),
}));
jest.mock("../lib/analytics-client", () => ({ getAnalytics: () => ({ track: jest.fn() }) }));

function project(id: string, title: string): Project {
  return { id, title, folderId: null, kind: "novel", _count: { chapters: 1 } };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  mockSession = { user: { id: "u1" }, ready: true };
  mockProjectsData = undefined;
  mockProjectsError = null;
  mockFoldersData = [];
  mockFoldersError = null;
  mockProjectsRefetch.mockClear();
  mockFoldersRefetch.mockClear();
  mockProjectsRefetch.mockImplementation(async () => ({ isError: mockProjectsError !== null }));
  mockFoldersRefetch.mockImplementation(async () => ({ isError: mockFoldersError !== null }));
});

describe("Manuscripts screen error recovery", () => {
  it("shows the full recoverable state with no manuscripts when the lists fail to load", () => {
    mockProjectsError = new ApiError("500: upstream timeout");

    render(<ManuscriptsScreen />);

    expect(screen.getByText("Could not load manuscripts.")).toBeTruthy();
    expect(screen.queryByText(/do not need the web app/)).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps showing cached manuscripts next to a recoverable banner, not a blank list", () => {
    mockProjectsData = [project("a", "Alpha")];
    mockProjectsError = new ApiError("500: upstream timeout");

    render(<ManuscriptsScreen />);

    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Could not load manuscripts.")).toBeTruthy();
  });

  it("Try again refetches both queries and clears the error once they resolve", async () => {
    mockProjectsError = new ApiError("500: upstream timeout");
    mockProjectsRefetch.mockImplementation(async () => {
      mockProjectsData = [project("a", "Alpha")];
      mockProjectsError = null;
      return { isError: false };
    });

    const { rerender } = render(<ManuscriptsScreen />);
    expect(screen.getByText("Could not load manuscripts.")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Try again" }));
      await flushMicrotasks();
    });
    rerender(<ManuscriptsScreen />);

    expect(mockProjectsRefetch).toHaveBeenCalledTimes(1);
    expect(mockFoldersRefetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Could not load manuscripts.")).toBeNull();
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("offers Restart app only after a retry has already failed", async () => {
    mockProjectsError = new ApiError("500: upstream timeout");

    render(<ManuscriptsScreen />);
    expect(screen.queryByRole("button", { name: "Restart app" })).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Try again" }));
      await flushMicrotasks();
    });

    expect(screen.getByRole("button", { name: "Restart app" })).toBeTruthy();
  });
});
