import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InfoBubble } from "../components/InfoBubble";
import { WritingMeter } from "../components/WritingMeter";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { makeLayout, THEME_PALETTES } from "../lib/theme";
import { useWritingDay } from "../lib/writing-day-session";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

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

function wrap(ui: ReactNode, settings = defaultSettings()) {
  const colors = THEME_PALETTES[settings.theme];
  return render(
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
