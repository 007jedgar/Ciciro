import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import { SafeAreaProvider } from "react-native-safe-area-context";
import PaywallScreen from "../app/paywall";
import SettingsScreen from "../app/settings";
import DeleteAccountScreen from "../app/delete-account";
import { ChatErrorNotice } from "../components/ChatErrorNotice";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import type { Entitlement } from "../lib/api/types";
import "../lib/i18n";
import { makeLayout, THEME_PALETTES } from "../lib/theme";

const mockPush = jest.fn();
const mockEntitlementQuery = jest.fn();
const mockEntitlement = jest.fn();
const mockSync = jest.fn();
const mockBuy = jest.fn();
const mockRestore = jest.fn();
const mockOpenStore = jest.fn();
const mockLoadPackages = jest.fn();
let mockStoreAvailable = true;

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success", Error: "error" },
}));
jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  router: { push: (...args: unknown[]) => mockPush(...args) },
  Redirect: () => null,
  useFocusEffect: () => {},
}));
jest.mock("../lib/use-stack-back", () => ({ useStackBack: () => ({ backOr: jest.fn() }) }));
jest.mock("../components/AppHeader", () => ({ AppHeader: () => null, useAppHeaderHeight: () => 0 }));
jest.mock("../components/GlassSheet", () => ({ GlassSheet: () => null }));
jest.mock("../lib/session", () => ({
  useSession: () => ({
    user: { id: "u1", email: "writer@example.com" },
    ready: true,
    logout: jest.fn(),
    deleteAccount: jest.fn(),
  }),
}));
jest.mock("../lib/writing-reminder-notifications", () => ({
  getReminderPermission: jest.fn(async () => "granted"),
}));
jest.mock("../lib/writing-reminder-store", () => ({ useWritingReminderList: () => [] }));
jest.mock("../lib/use-export-account-data", () => ({
  useExportAccountData: () => ({ busy: false, run: jest.fn() }),
}));
jest.mock("../lib/api/hooks", () => ({
  useModelsQuery: () => ({ data: undefined }),
  useEntitlementQuery: (...args: unknown[]) => mockEntitlementQuery(...args),
}));
jest.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  ciciro: {
    billing: {
      entitlement: (...args: unknown[]) => mockEntitlement(...args),
      sync: (...args: unknown[]) => mockSync(...args),
    },
  },
  queryClient: { setQueryData: jest.fn() },
  queryKeys: { entitlement: ["billing", "entitlement"] },
  useEntitlementQuery: (...args: unknown[]) => mockEntitlementQuery(...args),
}));
jest.mock("../lib/purchases", () => ({
  billingPreview: () => false,
  storePurchasesAvailable: () => mockStoreAvailable,
  loadProPackages: (...args: unknown[]) => mockLoadPackages(...args),
  buyProPackage: (...args: unknown[]) => mockBuy(...args),
  restoreStorePurchases: (...args: unknown[]) => mockRestore(...args),
  openStoreSubscriptions: (...args: unknown[]) => mockOpenStore(...args),
}));

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return {
    plan: "free",
    planName: "Free",
    source: null,
    status: null,
    interval: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    metered: true,
    limits: { aiRunsPerMonth: 30 },
    plans: { free: { aiRunsPerMonth: 30 }, pro: { aiRunsPerMonth: 1500 } },
    usage: { period: "2026-09", aiRuns: 12 },
    billing: { web: true, store: true },
    manageUrl: null,
    ...overrides,
  };
}

const pro = (overrides: Partial<Entitlement> = {}) =>
  entitlement({
    plan: "pro",
    planName: "Ciciro Pro",
    source: "app_store",
    status: "active",
    interval: "year",
    currentPeriodEnd: "2027-09-29T12:00:00.000Z",
    limits: { aiRunsPerMonth: 1500 },
    manageUrl: "https://apps.apple.com/account/subscriptions",
    ...overrides,
  });

const MONTHLY = { interval: "month", priceString: "$12.00", pricePerMonthString: null, introPriceString: null, introPeriod: null, pkg: {} };
const YEARLY = { interval: "year", priceString: "$96.00", pricePerMonthString: "$8.00", introPriceString: null, introPeriod: null, pkg: {} };

function withTheme(node: ReactNode) {
  const colors = THEME_PALETTES.parchment;
  const initialMetrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
  };
  return render(
    <SafeAreaProvider initialMetrics={initialMetrics}>
      <AppThemeContext.Provider
        value={{ settings: defaultSettings(), patch: jest.fn(), layout: makeLayout(colors), colors, dark: false }}
      >
        {node}
      </AppThemeContext.Provider>
    </SafeAreaProvider>
  );
}

function showing(value: Entitlement | undefined) {
  mockEntitlementQuery.mockReturnValue({ data: value, isPending: value === undefined, refetch: jest.fn() });
}

async function flush() {
  await act(async () => {});
}

describe("billing in the app", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreAvailable = true;
    mockLoadPackages.mockResolvedValue([MONTHLY, YEARLY]);
  });

  describe("the paywall", () => {
    it("shows the plan, both prices, the renewal terms and the legal links", async () => {
      showing(entitlement());
      withTheme(<PaywallScreen />);
      await flush();
      expect(screen.getByText("1,500 AI actions a month with Ciciro")).toBeTruthy();
      expect(screen.getByText("$12.00 / month")).toBeTruthy();
      expect(screen.getByText("$8.00 a month, billed yearly")).toBeTruthy();
      // Yearly is chosen first; the 3.1.2(c) disclosure follows the choice.
      expect(screen.getByText(/Ciciro Pro, yearly subscription, \$96.00 \/ year\. .*24 hours/)).toBeTruthy();
      fireEvent.press(screen.getByRole("radio", { name: /Monthly/ }));
      expect(screen.getByText(/Ciciro Pro, monthly subscription, \$12.00 \/ month\./)).toBeTruthy();
      expect(screen.getByText("Terms of Use")).toBeTruthy();
      expect(screen.getByText("Privacy Policy")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Restore Purchases" })).toBeTruthy();
    });

    it("buys the chosen plan and waits for the server to confirm it", async () => {
      showing(entitlement());
      mockEntitlement.mockResolvedValue({ entitlement: entitlement() });
      mockBuy.mockResolvedValue("purchased");
      mockSync.mockResolvedValue({ entitlement: pro() });
      withTheme(<PaywallScreen />);
      await flush();
      await act(async () => fireEvent.press(screen.getByRole("button", { name: "Subscribe" })));
      expect(mockBuy).toHaveBeenCalledWith(YEARLY);
      expect(mockSync).toHaveBeenCalled();
      expect(screen.getByText("Welcome to Ciciro Pro")).toBeTruthy();
    });

    it("never sells Pro to an account that got it on the web meanwhile", async () => {
      showing(entitlement());
      mockEntitlement.mockResolvedValue({ entitlement: pro({ source: "stripe", manageUrl: null }) });
      withTheme(<PaywallScreen />);
      await flush();
      await act(async () => fireEvent.press(screen.getByRole("button", { name: "Subscribe" })));
      expect(mockBuy).not.toHaveBeenCalled();
    });

    it("says nothing when the person backs out of the store sheet", async () => {
      showing(entitlement());
      mockEntitlement.mockResolvedValue({ entitlement: entitlement() });
      mockBuy.mockResolvedValue("cancelled");
      withTheme(<PaywallScreen />);
      await flush();
      await act(async () => fireEvent.press(screen.getByRole("button", { name: "Subscribe" })));
      expect(mockSync).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("says when a restore finds nothing", async () => {
      showing(entitlement());
      mockRestore.mockResolvedValue(undefined);
      mockSync.mockResolvedValue({ entitlement: entitlement() });
      jest.useFakeTimers();
      try {
        withTheme(<PaywallScreen />);
        await flush();
        fireEvent.press(screen.getByRole("button", { name: "Restore Purchases" }));
        await act(async () => {
          await jest.runAllTimersAsync();
        });
      } finally {
        jest.useRealTimers();
      }
      expect(mockRestore).toHaveBeenCalled();
      expect(screen.getByText("No Ciciro Pro subscription was found to restore.")).toBeTruthy();
    });

    it("shows a web subscriber their plan instead of a second way to pay", async () => {
      showing(pro({ source: "stripe", manageUrl: null }));
      withTheme(<PaywallScreen />);
      await flush();
      expect(screen.getByText("You have Ciciro Pro")).toBeTruthy();
      expect(screen.getByText("Your subscription is managed on the web.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Subscribe" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Manage subscription" })).toBeNull();
      expect(mockLoadPackages).not.toHaveBeenCalled();
    });

    it("sends a store subscriber to the store to manage it", async () => {
      showing(pro());
      withTheme(<PaywallScreen />);
      await flush();
      expect(screen.getByText("Billed through the App Store. Change or cancel it there.")).toBeTruthy();
      fireEvent.press(screen.getByRole("button", { name: "Manage subscription" }));
      expect(mockOpenStore).toHaveBeenCalledWith("https://apps.apple.com/account/subscriptions");
    });
  });

  describe("the Settings plan group", () => {
    it("shows a free account its usage and the way up", async () => {
      showing(entitlement());
      withTheme(<SettingsScreen />);
      await flush();
      expect(screen.getByText(/12 of 30 AI actions this month · resets Oct 1/)).toBeTruthy();
      fireEvent.press(screen.getByRole("button", { name: "Upgrade to Ciciro Pro" }));
      expect(mockPush).toHaveBeenCalledWith("/paywall");
      expect(screen.getByRole("button", { name: "Restore Purchases" })).toBeTruthy();
    });

    it("offers no in-app purchase or restore to a web subscriber", async () => {
      showing(pro({ source: "stripe", manageUrl: null }));
      withTheme(<SettingsScreen />);
      await flush();
      expect(screen.getByText("Ciciro Pro")).toBeTruthy();
      expect(screen.getByText("Your subscription is managed on the web.")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Upgrade to Ciciro Pro" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Restore Purchases" })).toBeNull();
    });

    it("hides the upgrade in a build that cannot sell Pro", async () => {
      mockStoreAvailable = false;
      showing(entitlement());
      withTheme(<SettingsScreen />);
      await flush();
      expect(screen.getByText(/12 of 30 AI actions/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Upgrade to Ciciro Pro" })).toBeNull();
    });
  });

  describe("deleting an account with a subscription", () => {
    it("tells a store subscriber to cancel with Apple first", async () => {
      showing(pro());
      withTheme(<DeleteAccountScreen />);
      expect(screen.getByText("Cancel your subscription first")).toBeTruthy();
      expect(screen.getByText(/billing continues until you cancel it there/)).toBeTruthy();
      fireEvent.press(screen.getByRole("button", { name: "Manage subscription" }));
      expect(mockOpenStore).toHaveBeenCalledWith("https://apps.apple.com/account/subscriptions");
    });

    it("tells a web subscriber the subscription ends with the account", async () => {
      showing(pro({ source: "stripe", manageUrl: null }));
      withTheme(<DeleteAccountScreen />);
      expect(screen.getByText("Your Ciciro Pro subscription is cancelled at once, with no further charges.")).toBeTruthy();
    });
  });

  it("offers Pro when the chat hits the free allowance", () => {
    withTheme(
      <ChatErrorNotice
        failure={{ code: "aiLimit", status: 402, detail: "", retryable: false, plan: "free" }}
        colors={THEME_PALETTES.parchment}
      />
    );
    fireEvent.press(screen.getByRole("button", { name: "See Ciciro Pro" }));
    expect(mockPush).toHaveBeenCalledWith("/paywall");
  });
});
