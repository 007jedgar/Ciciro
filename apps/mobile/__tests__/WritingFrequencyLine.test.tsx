import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { WritingFrequencyLine } from "../components/WritingFrequencyLine";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { FREQ_HOLD_MS } from "../lib/motion";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({ getString: () => undefined, set: () => {} }),
}));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

function themed(ui: ReactNode, reduceMotion = false) {
  const settings = { ...defaultSettings(), reduceMotion };
  const colors = THEME_PALETTES[settings.theme];
  return (
    <AppThemeContext.Provider
      value={{ settings, colors, layout: makeLayout(colors, settings.editorFont), dark: false, patch: jest.fn() }}
    >
      {ui}
    </AppThemeContext.Provider>
  );
}

/** Advance in small steps: each typed letter waits on a timer that is only set once the last one has resolved. */
async function settle(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 10) {
    await act(async () => {
      jest.advanceTimersByTime(10);
      await Promise.resolve();
    });
  }
}

describe("WritingFrequencyLine", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("says once, twice and N times for the first period with writing in it", () => {
    const { rerender } = render(themed(<WritingFrequencyLine counts={{ week: 1, month: 4, year: 9 }} />));
    expect(screen.getByLabelText("You've written once this week")).toBeTruthy();
    rerender(themed(<WritingFrequencyLine counts={{ week: 2, month: 4, year: 9 }} />));
    expect(screen.getByLabelText(/You've written twice this week/)).toBeTruthy();
    rerender(themed(<WritingFrequencyLine counts={{ week: 5, month: 4, year: 9 }} />));
    expect(screen.getByLabelText(/You've written 5 times this week/)).toBeTruthy();
  });

  it("skips an empty period and leads with the next one", () => {
    render(themed(<WritingFrequencyLine counts={{ week: 0, month: 3, year: 12 }} />));
    expect(screen.getByLabelText("You've written 3 times this month")).toBeTruthy();
  });

  it("shows a gentle line, with nothing to tap, when there is no writing at all", () => {
    render(themed(<WritingFrequencyLine counts={{ week: 0, month: 0, year: 0 }} />));
    expect(screen.getByText("A blank page is a fine place to start.")).toBeTruthy();
    expect(screen.queryByTestId("frequency-line")).toBeNull();
  });

  it("holds, then deletes and types its way to the next period on its own, with the caret", async () => {
    render(themed(<WritingFrequencyLine counts={{ week: 2, month: 6, year: 40 }} />));
    expect(screen.getByLabelText("You've written twice this week")).toBeTruthy();
    expect(screen.queryByTestId("frequency-caret")).toBeNull();

    await settle(FREQ_HOLD_MS + 30);
    // Mid-change the caret is out and the count is being rewritten letter by letter.
    expect(screen.getByTestId("frequency-caret")).toBeTruthy();

    await settle(4000);
    expect(screen.getByLabelText("You've written 6 times this month")).toBeTruthy();
    expect(screen.queryByTestId("frequency-caret")).toBeNull();
    expect(screen.getByText(/6 times/)).toBeTruthy();
    expect(screen.getByText(/this month/)).toBeTruthy();
  });

  it("jumps ahead on a tap", async () => {
    render(themed(<WritingFrequencyLine counts={{ week: 2, month: 6, year: 40 }} />));
    fireEvent.press(screen.getByTestId("frequency-line"));
    await settle(4000);
    expect(screen.getByLabelText("You've written 6 times this month")).toBeTruthy();
  });

  it("with Reduce motion never cycles on its own and swaps instantly on a tap", async () => {
    render(themed(<WritingFrequencyLine counts={{ week: 2, month: 6, year: 40 }} />, true));
    await settle(FREQ_HOLD_MS * 3);
    expect(screen.getByLabelText("You've written twice this week")).toBeTruthy();
    expect(screen.queryByTestId("frequency-caret")).toBeNull();

    fireEvent.press(screen.getByTestId("frequency-line"));
    await settle(0);
    expect(screen.getByText(/6 times/)).toBeTruthy();
    expect(screen.getByLabelText("You've written 6 times this month")).toBeTruthy();
    expect(screen.queryByTestId("frequency-caret")).toBeNull();
  });

  it("does not offer a tap when only one period has writing", () => {
    render(themed(<WritingFrequencyLine counts={{ week: 0, month: 0, year: 7 }} />));
    expect(screen.getByLabelText("You've written 7 times this year")).toBeTruthy();
    expect(screen.getByTestId("frequency-line")).toHaveProp("accessibilityRole", "text");
  });
});
