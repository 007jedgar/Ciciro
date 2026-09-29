import { Linking, Platform } from "react-native";
import Purchases, {
  LOG_LEVEL,
  PACKAGE_TYPE,
  PURCHASES_ERROR_CODE,
  type PurchasesPackage,
} from "react-native-purchases";

/**
 * App Store and Google Play subscriptions, through RevenueCat. The app user
 * id is always the Ciciro user id (logIn after sign-in, logOut after sign-out),
 * so the server can tie every store purchase to the account. RevenueCat's
 * local state is never the authority: after a purchase or a restore the app
 * asks the server (POST /api/billing/sync) and renders the entitlement it
 * returns. See docs/billing.md.
 */

/** The public SDK key for this platform, or null when store billing is not set up. */
export function revenueCatApiKey(): string | null {
  const key =
    Platform.OS === "ios"
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
      : Platform.OS === "android"
        ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY
        : undefined;
  return key && key.trim() ? key.trim() : null;
}

/**
 * Development only: show the paywall with sample prices when no RevenueCat
 * key is set, so its layout can be worked on in the simulator. Buying is
 * disabled in this mode.
 */
export function billingPreview(): boolean {
  return __DEV__ && process.env.EXPO_PUBLIC_BILLING_PREVIEW === "1" && !revenueCatApiKey();
}

/** Whether this build can sell a subscription at all. Without it every paywall stays hidden. */
export function storePurchasesAvailable(): boolean {
  return revenueCatApiKey() !== null || billingPreview();
}

let configuredFor: string | null = null;

/** Point RevenueCat at this account. Safe to call on every sign-in. */
export async function identifyPurchaser(userId: string): Promise<void> {
  const apiKey = revenueCatApiKey();
  if (!apiKey || configuredFor === userId) return;
  if (!(await Purchases.isConfigured())) {
    if (__DEV__) void Purchases.setLogLevel(LOG_LEVEL.WARN);
    // Configured with the account id straight away: the app never shows a
    // paywall before sign-in, so RevenueCat never needs an anonymous id.
    Purchases.configure({ apiKey, appUserID: userId });
  } else {
    await Purchases.logIn(userId);
  }
  configuredFor = userId;
}

/** Forget the account in RevenueCat after sign-out or account deletion. */
export async function forgetPurchaser(): Promise<void> {
  if (!configuredFor) return;
  configuredFor = null;
  try {
    if (!(await Purchases.isAnonymous())) await Purchases.logOut();
  } catch {
    // logOut rejects for an anonymous user; there is nothing to forget then.
  }
}

export type ProPackage = {
  interval: "month" | "year";
  /** Localized by the store, e.g. "$12.99" or "12,99 €". */
  priceString: string;
  /** "$1.08" for a yearly package: the monthly equivalent, when the store gives one. */
  pricePerMonthString: string | null;
  /** An introductory offer the store will apply, described for the disclosure. */
  introPriceString: string | null;
  introPeriod: { units: number; unit: string } | null;
  pkg: PurchasesPackage | null;
};

const PREVIEW_PACKAGES: ProPackage[] = [
  { interval: "month", priceString: "$12.00", pricePerMonthString: null, introPriceString: null, introPeriod: null, pkg: null },
  { interval: "year", priceString: "$96.00", pricePerMonthString: "$8.00", introPriceString: null, introPeriod: null, pkg: null },
];

function toProPackage(pkg: PurchasesPackage, interval: "month" | "year"): ProPackage {
  const intro = pkg.product.introPrice;
  return {
    interval,
    priceString: pkg.product.priceString,
    pricePerMonthString: interval === "year" ? pkg.product.pricePerMonthString : null,
    introPriceString: intro ? intro.priceString : null,
    introPeriod: intro ? { units: intro.periodNumberOfUnits, unit: intro.periodUnit } : null,
    pkg,
  };
}

/** The monthly and yearly Ciciro Pro packages of the current offering, monthly first. */
export async function loadProPackages(): Promise<ProPackage[]> {
  if (billingPreview()) return PREVIEW_PACKAGES;
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return [];
  const out: ProPackage[] = [];
  if (current.monthly) out.push(toProPackage(current.monthly, "month"));
  if (current.annual) out.push(toProPackage(current.annual, "year"));
  if (out.length === 0) {
    for (const pkg of current.availablePackages) {
      if (pkg.packageType === PACKAGE_TYPE.MONTHLY) out.push(toProPackage(pkg, "month"));
      if (pkg.packageType === PACKAGE_TYPE.ANNUAL) out.push(toProPackage(pkg, "year"));
    }
  }
  return out;
}

export type PurchaseOutcome = "purchased" | "cancelled";

/** Buy a package. Resolves "cancelled" when the person backs out of the store sheet. */
export async function buyProPackage(pkg: ProPackage): Promise<PurchaseOutcome> {
  if (!pkg.pkg) throw new Error("Purchases are not available in preview mode.");
  try {
    await Purchases.purchasePackage(pkg.pkg);
    return "purchased";
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR || (error as { userCancelled?: unknown }).userCancelled) {
      return "cancelled";
    }
    throw error;
  }
}

/** Restore Purchases: re-attach this Apple ID's or Google account's purchases to the account. */
export async function restoreStorePurchases(): Promise<void> {
  if (billingPreview()) return;
  await Purchases.restorePurchases();
}

/**
 * Open the store's own subscription management: the in-app sheet on iOS, the
 * Play Store's subscriptions page on Android (the server's link names the
 * subscription when it knows it).
 */
export async function openStoreSubscriptions(manageUrl?: string | null): Promise<void> {
  if (Platform.OS === "ios" && revenueCatApiKey()) {
    try {
      await Purchases.showManageSubscriptions();
      return;
    } catch {
      // Fall through to the App Store's web page.
    }
  }
  const fallback =
    Platform.OS === "android"
      ? "https://play.google.com/store/account/subscriptions"
      : "https://apps.apple.com/account/subscriptions";
  await Linking.openURL(manageUrl || fallback);
}
