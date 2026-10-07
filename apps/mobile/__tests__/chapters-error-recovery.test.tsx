import { act, fireEvent, render, screen } from "@testing-library/react-native";
import ChaptersScreen from "../app/project/[id]/(tabs)/chapters";

type MockChapter = { id: string; title: string; order: number; status: string };
type MockProject = { id: string; kind: string; genre: string | null; chapters: MockChapter[] };

let mockProject: MockProject | null = null;
let mockError: string | null = null;
let mockErrorDetail: string | null = null;
const mockReload = jest.fn(async () => {});

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({ id: "p1" }),
}));
jest.mock("../lib/project", () => ({
  useProject: () => ({
    project: mockProject,
    loading: false,
    error: mockError,
    errorDetail: mockErrorDetail,
    reload: mockReload,
    selectedChapterId: null,
    setSelectedChapterId: jest.fn(),
    flushEdits: jest.fn(async () => true),
    addChapter: jest.fn(),
  }),
}));
jest.mock("../lib/import", () => ({
  pickImportFile: jest.fn(),
  isImportable: () => true,
  importManuscriptFile: jest.fn(),
}));
jest.mock("../lib/api", () => ({
  ApiError: class extends Error {},
  queryClient: { setQueryData: jest.fn(), invalidateQueries: jest.fn() },
  queryKeys: { projects: { detail: (id: string) => ["projects", id] } },
  useDeleteChapterMutation: () => ({ mutateAsync: jest.fn() }),
  usePatchChapterMutation: () => ({ mutateAsync: jest.fn() }),
  usePatchProjectMutation: () => ({ mutateAsync: jest.fn() }),
  useShareCommentsQuery: () => ({ data: [] }),
  useWeeklyReviewsQuery: () => ({ data: null }),
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
jest.mock("../components/AppHeader", () => ({ useAppHeaderHeight: () => 0 }));
jest.mock("../components/ManuscriptTabBar", () => ({ useTabBarClearance: () => 0 }));
jest.mock("../components/PreviouslyOnCard", () => ({ PreviouslyOnCard: () => null }));
jest.mock("../components/ManuscriptTag", () => ({ ManuscriptTag: () => null }));
jest.mock("../components/ExportCard", () => ({ ExportCard: () => null }));
jest.mock("../components/ChapterListCard", () => {
  const { Text } = jest.requireActual("react-native");
  return { ChapterListCard: ({ chapter }: { chapter: { title: string } }) => <Text>{chapter.title}</Text> };
});

function chapter(id: string, title: string, order: number): MockChapter {
  return { id, title, order, status: "" };
}

/** Drains the microtask queue past `await reload()` in the screen's retry handler. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  mockProject = null;
  mockError = null;
  mockErrorDetail = null;
  mockReload.mockClear();
  mockReload.mockImplementation(async () => {});
});

describe("Chapters screen error recovery", () => {
  // The bug this guards: the screen used to swap to an error-only view the
  // instant `error` was set, even with a perfectly good cached `project` -
  // losing the whole chapter list to a transient background refetch failure
  // with no way back except leaving the screen. Cached content must stay up,
  // with a recoverable banner alongside it instead.
  it("keeps showing cached chapters next to a recoverable banner instead of blanking the screen", async () => {
    mockProject = { id: "p1", kind: "novel", genre: null, chapters: [chapter("c1", "Chapter One", 0)] };
    mockError = "Could not load manuscript.";
    mockErrorDetail = "500: upstream timeout at db.internal";

    render(<ChaptersScreen />);

    expect(screen.getByText("Chapter One")).toBeTruthy();
    expect(screen.getByText("Could not load manuscript.")).toBeTruthy();
    expect(screen.queryByText("No chapters yet.")).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Try again" }));
      await flushMicrotasks();
    });
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it("shows the full recoverable state, with no empty-chapters text, when there is nothing cached to show", () => {
    mockProject = null;
    mockError = "Could not load manuscript.";
    mockErrorDetail = "401: session expired";

    render(<ChaptersScreen />);

    expect(screen.getByText("Could not load manuscript.")).toBeTruthy();
    expect(screen.queryByText("No chapters yet.")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("Try again refetches and clears the error once it resolves", async () => {
    mockProject = null;
    mockError = "Could not load manuscript.";
    mockReload.mockImplementation(async () => {
      mockProject = { id: "p1", kind: "novel", genre: null, chapters: [chapter("c1", "Chapter One", 0)] };
      mockError = null;
    });

    const { rerender } = render(<ChaptersScreen />);
    expect(screen.getByText("Could not load manuscript.")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Try again" }));
      await flushMicrotasks();
    });
    rerender(<ChaptersScreen />);

    expect(screen.queryByText("Could not load manuscript.")).toBeNull();
    expect(screen.getByText("Chapter One")).toBeTruthy();
  });

  it("offers Restart app only after a retry has already failed", async () => {
    mockProject = null;
    mockError = "Could not load manuscript.";
    // The retry itself fails too: the error never clears.
    mockReload.mockImplementation(async () => {});

    render(<ChaptersScreen />);
    expect(screen.queryByRole("button", { name: "Restart app" })).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Try again" }));
      await flushMicrotasks();
    });

    expect(screen.getByRole("button", { name: "Restart app" })).toBeTruthy();
  });
});
