/**
 * Where analytics consent must be asked first (opt-in) and where it can be on
 * by default with an easy way out (opt-out). Pure: the network and the cache
 * are lib/consent-region-store.ts. See docs/analytics.md, "Where the prompt
 * shows".
 *
 * Opt-in (the prompt shows, analytics stays off until the person says yes):
 *  - the EU, the rest of the EEA (Iceland, Liechtenstein, Norway), the UK and
 *    Switzerland: ePrivacy / GDPR need consent before a device is read or
 *    written for analytics;
 *  - California, Washington and Oregon, which the product owner chose to treat
 *    the same way (see the PR for the legal footing of each);
 *  - anywhere we cannot tell, and every country not named as opt-out below.
 *    Asking when unsure costs one tap; not asking when required is the
 *    mistake.
 *
 * Opt-out (no prompt, analytics on by default, switch it off under
 * Settings > Privacy choices): the rest of the United States.
 */

export type ConsentMode = "opt-in" | "opt-out";

/** A coarse location. Both parts are upper-case codes, or null when unknown. */
export type GeoSignal = {
  country: string | null;
  region: string | null;
};

export const EU_COUNTRIES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
] as const;

/** The rest of the EEA, plus the UK and Switzerland, which apply the same consent rules. */
export const EEA_UK_CH_COUNTRIES = ["IS", "LI", "NO", "GB", "CH"] as const;

/** US states where the prompt shows (two-letter postal codes). */
export const US_OPT_IN_STATES = ["CA", "WA", "OR"] as const;

/** Countries where being outside the opt-in states is enough to skip the prompt. */
const OPT_OUT_COUNTRY = "US";

function code(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

/** Whether the prompt must show (opt-in) or analytics may default on (opt-out) for this location. */
export function consentModeFor(geo: GeoSignal | null | undefined): ConsentMode {
  const country = code(geo?.country);
  if (country !== OPT_OUT_COUNTRY) return "opt-in";
  const region = code(geo?.region);
  // A US address with no state could be Oregon: ask.
  if (!region) return "opt-in";
  return (US_OPT_IN_STATES as readonly string[]).includes(region) ? "opt-in" : "opt-out";
}

/** A cached location is trusted this long; older than this and we are "unsure" again (a traveller, a move). */
export const GEO_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The location a stored lookup stands for now: null once it is too old to trust. */
export function freshGeo(stored: { geo: GeoSignal; fetchedAt: number } | null, now: number): GeoSignal | null {
  if (!stored) return null;
  if (!Number.isFinite(stored.fetchedAt) || now - stored.fetchedAt > GEO_MAX_AGE_MS || now < stored.fetchedAt) return null;
  return stored.geo;
}
