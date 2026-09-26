import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { ActivityIndicator } from "react-native";
import ChaptersScreen from "../app/project/[id]/(tabs)/chapters";

let mockResolvePick: (file: null) => void = () => {};
const mockPickImportFile = jest.fn(() => new Promise<null>((resolve) => (mockResolvePick = resolve)));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({ id: "p1" }),
}));
jest.mock("../lib/import", () => ({
  pickImportFile: () => mockPickImportFile(),
  isImportable: () => true,
  importManuscriptFile: jest.fn(),
}));
jest.mock("../lib/project", () => ({
  useProject: () => ({
    project: { id: "p1", kind: "novel", genre: null, chapters: [] },
    loading: false,
    error: null,
    selectedChapterId: null,
    setSelectedChapterId: jest.fn(),
    flushEdits: jest.fn(async () => true),
    addChapter: jest.fn(),
  }),
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
  useOptionalAppTheme: () => ({ settings: { reduceMotion: false } }),
}));
jest.mock("../components/AppHeader", () => ({ useAppHeaderHeight: () => 0 }));
jest.mock("../components/ManuscriptTabBar", () => ({ useTabBarClearance: () => 0 }));
jest.mock("../components/PreviouslyOnCard", () => ({ PreviouslyOnCard: () => null }));
jest.mock("../components/ManuscriptTag", () => ({ ManuscriptTag: () => null }));
jest.mock("../components/ExportCard", () => ({ ExportCard: () => null }));
jest.mock("../components/ChapterListCard", () => ({ ChapterListCard: () => null }));

// The system file picker takes a beat to appear; the card must show it is
// working from the press, not only once an upload starts.
describe("Import chapters card", () => {
  it("shows a spinner and a busy state while the file picker is opening", async () => {
    render(<ChaptersScreen />);
    const card = screen.getByRole("button", { name: "Import chapters" });
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);

    fireEvent.press(card);

    expect(mockPickImportFile).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Importing…")).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(1);
    expect(card.props.accessibilityState).toMatchObject({ busy: true, disabled: true });

    // A second press while the picker is still opening does nothing.
    fireEvent.press(card);
    expect(mockPickImportFile).toHaveBeenCalledTimes(1);

    // Cancelling the picker returns the card to rest.
    await act(async () => mockResolvePick(null));
    expect(screen.getByText("Import chapters")).toBeTruthy();
    expect(screen.UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });
});
