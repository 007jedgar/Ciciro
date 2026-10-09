import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";
import { getPrefs } from "../lib/prefs";
import { setHapticsEnabled } from "../lib/haptics";
import type { ReactNode } from "react";
import { InfoBubble } from "../components/InfoBubble";
import { WritingMeter } from "../components/WritingMeter";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { makeLayout, THEME_PALETTES } from "../lib/theme";
import { useWritingDay } from "../lib/writing-day-session";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Soft: "soft" },
  NotificationFeedbackType: { Success: "success" },
}));

jest.mock("../lib/prefs", () => {
  const disk = new Map<string, string>();
  return {
    getPrefs: () => ({
      getString: (key: string) => disk.get(key),
      set: (key: string, value: string) => void disk.set(key, value),
      clearAll: () => disk.clear(),
    }),
  };
});

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

jest.mock("../lib/writing-day-session", () => ({
  useWritingDay: jest.fn(() => ({ date: "2026-09-14", words: 40, activeMs: 0 })),
}));

jest.mock("../lib/api", () => ({
  useWritingDaysQuery: jest.fn(() => ({
    data: { days: [{ date: "2026-09-12", words: 100, activeMs: 1_000 }] },
    isPending: false,
    isError: false,
  })),
}));

jest.mock("../lib/session", () => ({
  useSession: () => ({ user: { id: "u1" }, ready: true }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

const useWritingDayMock = useWritingDay as jest.MockedFunction<typeof useWritingDay>;

function themed(ui: ReactNode, settings = defaultSettings()) {
  const colors = THEME_PALETTES[settings.theme];
  return (
    <AppThemeContext.Provider
      value={{
        settings,
        colors,
        layout: makeLayout(colors, settings.editorFont),
        dark: false,
        patch: jest.fn(),
      }}
    >
      {ui}
    </AppThemeContext.Provider>
  );
}

function wrap(ui: ReactNode, settings = defaultSettings()) {
  return render(themed(ui, settings));
}

describe("InfoBubble", () => {
  it("opens a pop-up with the given copy and dismisses it", () => {
    const { unmount } = render(
      <InfoBubble title="What is this?" body="A short explanation." hint="More detail." accessibilityLabel="About this" />
    );

    expect(screen.queryByTestId("info-bubble-popup")).toBeNull();
    fireEvent.press(screen.getByLabelText("About this"));
    expect(screen.getByTestId("info-bubble-popup")).toBeTruthy();
    expect(screen.getByText("What is this?")).toBeTruthy();
    expect(screen.getByText("A short explanation.")).toBeTruthy();
    expect(screen.getByText("More detail.")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Close"));
    expect(screen.queryByTestId("info-bubble-popup")).toBeNull();
    unmount();
  });
});

describe("WritingMeter", () => {
  beforeEach(() => {
    useWritingDayMock.mockReturnValue({ date: "2026-09-14", words: 40, activeMs: 0 });
  });

  it("hides when the daily goal is turned off", () => {
    const { unmount } = wrap(<WritingMeter />, { ...defaultSettings(), showDailyGoal: false });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByTestId("writing-meter-info")).toBeNull();
    unmount();
  });

  it("exposes today's words against the goal on the bar", () => {
    const { unmount } = wrap(<WritingMeter />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveProp("accessibilityLabel", "40 of 250 words today");
    expect(bar).toHaveProp("accessibilityValue", { min: 0, max: 250, now: 40 });
    unmount();
  });

  it("explains the bar in a pop-up with remaining words", () => {
    const { unmount } = wrap(<WritingMeter />);
    fireEvent.press(screen.getByLabelText("About Daily writing goal"));
    expect(screen.getByText("Daily writing goal")).toBeTruthy();
    expect(screen.getByText(/40 of 250 words today/)).toBeTruthy();
    expect(screen.getByText(/210 words left/)).toBeTruthy();
    expect(
      screen.getByText("This bar fills as you write today, from 0 up to your word goal. It resets at midnight.")
    ).toBeTruthy();
    unmount();
  });

  it("says the goal is met once today's words reach the target", () => {
    useWritingDayMock.mockReturnValue({ date: "2026-09-14", words: 250, activeMs: 0 });
    const { unmount } = wrap(<WritingMeter />);
    fireEvent.press(screen.getByLabelText("About Daily writing goal"));
    expect(screen.getByText(/250 of 250 words today/)).toBeTruthy();
    expect(screen.getByText(/Today's goal is met/)).toBeTruthy();
    unmount();
  });

  it("uses the singular remaining copy when one word is left", () => {
    useWritingDayMock.mockReturnValue({ date: "2026-09-14", words: 249, activeMs: 0 });
    const { unmount } = wrap(<WritingMeter />);
    fireEvent.press(screen.getByLabelText("About Daily writing goal"));
    expect(screen.getByText(/1 word left/)).toBeTruthy();
    unmount();
  });
});

describe("WritingMeter goal moment", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setHapticsEnabled(true);
    (getPrefs() as unknown as { clearAll: () => void }).clearAll();
    jest.clearAllMocks();
    useWritingDayMock.mockReturnValue({ date: "2026-09-14", words: 240, activeMs: 0 });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("celebrates once when the day's words cross the goal, not on every render", () => {
    const { rerender, unmount } = wrap(<WritingMeter />);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();

    useWritingDayMock.mockReturnValue({ date: "2026-09-14", words: 250, activeMs: 0 });
    rerender(themed(<WritingMeter />));
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).toHaveBeenCalledWith("soft");

    useWritingDayMock.mockReturnValue({ date: "2026-09-14", words: 300, activeMs: 0 });
    rerender(themed(<WritingMeter />));
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("does not celebrate a goal while the meter is hidden", () => {
    useWritingDayMock.mockReturnValue({ date: "2026-09-14", words: 260, activeMs: 0 });
    const hidden = wrap(<WritingMeter />, { ...defaultSettings(), showDailyGoal: false });
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    hidden.unmount();

    const shown = wrap(<WritingMeter />);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    shown.unmount();
  });

  it("stays quiet for a goal already celebrated today, and speaks again tomorrow", () => {
    useWritingDayMock.mockReturnValue({ date: "2026-09-14", words: 260, activeMs: 0 });
    const first = wrap(<WritingMeter />);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    first.unmount();

    const again = wrap(<WritingMeter />);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    again.unmount();

    useWritingDayMock.mockReturnValue({ date: "2026-09-15", words: 260, activeMs: 0 });
    const tomorrow = wrap(<WritingMeter />);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    tomorrow.unmount();
  });
});
