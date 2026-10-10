import { Keyboard } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import ManuscriptScreen from "../app/project/[id]/(tabs)/manuscript";

// A phone keyboard has no dismiss key, so a tap anywhere around the page puts it away.
const mockBlur = jest.fn();
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ setParams: jest.fn(), push: jest.fn(), back: jest.fn() }),
}));
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
jest.mock("../lib/project", () => ({
  useProject: () => ({
    project: { id: "p1", kind: "novel", chapters: [{ id: "c1", title: "One", content: "<p>one</p>" }] },
    loading: false,
    error: null,
    selectedChapterId: "c1",
    setSelectedChapterId: jest.fn(),
    readingPosition: null,
    recordChapterOp: jest.fn(),
    recordReadingPosition: jest.fn(),
    setEditingBlockIds: jest.fn(),
  }),
}));
// The native editor cannot run under jest: stand in with a view that registers a blur-able ref.
jest.mock("../components/ChapterEditor", () => {
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
  ChapterEditor: ({ registerEditor }: { registerEditor: (ref: unknown) => void }) => {
    useEffect(() => {
      registerEditor({ blur: mockBlur, getHTML: async () => "<p>one</p>" });
    }, [registerEditor]);
    return <View testID="chapter-editor" />;
  },
  kindFromEnrichedState: () => "paragraph",
  marksFromEnrichedState: () => [],
  };
});
jest.mock("../lib/use-rename-chapter", () => ({ useRenameChapter: () => jest.fn() }));
jest.mock("../lib/settings", () => ({
  useOptionalAppTheme: () => null,
  useAppTheme: () => ({
    layout: { padded: {}, error: {}, body: {}, screen: {} },
    colors: { ink: "#000" },
    dark: false,
    settings: { editorFont: "serif", editorFontSize: 17 },
  }),
}));
jest.mock("../lib/use-reduce-motion", () => ({ useReduceMotion: () => false }));
jest.mock("../lib/focus-mode", () => ({ useFocusMode: () => false }));
jest.mock("../lib/speech", () => ({
  useDictation: () => ({ listening: false, start: jest.fn(), stop: jest.fn() }),
}));
jest.mock("../components/ManuscriptTabBar", () => ({ useTabBarClearance: () => 0 }));
jest.mock("../components/AppHeader", () => ({ useAppHeaderHeight: () => 0, useMeasuredAppHeaderHeight: () => [0, () => {}] }));
jest.mock("../components/ReaderCommentsPill", () => ({
  ReaderCommentsPill: () => null,
  useChapterReaderCommentCount: () => 0,
}));
jest.mock("../lib/api", () => ({ ciciro: {} }));
jest.mock("../lib/api/hooks", () => ({ useBibleIndexQuery: () => ({ data: undefined }) }));

describe("Manuscript tab keyboard dismiss", () => {
  it("blurs the editor and dismisses the keyboard on a tap around the page", () => {
    const dismiss = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ManuscriptScreen />
      </SafeAreaProvider>
    );
    expect(screen.getByTestId("chapter-editor")).toBeTruthy();
    fireEvent.press(screen.getByTestId("editor-surround"));
    expect(mockBlur).toHaveBeenCalled();
    expect(dismiss).toHaveBeenCalled();
    dismiss.mockRestore();
  });
});
