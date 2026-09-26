import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SuggestionsPill, SuggestionsSheet } from "../components/SuggestionsReview";
import { AppThemeContext, type AppThemeState } from "../lib/app-theme-context";
import { defaultSettings } from "../lib/app-settings";
import { listSuggestions } from "../lib/suggestions";
import { colors, makeLayout } from "../lib/theme";

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

const theme: AppThemeState = {
  settings: defaultSettings(),
  colors,
  layout: makeLayout(colors),
  dark: false,
  patch: jest.fn(),
};

function wrap(ui: ReactNode) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <AppThemeContext.Provider value={theme}>{ui}</AppThemeContext.Provider>
    </SafeAreaProvider>
  );
}

const AT = new Date(Date.now() - 5 * 60000).toISOString();
const mark = (tag: "ins" | "del", id: string, text: string, name = "Ciciro") =>
  `<${tag} data-suggestion-id="${id}" data-author-id="x" data-author-name="${name}" data-created-at="${AT}">${text}</${tag}>`;

const suggestions = listSuggestions(
  `<p data-block-id="a">She ${mark("del", "s1", "walked slowly")}${mark("ins", "s1", "ambled")} home.</p>` +
    `<p data-block-id="b">${mark("del", "s2", "Nobody")}${mark("ins", "s2", "No one")} answered.</p>`
);

describe("suggestion review on the phone", () => {
  it("says how many changes wait and from whom", () => {
    const onOpen = jest.fn();
    const { unmount } = render(wrap(<SuggestionsPill suggestions={suggestions} onOpen={onOpen} />));
    expect(screen.getByText("2 suggestions from Ciciro")).toBeTruthy();
    fireEvent.press(screen.getByTestId("suggestions-pill"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("renders nothing when there is nothing to review", () => {
    const { unmount } = render(wrap(<SuggestionsPill suggestions={[]} onOpen={jest.fn()} />));
    expect(screen.queryByTestId("suggestions-pill")).toBeNull();
    unmount();
  });

  it("shows each change in context and resolves one at a time", () => {
    const onResolve = jest.fn();
    const { unmount } = render(
      wrap(<SuggestionsSheet visible suggestions={suggestions} onClose={jest.fn()} onResolve={onResolve} />)
    );
    expect(screen.getByText("walked slowly")).toBeTruthy();
    expect(screen.getByText("ambled")).toBeTruthy();
    expect(screen.getAllByText("5m ago")).toHaveLength(2);
    expect(screen.getByLabelText("Ciciro suggests: Replace “walked slowly” with “ambled”")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Accept: Replace “walked slowly” with “ambled”"));
    expect(onResolve).toHaveBeenLastCalledWith("accept", ["s1"]);
    fireEvent.press(screen.getByLabelText("Reject: Replace “Nobody” with “No one”"));
    expect(onResolve).toHaveBeenLastCalledWith("reject", ["s2"]);
    unmount();
  });

  it("accepts or rejects everything at once", () => {
    const onResolve = jest.fn();
    const { unmount } = render(
      wrap(<SuggestionsSheet visible suggestions={suggestions} onClose={jest.fn()} onResolve={onResolve} />)
    );
    fireEvent.press(screen.getByTestId("suggestions-accept-all"));
    expect(onResolve).toHaveBeenLastCalledWith("accept");
    fireEvent.press(screen.getByTestId("suggestions-reject-all"));
    expect(onResolve).toHaveBeenLastCalledWith("reject");
    unmount();
  });

  it("closes itself once the last change is resolved", () => {
    const onClose = jest.fn();
    const { unmount } = render(
      wrap(<SuggestionsSheet visible suggestions={[]} onClose={onClose} onResolve={jest.fn()} />)
    );
    expect(onClose).toHaveBeenCalled();
    unmount();
  });
});
