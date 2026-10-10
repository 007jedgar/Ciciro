import { fireEvent, render, screen } from "@testing-library/react-native";
import ChaptersScreen from "../app/project/[id]/(tabs)/chapters";

type MockChapter = { id: string; title: string; order: number; status: string; content: string; revision: number; wordCount: number };
type MockProject = { id: string; kind: string; genre: string | null; chapters: MockChapter[] };

let mockProject: MockProject | null = null;
let mockError: string | null = null;
let mockErrorDetail: string | null = null;
const mockPush = jest.fn();
const mockReload = jest.fn(async (): Promise<boolean> => mockError === null);

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, navigate: jest.fn() }),
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
jest.mock("../components/AppHeader", () => ({ useAppHeaderHeight: () => 0, useMeasuredAppHeaderHeight: () => [0, () => {}] }));
jest.mock("../components/ManuscriptTabBar", () => ({ useTabBarClearance: () => 0 }));
jest.mock("../components/PreviouslyOnCard", () => ({ PreviouslyOnCard: () => null }));
jest.mock("../components/DeadlineCard", () => ({ DeadlineCard: () => null }));
jest.mock("../components/ManuscriptTag", () => ({ ManuscriptTag: () => null }));
jest.mock("../components/ExportCard", () => ({ ExportCard: () => null }));
jest.mock("../components/ChapterListCard", () => {
  const { Text } = jest.requireActual("react-native");
  return { ChapterListCard: ({ chapter }: { chapter: { title: string } }) => <Text>{chapter.title}</Text> };
});


const PAGE = '<p data-sp="scene-heading">INT. LAB - NIGHT</p><p>Rain on the glass.</p><p data-sp="character">MARA</p><p data-sp="dialogue">Stay quiet.</p>';

function sequence(id: string, order: number, content: string): MockChapter {
  return { id, title: `Sequence ${order + 1}`, order, status: "", content, revision: 1, wordCount: 9 };
}

beforeEach(() => {
  mockProject = null;
  mockError = null;
  mockErrorDetail = null;
  mockPush.mockClear();
});

describe("Chapters screen, screenplay pages", () => {
  it("opens the page view from its tile and counts the pages next to the words", () => {
    mockProject = { id: "p1", kind: "screenplay", genre: null, chapters: [sequence("c1", 0, PAGE)] };
    render(<ChaptersScreen />);
    fireEvent.press(screen.getByLabelText("Pages"));
    expect(mockPush).toHaveBeenCalledWith("/project/p1/pages");
    expect(screen.getByLabelText("Chapters, 1 entry / 9 words / about 1 page")).toBeTruthy();
  });

  it("leaves pages out of the count until something is typed", () => {
    mockProject = {
      id: "p1",
      kind: "screenplay",
      genre: null,
      chapters: [{ ...sequence("c1", 0, '<p data-sp="scene-heading"></p>'), wordCount: 0 }],
    };
    render(<ChaptersScreen />);
    expect(screen.getByLabelText("Chapters, 1 entry / 0 words")).toBeTruthy();
  });

  it("offers no page view and no pages for any other kind", () => {
    mockProject = { id: "p1", kind: "novel", genre: null, chapters: [sequence("c1", 0, "<p>Plain prose.</p>")] };
    render(<ChaptersScreen />);
    expect(screen.queryByLabelText("Pages")).toBeNull();
    expect(screen.queryByText(/about \d+ page/)).toBeNull();
  });
});
