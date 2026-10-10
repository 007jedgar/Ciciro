import { act, fireEvent, render } from "@testing-library/react-native";
import * as SplashScreen from "expo-splash-screen";
import { SplashOverlay } from "../components/SplashOverlay";
import { HANDOFF, handoffClock, resetHandoff, setWelcomeTargets } from "../lib/splash-handoff";

let mockSession: { ready: boolean; user: { id: string } | null } = { ready: false, user: null };
jest.mock("../lib/session", () => ({ useSession: () => mockSession }));
jest.mock("../lib/prefs", () => ({
  getPrefs: () => ({ getString: () => undefined, set: () => {} }),
}));

const targets = {
  bars: [
    { x: 50, y: 500, width: 262 },
    { x: 50, y: 532, width: 230 },
    { x: 50, y: 564, width: 154 },
  ] as [{ x: number; y: number; width: number }, { x: number; y: number; width: number }, { x: number; y: number; width: number }],
  caretTop: 491,
  caretHeight: 24,
};

function mount() {
  return render(<SplashOverlay />);
}

describe("SplashOverlay", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockSession = { ready: false, user: null };
    resetHandoff(false);
  });
  afterEach(() => jest.useRealTimers());

  it("hides the native splash only after its own copy has been laid out and drawn", () => {
    const view = mount();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
    fireEvent(view.root, "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 393, height: 852 } } });
    act(() => {
      jest.advanceTimersByTime(50);
    });
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  });

  it("still frees the native splash if layout never reports", () => {
    mount();
    act(() => {
      jest.advanceTimersByTime(1300);
    });
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
  });

  it("waits for the app to be ready before doing anything", () => {
    mount();
    act(() => {
      jest.advanceTimersByTime(HANDOFF.patienceMs - 100);
    });
    expect(handoffClock.value).toBe(0);
  });

  it("fades off a signed-in author's page at once, with the page already built", () => {
    mockSession = { ready: true, user: { id: "u1" } };
    mount();
    expect(handoffClock.value).toBe(HANDOFF.totalMs);
  });

  it("flies the dots to the welcome card's lines when signed out and the card has said where they are", () => {
    mockSession = { ready: true, user: null };
    setWelcomeTargets(targets);
    mount();
    // The clock plays from 0 (no frame callback runs under Jest, so it stays there).
    expect(handoffClock.value).toBe(0);
  });

  it("fades instead when the card never says where its lines are", () => {
    mockSession = { ready: true, user: null };
    mount();
    expect(handoffClock.value).toBe(0);
    act(() => {
      jest.advanceTimersByTime(HANDOFF.targetsWaitMs + 50);
    });
    expect(handoffClock.value).toBe(HANDOFF.totalMs);
  });

  it("never traps the app behind the splash if it is never ready", () => {
    mount();
    act(() => {
      jest.advanceTimersByTime(HANDOFF.patienceMs + 50);
    });
    expect(handoffClock.value).toBe(HANDOFF.totalMs);
  });
});
