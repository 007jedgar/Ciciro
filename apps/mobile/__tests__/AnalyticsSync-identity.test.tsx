import { useEffect, useRef, type ReactNode } from "react";
import { render } from "@testing-library/react-native";
import { AnalyticsSync } from "../components/AnalyticsSync";
import { getAnalytics } from "../lib/analytics-client";
import { followIdentity } from "../lib/analytics-events";

process.env.EXPO_PUBLIC_POSTHOG_KEY = "phc_test";

const mockCalls: string[] = [];
jest.mock("../lib/analytics-posthog-native", () => ({
  createPostHogNativeAdapter: () => ({
    identify: (id: string) => mockCalls.push(`identify:${id}`),
    reset: () => mockCalls.push("reset"),
    track: () => mockCalls.push("track"),
    screen: () => mockCalls.push("screen"),
    registerSuperProperties: () => {},
    setOptedOut: (optedOut: boolean) => mockCalls.push(optedOut ? "optOut" : "optIn"),
    deleteUser: () => {},
  }),
}));
jest.mock("expo-router", () => ({ usePathname: () => "/manuscripts" }));

let mockUser: { id: string } | null = null;
let mockAccountEnabled = false;
let mockMode: "opt-in" | "opt-out" = "opt-out";
jest.mock("../lib/session", () => ({ useSession: () => ({ user: mockUser }) }));
jest.mock("../lib/settings", () => ({ useAppTheme: () => ({ settings: { analyticsEnabled: mockAccountEnabled } }) }));
jest.mock("../lib/consent", () => ({ ...jest.requireActual("../lib/consent"), useConsent: () => null }));
jest.mock("../lib/consent-region-store", () => ({
  useConsentMode: () => ({ mode: mockMode, settled: true, known: true }),
  refreshRegion: () => Promise.resolve(),
  refreshRegionIfStale: () => Promise.resolve(),
}));

// Mirrors SessionProvider: it wraps AnalyticsSync, so its identify effect runs after AnalyticsSync's.
function Session({ userId, children }: { userId: string | null; children: ReactNode }) {
  const identity = useRef<string | null>(null);
  useEffect(() => {
    identity.current = followIdentity(getAnalytics(), identity.current, userId);
  }, [userId]);
  return <>{children}</>;
}

function tree(userId: string | null) {
  return (
    <Session userId={userId}>
      <AnalyticsSync />
    </Session>
  );
}

describe("AnalyticsSync and the signed-in identity", () => {
  beforeEach(() => {
    mockCalls.length = 0;
    mockUser = null;
    mockAccountEnabled = false;
    mockMode = "opt-out";
  });

  it("keeps a new account identified while its own setting still reads off", () => {
    mockMode = "opt-in";
    const view = render(tree(null));
    mockMode = "opt-out";
    view.rerender(tree(null));
    mockCalls.length = 0;

    mockUser = { id: "u-new" };
    view.rerender(tree("u-new"));
    mockAccountEnabled = true;
    view.rerender(tree("u-new"));

    expect(mockCalls).not.toContain("reset");
    expect(mockCalls).toContain("identify:u-new");
    expect(mockCalls[mockCalls.length - 1]).not.toBe("optOut");
  });

  it("identifies the signed-in account when the device's grant arrives after sign-in", () => {
    mockMode = "opt-in";
    mockUser = { id: "u1" };
    const view = render(tree("u1"));
    mockCalls.length = 0;

    mockMode = "opt-out";
    mockAccountEnabled = true;
    view.rerender(tree("u1"));

    expect(mockCalls).toContain("identify:u1");
    expect(mockCalls).not.toContain("reset");
  });
});
