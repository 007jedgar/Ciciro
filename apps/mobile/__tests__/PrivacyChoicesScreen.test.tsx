import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking, Switch } from "react-native";
import i18n from "i18next";
import PrivacyChoicesScreen from "../app/privacy-choices";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import { effectiveAnalyticsAllowed, type ConsentRecord } from "../lib/consent";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Error: "error", Warning: "warning" },
}));
jest.mock("expo-blur", () => ({ BlurView: ({ children }: { children?: unknown }) => children ?? null }));
jest.mock("expo-router", () => ({ Redirect: () => null, useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 40, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backOr: jest.fn() }) }));
let mockUser: { id: string } | null = { id: "u1" };
jest.mock("../lib/session", () => ({ useSession: () => ({ ready: true, user: mockUser }) }));

let mockRecord: ConsentRecord | null = null;
const mockDecide = jest.fn();
jest.mock("../lib/consent", () => ({
  ...jest.requireActual("../lib/consent"),
  useConsent: () => mockRecord,
  decideConsent: (...args: unknown[]) => mockDecide(...args),
}));
let mockMode: "opt-in" | "opt-out" = "opt-in";
jest.mock("../lib/consent-region-store", () => ({
  useConsentMode: () => ({ mode: mockMode, known: true, settled: true }),
}));
const mockSweep = jest.fn();
jest.mock("../lib/analytics-client", () => ({ sweepLegacyAnalyticsIdentity: () => mockSweep() }));

const mockPatch = jest.fn();
let mockAccountEnabled = false;

function renderScreen() {
  const settings = { ...defaultSettings(), analyticsEnabled: mockAccountEnabled };
  const colors = THEME_PALETTES[settings.theme];
  return render(
    <AppThemeContext.Provider
      value={{ settings, colors, layout: makeLayout(colors, settings.editorFont), dark: false, patch: mockPatch }}
    >
      <PrivacyChoicesScreen />
    </AppThemeContext.Provider>
  );
}

const record = (analytics: boolean): ConsentRecord => ({
  version: 1,
  categories: { analytics },
  decidedAt: "2026-03-04T12:00:00.000Z",
});

describe("Privacy choices screen", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  beforeEach(() => {
    mockUser = { id: "u1" };
    mockRecord = null;
    mockMode = "opt-in";
    mockAccountEnabled = false;
    mockDecide.mockReset();
    mockPatch.mockReset();
    mockSweep.mockReset();
  });

  it("shows analytics off, and nothing decided, where the person must opt in", () => {
    renderScreen();
    expect(screen.UNSAFE_getByType(Switch).props.value).toBe(false);
    expect(screen.getByText("You haven't made a choice on this device yet.")).toBeTruthy();
  });

  it("shows analytics on by default in the part of the US that opts out", () => {
    mockMode = "opt-out";
    mockAccountEnabled = true;
    renderScreen();
    expect(screen.UNSAFE_getByType(Switch).props.value).toBe(true);
    expect(screen.getByText(/Analytics is on by default where you are/)).toBeTruthy();
  });

  it("shows analytics off, and why, for an older account that never turned it on", () => {
    mockMode = "opt-out";
    mockAccountEnabled = false;
    renderScreen();
    expect(screen.UNSAFE_getByType(Switch).props.value).toBe(false);
    expect(screen.getByText("Analytics is off for your account. You can turn it on here.")).toBeTruthy();
  });

  it("turns analytics off at once, on the device and the account, and clears the old identity", () => {
    mockMode = "opt-out";
    mockAccountEnabled = true;
    renderScreen();
    fireEvent(screen.UNSAFE_getByType(Switch), "valueChange", false);
    expect(mockSweep).toHaveBeenCalledTimes(1);
    expect(mockDecide).toHaveBeenCalledWith({ analytics: false });
    expect(mockPatch).toHaveBeenCalledWith({ analyticsEnabled: false });
  });

  it("turns analytics on at once, on the device and the account", () => {
    renderScreen();
    fireEvent(screen.UNSAFE_getByType(Switch), "valueChange", true);
    expect(mockDecide).toHaveBeenCalledWith({ analytics: true });
    expect(mockPatch).toHaveBeenCalledWith({ analyticsEnabled: true });
    expect(mockSweep).not.toHaveBeenCalled();
  });

  it("reports the recorded choice with its date", () => {
    mockRecord = record(true);
    mockAccountEnabled = true;
    renderScreen();
    expect(screen.UNSAFE_getByType(Switch).props.value).toBe(true);
    expect(screen.getByText(/You allowed analytics on/)).toBeTruthy();
  });

  it("is off, with the account named, when this device said yes but the account says no", () => {
    mockRecord = record(true);
    mockAccountEnabled = false;
    renderScreen();
    expect(screen.UNSAFE_getByType(Switch).props.value).toBe(false);
    expect(screen.getByText("Analytics is off for your account. You can turn it on here.")).toBeTruthy();
  });

  it("states the promise and links to the privacy policy", () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    renderScreen();
    expect(screen.getByText(/We never sell this data or share it with advertisers or data brokers/)).toBeTruthy();
    fireEvent.press(screen.getByText("Read the privacy policy"));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/\/privacy$/));
  });

  it("agrees with what AnalyticsSync will do for the same state", () => {
    mockMode = "opt-out";
    mockAccountEnabled = true;
    renderScreen();
    expect(
      effectiveAnalyticsAllowed({ record: null, mode: "opt-out", signedIn: true, accountEnabled: true })
    ).toBe(screen.UNSAFE_getByType(Switch).props.value);
  });
});
