import { render, screen } from "@testing-library/react-native";
import { StyleSheet, type ViewStyle } from "react-native";
import ChaptersScreen from "../app/project/[id]/(tabs)/chapters";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useLocalSearchParams: () => ({ id: "p1" }),
}));
jest.mock("../lib/project", () => ({
  useProject: () => ({
    project: { id: "p1", kind: "novel", genre: "Literary fiction", chapters: [] },
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
  usePatchProjectMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
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
jest.mock("../components/ExportCard", () => ({ ExportCard: () => null }));
jest.mock("../components/ChapterListCard", () => ({ ChapterListCard: () => null }));

/** iPhone 17 Pro's point width; the widest a chip can get is the screen less its margins. */
const SCREEN_WIDTH = 402;
/** The landing pop's peak scale in ManuscriptTag. */
const PULSE_PEAK = 1.06;

function horizontalInset(style: unknown, side: "Left" | "Right"): number {
  const s = (StyleSheet.flatten(style as ViewStyle) ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : undefined);
  return pick(`padding${side}`) ?? pick("paddingHorizontal") ?? pick("padding") ?? 0;
}

// The genre chip sits at the top of the chapter list, which clips to its own
// frame. Its save pulse scales from the centre, so it must have room past its
// resting left edge inside that frame, without the chip moving off the
// screen's 20pt content margin.
describe("Chapters screen genre chip", () => {
  it("leaves room inside the list's clip frame for the save pulse, at the same resting margin", () => {
    render(<ChaptersScreen />);
    const chip = screen.getByRole("button", { name: /Literary fiction/i });
    expect(chip).toBeTruthy();

    const list = screen.UNSAFE_root.findAll(
      (n) => n.props.contentContainerStyle !== undefined && n.props.data !== undefined
    )[0];
    const screenView = screen.toJSON() as { props: { style: unknown } };

    const screenLeft = horizontalInset(screenView.props.style, "Left");
    const screenRight = horizontalInset(screenView.props.style, "Right");
    const headroomLeft = horizontalInset(list.props.contentContainerStyle, "Left");
    const headroomRight = horizontalInset(list.props.contentContainerStyle, "Right");

    // Resting position unchanged: content still starts 20pt from each screen edge.
    expect(screenLeft + headroomLeft).toBe(20);
    expect(screenRight + headroomRight).toBe(20);

    // Peak overflow on one side for the widest chip the row can hold.
    const widestChip = SCREEN_WIDTH - 40;
    const overflow = ((PULSE_PEAK - 1) / 2) * widestChip;
    expect(headroomLeft).toBeGreaterThanOrEqual(overflow);
    expect(headroomRight).toBeGreaterThanOrEqual(overflow);
  });
});
