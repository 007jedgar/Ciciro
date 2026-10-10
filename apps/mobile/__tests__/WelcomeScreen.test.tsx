import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { AppState, StyleSheet } from "react-native";
import type { ReactNode } from "react";
import { WelcomeScreen } from "../components/WelcomeScreen";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import i18n from "../lib/i18n";
import { resetHandoff } from "../lib/splash-handoff";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

let mockFocused = true;
let appStateListener: ((state: string) => void) | undefined;
jest.mock("expo-router", () => ({ useIsFocused: () => mockFocused }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({ getString: () => undefined, set: () => {} }),
}));
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}));

// The page is a demonstration a screen reader skips, so it is hidden from the default queries.
const HIDDEN = { includeHiddenElements: true };

/** The page text on show: the card also holds an unseen copy of every kind, only to size itself. */
function onPage(text: string | RegExp) {
  return screen.queryAllByText(text, HIDDEN).filter((node) => {
    for (let n: { parent?: unknown; props?: { testID?: string } } | null = node as never; n; n = (n.parent as never) ?? null) {
      if (n.props?.testID === "welcome-measure") return false;
    }
    return true;
  });
}
const FINAL = "Keep writing the book you’ve been meaning to.";

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

/** Frames wait on a timer each, set only once the last has run: advance in small steps. */
async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 20) {
    await act(async () => {
      jest.advanceTimersByTime(20);
      await Promise.resolve();
    });
  }
}

/** Every string the headline currently shows, joined. */
function headlineText(): string {
  const header = screen.getByRole("header");
  const flat = (node: unknown): string => {
    if (typeof node === "string") return node;
    if (!node || typeof node !== "object") return "";
    const children = (node as { children?: unknown[] }).children ?? [];
    return children.map(flat).join("");
  };
  // The closing space is a no-break one so the last word never wraps alone.
  return flat(header.children[0] as unknown).replace(/\u00a0/g, " ");
}

describe("WelcomeScreen", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    mockFocused = true;
    await i18n.changeLanguage("en");
    resetHandoff(true);
    appStateListener = undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, fn: (state: string) => void) => {
      appStateListener = fn;
      return { remove: jest.fn() };
    }) as never);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("reads the headline to a screen reader as the one finished sentence", () => {
    render(themed(<WelcomeScreen onCreate={jest.fn()} onSignIn={jest.fn()} />));
    expect(screen.getByRole("header").props.accessibilityLabel).toBe(FINAL);
  });

  it("keeps the Create and sign-in actions working", () => {
    const onCreate = jest.fn();
    const onSignIn = jest.fn();
    render(themed(<WelcomeScreen onCreate={onCreate} onSignIn={onSignIn} />));
    fireEvent.press(screen.getByText("Create your account"));
    fireEvent.press(screen.getByText("I already have an account"));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  it("types the page, rewrites the headline and moves on to the next kind", async () => {
    render(themed(<WelcomeScreen onCreate={jest.fn()} onSignIn={jest.fn()} />));
    expect(headlineText()).toBe("Write the book you keep meaning to.");
    await advance(2500);
    expect(onPage(/^The lighthouse had been dark/)).toHaveLength(1);
    let rewritten = false;
    for (let t = 0; t < 12000 && !rewritten; t += 100) {
      await advance(100);
      rewritten = headlineText() === FINAL;
    }
    expect(rewritten).toBe(true);
    let journal = false;
    for (let t = 0; t < 12000 && !journal; t += 100) {
      await advance(100);
      journal = headlineText().includes("journal");
    }
    expect(journal).toBe(true);
    await advance(4000);
    expect(onPage("Thursday, 9 October")).toHaveLength(1);
  });

  it("does not start until the hand-off from the splash is done", async () => {
    resetHandoff(false);
    render(themed(<WelcomeScreen onCreate={jest.fn()} onSignIn={jest.fn()} />));
    await advance(3000);
    expect(onPage(/^The lighthouse/)).toHaveLength(0);
    act(() => resetHandoff(true));
    await advance(2500);
    expect(onPage(/^The lighthouse had been dark/)).toHaveLength(1);
  });

  it("pauses while the screen is not focused and picks up where it stopped", async () => {
    const view = render(themed(<WelcomeScreen onCreate={jest.fn()} onSignIn={jest.fn()} />));
    await advance(600);
    mockFocused = false;
    view.rerender(themed(<WelcomeScreen onCreate={jest.fn()} onSignIn={jest.fn()} />));
    const before = screen.toJSON();
    await advance(5000);
    expect(screen.toJSON()).toEqual(before);
    mockFocused = true;
    view.rerender(themed(<WelcomeScreen onCreate={jest.fn()} onSignIn={jest.fn()} />));
    await advance(3000);
    expect(screen.toJSON()).not.toEqual(before);
  });

  it("pauses while the app is in the background", async () => {
    render(themed(<WelcomeScreen onCreate={jest.fn()} onSignIn={jest.fn()} />));
    await advance(600);
    act(() => appStateListener?.("background"));
    const before = screen.toJSON();
    await advance(5000);
    expect(screen.toJSON()).toEqual(before);
    act(() => appStateListener?.("active"));
    await advance(3000);
    expect(screen.toJSON()).not.toEqual(before);
  });

  it("shows finished pages under Reduce motion and swaps them without typing", async () => {
    render(themed(<WelcomeScreen onCreate={jest.fn()} onSignIn={jest.fn()} />, true));
    expect(headlineText()).toBe(FINAL);
    expect(onPage(/Someone had been keeping it for her\.$/)).toHaveLength(1);
    expect(screen.queryByTestId("welcome-caret")).toBeNull();
    await advance(4200);
    expect(headlineText()).toContain("journal");
    expect(onPage("Thursday, 9 October")).toHaveLength(1);
  });

  it("binds the headline's last word to the one before it, and only that", () => {
    render(themed(<WelcomeScreen onCreate={jest.fn()} onSignIn={jest.fn()} />, true));
    const header = screen.getByRole("header");
    const flat = (node: unknown): string =>
      typeof node === "string"
        ? node
        : ((node as { children?: unknown[] } | null)?.children ?? []).map(flat).join("");
    const raw = flat(header.children[0] as unknown);
    expect(raw.endsWith("meaning to.")).toBe(true);
    expect(raw.match(/ /g)).toHaveLength(1);
  });

  it("holds the card at its tallest kind's height whichever kind is on show", async () => {
    render(themed(<WelcomeScreen onCreate={jest.fn()} onSignIn={jest.fn()} />, true));
    const measure = screen.getByTestId("welcome-measure", HIDDEN);
    const kinds = measure.children as unknown as { props: { onLayout: (e: unknown) => void } }[];
    expect(kinds).toHaveLength(4);
    const heights = [72, 96, 141.2, 120];
    act(() => {
      kinds.forEach((kind, i) => kind.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 300, height: heights[i] } } }));
    });
    // The card is the nearest surface around the measuring copy (it has the rounded corners).
    const cardHeight = () => {
      for (let n = measure.parent; n; n = n.parent) {
        const style = StyleSheet.flatten(n.props.style);
        if (style?.borderRadius === 14) return style.height;
      }
      return undefined;
    };
    // 66 above the copy, the tallest copy rounded up, 30 below.
    expect(cardHeight()).toBe(66 + 142 + 30);
    await advance(4200);
    expect(headlineText()).toContain("journal");
    expect(cardHeight()).toBe(66 + 142 + 30);
  });
});
