import { render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import ProjectTabsLayout from "../app/project/[id]/(tabs)/_layout";

const mockTargetGet = jest.fn();
const mockTargetPut = jest.fn();

jest.mock("expo-router", () => {
  const Tabs = ({ children }: { children: ReactNode }) => <>{children}</>;
  Tabs.Screen = () => null;
  return {
    Redirect: () => null,
    Tabs,
    useLocalSearchParams: () => ({ id: "p1" }),
    useRouter: () => ({ push: jest.fn() }),
    useSegments: () => ["project", "[id]", "(tabs)", "manuscript"],
  };
});
jest.mock("../lib/api/resources", () => ({
  ciciro: { projects: { target: { get: mockTargetGet, put: mockTargetPut } } },
}));
jest.mock("../components/ManuscriptTabBar", () => ({ ManuscriptTabBar: () => null }));
jest.mock("../components/WritingMeter", () => ({ WritingMeter: () => null }));
jest.mock("../lib/project", () => ({
  useProject: () => ({
    project: { id: "p1", title: "Book", chapters: [{ id: "c1", wordCount: 1200, archivedAt: null }] },
  }),
}));
jest.mock("../lib/session", () => ({ useSession: () => ({ user: { id: "u1" }, ready: true }) }));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backTo: jest.fn() }) }));
jest.mock("../lib/settings", () => ({
  useAppTheme: () => {
    const { colors, makeLayout } = jest.requireActual("../lib/theme");
    return { colors, layout: makeLayout(colors), settings: { reduceMotion: false } };
  },
}));
jest.mock("../lib/use-reduce-motion", () => ({ useReduceMotion: () => false }));
jest.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 50, bottom: 0, left: 0, right: 0 }),
}));

// The manuscript header once carried a NaNoWriMo "50,000 words by Nov 30"
// line (or a button to set one). Writing goals are gone from the app, so the
// header must neither show one nor ask the server for a stored target, even
// for an author who saved one earlier.
describe("manuscript header writing goal", () => {
  beforeEach(() => {
    mockTargetGet.mockResolvedValue({
      target: { wordGoal: 50000, deadline: "2026-11-30", manuscriptWords: 1200, pace: { pace: 2000, remaining: 48800, complete: false } },
    });
  });

  it("shows no writing goal and never fetches one", async () => {
    render(<ProjectTabsLayout />);
    expect(screen.getByText("Book")).toBeTruthy();
    await waitFor(() => expect(mockTargetGet).not.toHaveBeenCalled());
    expect(screen.queryByText(/target\.|50,?000|Nov/)).toBeNull();
    expect(screen.queryByRole("button", { name: /target\./ })).toBeNull();
    expect(mockTargetPut).not.toHaveBeenCalled();
  });
});
