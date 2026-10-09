import { act, fireEvent, render, screen } from "@testing-library/react-native";
import DeadlineScreen from "../app/project/[id]/deadline";
import { deadlineSnapshot, type DeadlineSnapshot } from "../lib/deadline-pace";

let mockTarget: { wordGoal: number; deadline: string } | null = null;
let mockSnapshot: DeadlineSnapshot | null = null;
let mockLoaded = true;
let mockError = false;
let mockWords = 0;
const mockSave = jest.fn(async (_: unknown) => ({}));
const mockRemove = jest.fn(async (_: unknown) => ({}));
const mockTrack = jest.fn();
const mockAnnounce = jest.fn();
const mockRefetch = jest.fn();

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
jest.mock("../lib/use-deadline", () => ({
  useDeadline: () => ({
    loaded: mockLoaded,
    target: mockTarget,
    snapshot: mockSnapshot,
    manuscriptWords: mockWords,
    error: mockError,
    refetch: mockRefetch,
  }),
}));
jest.mock("../lib/api", () => ({
  ApiError: class extends Error {},
  useSaveManuscriptTargetMutation: () => ({ mutateAsync: mockSave, isPending: false }),
  useDeleteManuscriptTargetMutation: () => ({ mutateAsync: mockRemove, isPending: false }),
}));
jest.mock("../lib/analytics-client", () => ({ getAnalytics: () => ({ track: mockTrack }) }));
jest.mock("../lib/announce", () => ({ announce: (m: string) => mockAnnounce(m) }));
jest.mock("../lib/app-restart", () => ({ restartApp: jest.fn() }));
jest.mock("../components/AppHeader", () => ({
  AppHeader: () => null,
  useMeasuredAppHeaderHeight: () => [0, () => {}],
}));
jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native");
  return { __esModule: true, default: (props: object) => <View {...props} /> };
});

function setTarget(wordGoal: number, deadline: string, words: number, perDay = 0) {
  mockTarget = { wordGoal, deadline };
  mockWords = words;
  const days = perDay
    ? Array.from({ length: 14 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (i + 1));
        const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return { date, words: perDay };
      })
    : [];
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  mockSnapshot = deadlineSnapshot({ wordGoal, deadline, manuscriptWords: words, days, today });
}

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

beforeEach(() => {
  mockTarget = null;
  mockSnapshot = null;
  mockLoaded = true;
  mockError = false;
  mockWords = 0;
  mockSave.mockClear();
  mockRemove.mockClear();
  mockTrack.mockClear();
  mockAnnounce.mockClear();
});

describe("Deadline screen", () => {
  it("offers a first deadline from the words already written, and saves it", async () => {
    mockWords = 3_200;
    render(<DeadlineScreen />);

    expect(screen.getByText(/Set a due date and a word target/)).toBeTruthy();
    expect(screen.getByTestId("deadline-target-input").props.value).toBe("5000");

    fireEvent.changeText(screen.getByTestId("deadline-target-input"), "60000");
    await act(async () => {
      fireEvent.press(screen.getByTestId("deadline-save"));
    });

    expect(mockSave).toHaveBeenCalledWith({
      projectId: "p1",
      body: { wordGoal: 60_000, deadline: inDays(30) },
    });
    expect(mockTrack).toHaveBeenCalledWith("deadline_saved", { created: true, daysAhead: 30 });
  });

  it("refuses a target that is not a positive number", async () => {
    render(<DeadlineScreen />);
    fireEvent.changeText(screen.getByTestId("deadline-target-input"), "abc");
    await act(async () => {
      fireEvent.press(screen.getByTestId("deadline-save"));
    });
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a word target of at least 1.")).toBeTruthy();
  });

  it("shows progress, days left and what Ciciro makes of the pace", () => {
    setTarget(10_000, inDays(9), 4_000, 300);
    render(<DeadlineScreen />);

    expect(screen.getByText("Due in 9 days")).toBeTruthy();
    expect(screen.getByText("4,000 of 10,000 words")).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.getByTestId("deadline-verdict").props.children).toMatch(
      /A little more pace would help.*about 600 words a day.*about 300/
    );
    expect(screen.getByText("Save changes")).toBeTruthy();
    expect(screen.getByTestId("deadline-save").props.accessibilityState.disabled).toBe(true);
  });

  it("closes the ring with a tick when the target is met", () => {
    setTarget(5_000, inDays(9), 5_200);
    render(<DeadlineScreen />);
    expect(screen.getByText("Target reached")).toBeTruthy();
    expect(screen.queryByText("100%")).toBeNull();
    expect(screen.getByText("You reached your word target. Nicely done.")).toBeTruthy();
  });

  it("saves an edit once the target changes, as an edit", async () => {
    setTarget(10_000, inDays(9), 4_000, 600);
    render(<DeadlineScreen />);
    fireEvent.changeText(screen.getByTestId("deadline-target-input"), "12,000");
    expect(screen.getByTestId("deadline-save").props.accessibilityState.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(screen.getByTestId("deadline-save"));
    });
    expect(mockSave).toHaveBeenCalledWith({
      projectId: "p1",
      body: { wordGoal: 12_000, deadline: inDays(9) },
    });
    expect(mockTrack).toHaveBeenCalledWith("deadline_saved", { created: false, daysAhead: 9 });
  });

  it("asks before removing a deadline", async () => {
    setTarget(10_000, inDays(9), 4_000, 600);
    render(<DeadlineScreen />);

    fireEvent.press(screen.getByTestId("deadline-remove"));
    expect(mockRemove).not.toHaveBeenCalled();
    expect(screen.getByText("Remove this deadline? Your writing is not affected.")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByLabelText("Yes, remove it"));
    });
    expect(mockRemove).toHaveBeenCalledWith("p1");
    expect(mockTrack).toHaveBeenCalledWith("deadline_removed", {});
    expect(mockAnnounce).toHaveBeenCalledWith("Deadline removed.");
  });

  it("recovers from a failed load instead of showing a bare error", () => {
    mockError = true;
    mockLoaded = false;
    render(<DeadlineScreen />);
    expect(screen.getByText("Could not load the deadline.")).toBeTruthy();
    fireEvent.press(screen.getByText("Try again"));
    expect(mockRefetch).toHaveBeenCalled();
  });
});
