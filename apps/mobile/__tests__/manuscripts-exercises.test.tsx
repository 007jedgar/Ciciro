import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import ManuscriptsScreen from "../app/manuscripts";

type Project = { id: string; title: string; folderId: string | null; kind: string; _count: { chapters: number } };

const mockPush = jest.fn();
const mockTrack = jest.fn();
let mockProjectsData: Project[] = [];

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  Redirect: () => null,
  useIsFocused: () => true,
}));
jest.mock("../lib/session", () => ({ useSession: () => ({ user: { id: "u1" }, ready: true }) }));
jest.mock("../lib/api", () => ({
  ApiError: class extends Error {},
  useProjectsQuery: () => ({ data: mockProjectsData, isPending: false, error: null, refetch: jest.fn() }),
  useFoldersQuery: () => ({ data: [], isPending: false, error: null, refetch: jest.fn() }),
}));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: true } };
  },
  useOptionalAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: true } };
  },
}));
jest.mock("../components/AppHeader", () => ({
  AppHeader: () => null,
  useAppHeaderHeight: () => 0,
  useMeasuredAppHeaderHeight: () => [0, () => {}],
}));
// The "+" menu stands in as one button per item, so the entry can be read and pressed.
jest.mock("../components/HeaderNewMenu", () => {
  const { Pressable } = jest.requireActual("react-native");
  return {
    HeaderNewMenu: ({ items }: { items: { key: string; label: string; onPress: () => void }[] }): ReactNode =>
      items.map((item) => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.label} onPress={item.onPress} />),
  };
});
jest.mock("../lib/import", () => ({ importManuscriptFile: jest.fn(), isImportable: () => true, pickImportFile: jest.fn() }));
jest.mock("../lib/analytics-client", () => ({ getAnalytics: () => ({ track: mockTrack }) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockProjectsData = [];
});

describe("Finding the writing exercises in the library", () => {
  it("offers them in the + menu, by their plural name", () => {
    render(<ManuscriptsScreen />);
    fireEvent.press(screen.getByRole("button", { name: "Writing exercises" }));
    expect(mockPush).toHaveBeenCalledWith("/writing-exercise");
    expect(mockTrack).toHaveBeenCalledWith("cta_clicked", { cta: "writing_exercise", surface: "library" });
  });

  it("offers them under the first manuscript button of an empty library", () => {
    render(<ManuscriptsScreen />);
    fireEvent.press(screen.getByRole("button", { name: "Or try a writing exercise" }));
    expect(mockPush).toHaveBeenCalledWith("/writing-exercise");
    expect(mockTrack).toHaveBeenCalledWith("cta_clicked", { cta: "writing_exercise", surface: "library_empty" });
  });

  it("keeps that empty-state link out of a library that has manuscripts", () => {
    mockProjectsData = [{ id: "a", title: "Alpha", folderId: null, kind: "novel", _count: { chapters: 1 } }];
    render(<ManuscriptsScreen />);
    expect(screen.queryByRole("button", { name: "Or try a writing exercise" })).toBeNull();
    expect(screen.getByRole("button", { name: "Writing exercises" })).toBeTruthy();
  });
});
