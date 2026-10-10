import { FlatList } from "react-native";
import { render, screen, within } from "@testing-library/react-native";
import PagesScreen from "../app/project/[id]/pages";

type MockChapter = { id: string; title: string; order: number; content: string };

let mockChapters: MockChapter[] | null = null;
let mockLoading = false;
let mockError: string | null = null;
let mockSelected: string | null = null;
let mockScriptSettings: string | undefined;

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "p1" }),
  Redirect: () => null,
}));
jest.mock("../lib/session", () => ({ useSession: () => ({ ready: true, user: { id: "u1" } }) }));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), dark: false, settings: { reduceMotion: false } };
  },
  useOptionalAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: false } };
  },
}));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backOr: jest.fn() }) }));
jest.mock("../lib/project", () => ({
  useProject: () => ({
    project: mockChapters
      ? { id: "p1", kind: "screenplay", chapters: mockChapters, scriptSettings: mockScriptSettings }
      : null,
    loading: mockLoading,
    error: mockError,
    errorDetail: mockError ? "HTTP 500" : null,
    reload: jest.fn(),
    selectedChapterId: mockSelected,
  }),
}));
jest.mock("../lib/app-restart", () => ({ restartApp: jest.fn() }));
jest.mock("../components/AppHeader", () => {
  const { Text, View } = require("react-native");
  return {
    AppHeader: ({ title, accessory }: { title: string; accessory: unknown }) => (
      <View>
        <Text>{title}</Text>
        {accessory as never}
      </View>
    ),
    useMeasuredAppHeaderHeight: () => [0, () => {}],
    useAppHeaderHeight: () => 0,
  };
});

const SEQUENCE = '<p data-sp="scene-heading">INT. LAB - NIGHT</p><p>Rain on the glass.</p>';
const sequence = (id: string, order: number, content: string): MockChapter => ({
  id,
  title: `Sequence ${order + 1}`,
  order,
  content,
});

beforeEach(() => {
  mockChapters = null;
  mockLoading = false;
  mockError = null;
  mockSelected = null;
  mockScriptSettings = undefined;
});

describe("Pages screen", () => {
  it("sets the script as printed pages, marked Beta, read only, with the page count", () => {
    mockChapters = [sequence("c1", 0, SEQUENCE)];
    render(<PagesScreen />);
    expect(screen.getByText("Pages")).toBeTruthy();
    expect(screen.getByTestId("beta-badge")).toBeTruthy();
    expect(screen.getByText("1 page")).toBeTruthy();
    expect(screen.getByText("Read only. Write in the manuscript.")).toBeTruthy();
    expect(screen.getByTestId("script-page-1")).toBeTruthy();
    expect(screen.getByText("INT. LAB - NIGHT")).toBeTruthy();
    expect(screen.getByText("Rain on the glass.")).toBeTruthy();
  });

  it("opens on the top of the writer's sequence: the notes sit above the list, not inside it", () => {
    const long = '<p data-sp="scene-heading">INT. LAB - NIGHT</p>' + "<p>Rain on the glass.</p>".repeat(80);
    mockChapters = [sequence("c1", 0, long), sequence("c2", 1, SEQUENCE)];
    mockSelected = "c2";
    render(<PagesScreen />);
    const list = screen.UNSAFE_getByType(FlatList);
    expect(list.props.initialScrollIndex).toBeGreaterThan(0);
    expect(list.props.ListHeaderComponent).toBeUndefined();
    expect(screen.getByText("Read only. Write in the manuscript.")).toBeTruthy();
    expect(within(screen.getByTestId("script-pages")).queryByText("Read only. Write in the manuscript.")).toBeNull();
  });

  it("says so, instead of drawing a blank page, when nothing is written", () => {
    mockChapters = [sequence("c1", 0, "")];
    render(<PagesScreen />);
    expect(screen.queryByTestId("script-pages")).toBeNull();
    expect(screen.queryByText(/\d+ pages?\b/)).toBeNull();
    expect(screen.getByText(/Nothing on the page yet/)).toBeTruthy();
  });

  it("shows a loading state, then a recoverable error, while there is no manuscript", () => {
    mockLoading = true;
    const { unmount } = render(<PagesScreen />);
    expect(screen.queryByTestId("script-pages")).toBeNull();
    unmount();

    mockLoading = false;
    mockError = "Could not load manuscript.";
    render(<PagesScreen />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByText("Details")).toBeTruthy();
  });

  const exact = { normalizer: (text: string) => text };
  const DUAL =
    '<p data-sp="character">MARA</p><p data-sp="dialogue">I told you.</p>' +
    '<p data-sp="character" data-sp-dual="1">JONAH</p><p data-sp="dialogue">You did.</p>';
  const filler = (count: number) => Array.from({ length: count }, (_, i) => `<p>Filler ${i}.</p>`).join("");
  const longSpeech =
    '<p data-sp="character">MARA</p><p data-sp="dialogue">' +
    Array.from({ length: 12 }, (_, i) => `line${String(i).padStart(2, "0")}`.padEnd(35, "a")).join(" ") +
    "</p>";

  it("sets dual dialogue as two columns on one line", () => {
    mockChapters = [sequence("c1", 0, DUAL)];
    render(<PagesScreen />);
    expect(screen.getByText(/^ {8}MARA {28}JONAH$/, exact)).toBeTruthy();
    expect(screen.getByText(/^I told you\. {21}You did\.$/, exact)).toBeTruthy();
  });

  it("closes a page with (MORE) and opens the next with the cue and (CONT'D)", () => {
    mockChapters = [sequence("c1", 0, filler(24) + longSpeech)];
    render(<PagesScreen />);
    expect(screen.getByText("2 pages")).toBeTruthy();
    expect(screen.getByText(/^ {22}\(MORE\)$/, exact)).toBeTruthy();
    expect(screen.getByText(/^ {22}MARA \(CONT'D\)$/, exact)).toBeTruthy();
  });

  it("follows the script's own settings: no (MORE) or (CONT'D) when they are off", () => {
    mockChapters = [sequence("c1", 0, filler(24) + longSpeech)];
    mockScriptSettings = JSON.stringify({ more: false, contd: false });
    render(<PagesScreen />);
    expect(screen.queryByText(/\(MORE\)/)).toBeNull();
    expect(screen.queryByText(/\(CONT'D\)/)).toBeNull();
  });

  it("numbers the scenes in both margins when the script asks for it", () => {
    mockChapters = [sequence("c1", 0, SEQUENCE)];
    mockScriptSettings = JSON.stringify({ sceneNumbers: true });
    render(<PagesScreen />);
    expect(screen.getByTestId("script-scene-number")).toBeTruthy();
    expect(screen.getAllByText("1")).toHaveLength(2);
  });

  it("leaves the scenes unnumbered otherwise", () => {
    mockChapters = [sequence("c1", 0, SEQUENCE)];
    render(<PagesScreen />);
    expect(screen.queryByTestId("script-scene-number")).toBeNull();
  });
});
