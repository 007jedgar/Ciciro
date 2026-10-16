import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import i18n from "i18next";
import { ConsentGate } from "../components/ConsentGate";
import { PrivacyChoices } from "../components/PrivacyChoices";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import type { ConsentRecord } from "../lib/consent";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES, type ThemeId } from "../lib/theme";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Error: "error", Warning: "warning" },
}));
jest.mock("../components/GlassSheet", () => ({
  GlassSheet: ({ visible, children }: { visible: boolean; children?: unknown }) => (visible ? children : null),
}));

let mockPath = "/manuscripts";
jest.mock("expo-router", () => ({ usePathname: () => mockPath }));
let mockUser: { id: string } | null = { id: "u1" };
jest.mock("../lib/session", () => ({ useSession: () => ({ ready: true, user: mockUser }) }));

let mockRecord: ConsentRecord | null = null;
const mockDecide = jest.fn();
jest.mock("../lib/consent", () => ({
  ...jest.requireActual("../lib/consent"),
  useConsent: () => mockRecord,
  decideConsent: (...args: unknown[]) => mockDecide(...args),
}));
let mockRegion: { mode: "opt-in" | "opt-out"; known: boolean; settled: boolean } = {
  mode: "opt-in",
  known: true,
  settled: true,
};
jest.mock("../lib/consent-region-store", () => ({ useConsentMode: () => mockRegion }));
const mockSweep = jest.fn();
jest.mock("../lib/analytics-client", () => ({ sweepLegacyAnalyticsIdentity: () => mockSweep() }));

const mockPatch = jest.fn();

function withTheme(node: React.ReactElement, theme: ThemeId = "ciciro") {
  const settings = { ...defaultSettings(), theme };
  const colors = THEME_PALETTES[theme];
  return (
    <AppThemeContext.Provider
      value={{ settings, colors, layout: makeLayout(colors, settings.editorFont), dark: false, patch: mockPatch }}
    >
      {node}
    </AppThemeContext.Provider>
  );
}

const DECIDED: ConsentRecord = { version: 1, categories: { analytics: false }, decidedAt: "2026-01-01T00:00:00.000Z" };

describe("ConsentGate: where the prompt shows", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  beforeEach(() => {
    mockPath = "/manuscripts";
    mockUser = { id: "u1" };
    mockRecord = null;
    mockRegion = { mode: "opt-in", known: true, settled: true };
    mockDecide.mockReset();
    mockPatch.mockReset();
    mockSweep.mockReset();
  });

  it("shows where consent must be asked first", () => {
    render(withTheme(<ConsentGate />));
    expect(screen.getByText("Allow")).toBeTruthy();
    expect(screen.getByText("Don't allow")).toBeTruthy();
  });

  it("shows nothing in the part of the US where analytics defaults on", () => {
    mockRegion = { mode: "opt-out", known: true, settled: true };
    render(withTheme(<ConsentGate />));
    expect(screen.queryByText("Allow")).toBeNull();
  });

  it("waits for the first location lookup instead of flashing", () => {
    mockRegion = { mode: "opt-in", known: false, settled: false };
    render(withTheme(<ConsentGate />));
    expect(screen.queryByText("Allow")).toBeNull();
  });

  it("asks when the location could not be learned", () => {
    mockRegion = { mode: "opt-in", known: false, settled: true };
    render(withTheme(<ConsentGate />));
    expect(screen.getByText("Allow")).toBeTruthy();
  });

  it("does not ask again once decided, signed out, or during the pre-signup quiz", () => {
    mockRecord = DECIDED;
    const decided = render(withTheme(<ConsentGate />));
    expect(screen.queryByText("Allow")).toBeNull();
    decided.unmount();

    mockRecord = null;
    mockUser = null;
    const signedOut = render(withTheme(<ConsentGate />));
    expect(screen.queryByText("Allow")).toBeNull();
    signedOut.unmount();

    mockUser = { id: "u1" };
    mockPath = "/onboarding/goal";
    render(withTheme(<ConsentGate />));
    expect(screen.queryByText("Allow")).toBeNull();
  });
});

describe("PrivacyChoices: the buttons", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  function flat(label: string) {
    let node = screen.getByText(label);
    // The pressable that wraps the label carries the surface style.
    while (node.parent && !node.props.accessibilityRole) node = node.parent;
    return StyleSheet.flatten(node.props.style);
  }

  it.each<ThemeId>(["ciciro", "ciciro-night", "parchment", "ember", "sage"])(
    "makes Allow the primary button and Don't allow the quiet one in %s",
    (theme) => {
      const colors = THEME_PALETTES[theme];
      render(withTheme(<PrivacyChoices analyticsEnabled={false} onDecide={jest.fn()} colors={colors} />, theme));
      const allow = flat("Allow");
      const dontAllow = flat("Don't allow");
      expect(allow.backgroundColor).toBe(colors.accent);
      expect(dontAllow.backgroundColor).toBe(colors.panel);
      expect(dontAllow.backgroundColor).not.toBe(colors.accent);
      expect(dontAllow.borderWidth).toBe(1);
      // Same size, one tap each: neither is easier to reach than the other.
      expect(dontAllow.minHeight).toBe(allow.minHeight);
      expect(dontAllow.flex).toBe(allow.flex);
    }
  );

  it("says what the data is for, and that it is never sold or shared for advertising", () => {
    render(withTheme(<PrivacyChoices analyticsEnabled={false} onDecide={jest.fn()} colors={THEME_PALETTES.ciciro} />));
    expect(screen.getByText(/we never sell it, and we never share it with advertisers or data brokers/)).toBeTruthy();
    expect(screen.getByText(/PostHog, processes it on our behalf/)).toBeTruthy();
  });

  it("reports the choice made", () => {
    const onDecide = jest.fn();
    render(withTheme(<PrivacyChoices analyticsEnabled={false} onDecide={onDecide} colors={THEME_PALETTES.ciciro} />));
    fireEvent.press(screen.getByText("Don't allow"));
    expect(onDecide).toHaveBeenLastCalledWith({ analytics: false });
    fireEvent.press(screen.getByText("Allow"));
    expect(onDecide).toHaveBeenLastCalledWith({ analytics: true });
  });
});

describe("ConsentGate: deciding", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  beforeEach(() => {
    mockPath = "/manuscripts";
    mockUser = { id: "u1" };
    mockRecord = null;
    mockRegion = { mode: "opt-in", known: true, settled: true };
    mockDecide.mockReset();
    mockPatch.mockReset();
    mockSweep.mockReset();
  });

  it("records Allow and writes it through to the account", () => {
    render(withTheme(<ConsentGate />));
    fireEvent.press(screen.getByText("Allow"));
    expect(mockDecide).toHaveBeenCalledWith({ analytics: true });
    expect(mockPatch).toHaveBeenCalledWith({ analyticsEnabled: true });
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("records Don't allow and clears any identity from before the prompt existed", () => {
    render(withTheme(<ConsentGate />));
    fireEvent.press(screen.getByText("Don't allow"));
    expect(mockDecide).toHaveBeenCalledWith({ analytics: false });
    expect(mockSweep).toHaveBeenCalledTimes(1);
  });
});
