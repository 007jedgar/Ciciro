import { FlatList } from "react-native";
import { render, screen, within } from "@testing-library/react-native";
import PagesScreen from "../app/project/[id]/pages";

type MockChapter = { id: string; title: string; order: number; content: string };

let mockChapters: MockChapter[] | null = null;
let mockLoading = false;
let mockError: string | null = null;
let mockSelected: string | null = null;

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
    project: mockChapters ? { id: "p1", kind: "screenplay", chapters: mockChapters } : null,
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
});

describe("Pages screen", () => {
  it("sets the script as printed pages, marked Beta, read only, with the page count", () => {
    mockChapters = [sequence("c1", 0, SEQUENCE)];
    render(<PagesScreen />);
    expect(screen.getByText("Pages")).toBeTruthy();
    expect(screen.getByTestId("beta-badge")).toBeTruthy();
    expect(screen.getByText("about 1 page")).toBeTruthy();
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
    expect(screen.queryByText(/about \d+ page/)).toBeNull();
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
});
