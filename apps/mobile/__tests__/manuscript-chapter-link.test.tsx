import { render } from "@testing-library/react-native";
import ManuscriptScreen from "../app/project/[id]/(tabs)/manuscript";

// The "Ciciro finished writing" push opens /project/:id/manuscript?chapterId=…;
// the manuscript tab must land on that chapter, not the last one selected.
const mockParams: { chapterId?: string } = {};
const mockSetParams = jest.fn();
const mockSetSelectedChapterId = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ setParams: mockSetParams, push: jest.fn(), back: jest.fn() }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
jest.mock("../lib/project", () => ({
  useProject: () => ({
    project: {
      id: "p1",
      kind: "novel",
      chapters: [
        { id: "c1", title: "One", content: "<p>one</p>" },
        { id: "c2", title: "Two", content: "<p>two</p>" },
      ],
    },
    loading: false,
    // The error branch renders without the native editor; the link is applied
    // by an effect that runs regardless of which branch renders.
    error: "offline",
    selectedChapterId: "c1",
    setSelectedChapterId: mockSetSelectedChapterId,
    readingPosition: null,
    recordChapterOp: jest.fn(),
    recordReadingPosition: jest.fn(),
    setEditingBlockIds: jest.fn(),
  }),
}));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => ({
    layout: { padded: {}, error: {}, body: {}, screen: {} },
    colors: { ink: "#000" },
    settings: { editorFont: "serif", editorFontSize: 17 },
  }),
}));
jest.mock("../lib/use-reduce-motion", () => ({ useReduceMotion: () => false }));
jest.mock("../lib/focus-mode", () => ({ useFocusMode: () => false }));
jest.mock("../lib/speech", () => ({
  useDictation: () => ({ listening: false, start: jest.fn(), stop: jest.fn() }),
}));
jest.mock("../components/ManuscriptTabBar", () => ({ useTabBarClearance: () => 0 }));
jest.mock("../components/AppHeader", () => ({ useAppHeaderHeight: () => 0 }));
jest.mock("../components/ReaderCommentsPill", () => ({
  ReaderCommentsPill: () => null,
  useChapterReaderCommentCount: () => 0,
}));
jest.mock("../lib/api", () => ({ ciciro: {} }));

describe("Manuscript tab chapter link", () => {
  beforeEach(() => {
    delete mockParams.chapterId;
    mockSetParams.mockClear();
    mockSetSelectedChapterId.mockClear();
  });

  it("opens the chapter a notification links to, then clears the link", () => {
    mockParams.chapterId = "c2";
    render(<ManuscriptScreen />);
    expect(mockSetSelectedChapterId).toHaveBeenCalledWith("c2");
    expect(mockSetParams).toHaveBeenCalledWith({ chapterId: undefined });
  });

  it("ignores a link to a chapter the manuscript does not have", () => {
    mockParams.chapterId = "gone";
    render(<ManuscriptScreen />);
    expect(mockSetSelectedChapterId).not.toHaveBeenCalled();
  });

  it("leaves the selection alone without a link", () => {
    render(<ManuscriptScreen />);
    expect(mockSetSelectedChapterId).not.toHaveBeenCalled();
    expect(mockSetParams).not.toHaveBeenCalled();
  });
});
