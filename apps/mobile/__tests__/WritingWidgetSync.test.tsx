import { render } from "@testing-library/react-native";
import { WritingWidgetSync } from "../components/WritingWidgetSync";
import { SIGNED_OUT_WIDGET_SNAPSHOT } from "../lib/writing-widget";

const mockPublish = jest.fn();
let mockUserId: string | null = null;

jest.mock("../lib/session", () => ({
  useSession: () => ({ user: mockUserId ? { id: mockUserId } : null }),
}));

jest.mock("../lib/settings", () => ({
  useAppTheme: () => ({ settings: { dailyWordGoal: 250, showDailyGoal: true } }),
}));

jest.mock("../lib/writing-day-session", () => ({
  useWritingDay: () => ({ date: "2026-01-05", words: 42, activeMs: 0 }),
}));

jest.mock("../lib/api", () => ({
  useWritingDaysQuery: () => ({ data: { days: [] } }),
}));

jest.mock("../lib/last-place", () => ({
  ...jest.requireActual("../lib/last-place"),
  getLastPlace: () => null,
}));

jest.mock("../lib/writing-widget", () => {
  const actual = jest.requireActual("../lib/writing-widget");
  return {
    ...actual,
    publishWritingWidgetSnapshot: (...args: unknown[]) => mockPublish(...args),
  };
});

describe("WritingWidgetSync", () => {
  beforeEach(() => {
    mockPublish.mockClear();
    mockUserId = null;
  });

  it("publishes the signed-out zero snapshot so the widget's layout registers before any login", () => {
    render(<WritingWidgetSync />);
    expect(mockPublish).toHaveBeenCalledWith(SIGNED_OUT_WIDGET_SNAPSHOT);
  });

  it("publishes real data once someone is signed in", () => {
    mockUserId = "u1";
    render(<WritingWidgetSync />);
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ words: 42, goal: 250, openHref: "/manuscripts" })
    );
  });
});
