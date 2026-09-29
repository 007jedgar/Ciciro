import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { ciciro, queryClient, queryKeys, useEntitlementQuery, type Entitlement } from "./api";
import { billingPreview, storePurchasesAvailable } from "./purchases";

/**
 * What the app shows about billing, decided from the server's entitlement
 * (src/lib/entitlements.ts) and never from the store SDK's local state.
 */

/**
 * The server's entitlement, re-read whenever the screen showing it comes into
 * focus: usage moves with every AI action, and the plan can change on the web
 * or in the store while the app is open.
 */
export function useEntitlement(enabled: boolean) {
  const query = useEntitlementQuery({ enabled });
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      if (enabled) void refetch();
    }, [enabled, refetch])
  );
  return query;
}

/** i18n key naming the store a subscription is billed through, or null for the web / no subscription. */
export function storeLabelKey(source: Entitlement["source"]): "billing.appStore" | "billing.googlePlay" | null {
  if (source === "app_store") return "billing.appStore";
  if (source === "play_store") return "billing.googlePlay";
  return null;
}

/**
 * Whether this account may be offered an in-app subscription: the build sells
 * one, the server can credit it, and the account is not already on Pro from
 * any source (the double-billing guard for a web subscriber).
 */
export function canOfferPro(entitlement: Entitlement | null | undefined): boolean {
  if (!entitlement || entitlement.plan !== "free") return false;
  if (!storePurchasesAvailable()) return false;
  return entitlement.billing.store || billingPreview();
}

/** "October 29, 2026" in the app's language. */
export function billingDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { month: "long", day: "numeric", year: "numeric" });
}

/** "Oct 1": when the allowance for `period` ("YYYY-MM") starts over. */
export function allowanceResetsOn(period: string, locale: string): string {
  const [year, index] = period.split("-").map(Number);
  return new Date(Date.UTC(year, index, 1)).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const INTRO_UNIT_KEYS: Record<string, string> = {
  DAY: "billing.introDay",
  WEEK: "billing.introWeek",
  MONTH: "billing.introMonth",
  YEAR: "billing.introYear",
};

/** i18n key (pluralized by count) for an introductory offer's period unit. */
export function introPeriodKey(unit: string): string | null {
  return INTRO_UNIT_KEYS[unit.toUpperCase()] ?? null;
}

export function rememberEntitlement(entitlement: Entitlement): void {
  queryClient.setQueryData(queryKeys.entitlement, entitlement);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask the server to re-read this account's store purchases, retrying a few
 * times while a fresh purchase propagates through RevenueCat. Resolves with
 * the latest entitlement, Pro or not.
 */
export async function syncStorePurchases({
  attempts = 4,
  delayMs = 1500,
}: { attempts?: number; delayMs?: number } = {}): Promise<Entitlement> {
  let latest: Entitlement | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await wait(delayMs);
    try {
      latest = (await ciciro.billing.sync()).entitlement;
      rememberEntitlement(latest);
      if (latest.plan !== "free") return latest;
    } catch (error) {
      lastError = error;
    }
  }
  if (latest) return latest;
  throw lastError ?? new Error("Could not sync purchases.");
}
