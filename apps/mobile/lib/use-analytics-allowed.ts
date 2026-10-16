import { effectiveAnalyticsAllowed, useConsent } from "./consent";
import { useConsentMode } from "./consent-region-store";
import { useSession } from "./session";
import { useAppTheme } from "./settings";

/**
 * Whether analytics is running right now, for what the person sees (the
 * Settings row, the Privacy choices switch): the same rule AnalyticsSync
 * applies (lib/consent.ts's effectiveAnalyticsAllowed), never the account
 * flag alone.
 */
export function useAnalyticsAllowed(): boolean {
  const consent = useConsent();
  const { mode } = useConsentMode();
  const { user } = useSession();
  const { settings } = useAppTheme();
  return effectiveAnalyticsAllowed({
    record: consent,
    mode,
    signedIn: !!user,
    accountEnabled: settings.analyticsEnabled,
  });
}
