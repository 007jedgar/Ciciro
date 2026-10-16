// A coarse, per-request location: the country and (for the US) the state
// Cloudflare resolved from the request's IP. The phone asks for it to decide
// whether it must show the analytics consent prompt (see
// apps/mobile/lib/consent-region.ts and docs/analytics.md). Nothing here is
// stored or logged, and nothing finer than country / state is ever read.

export type RequestGeo = {
  /** ISO 3166-1 alpha-2, upper case, or null when Cloudflare could not say. */
  country: string | null;
  /** ISO 3166-2 subdivision code without the country (US: "CA", "WA"), or null. */
  region: string | null;
};

const CLOUDFLARE_CONTEXT = Symbol.for("__cloudflare-context__");

function cleanCountry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  // "XX" is Cloudflare's "no data" and "T1" is Tor: neither names a place.
  if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return null;
  return code;
}

function cleanRegion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{1,3}$/.test(code) ? code : null;
}

function workerCf(): { country?: unknown; regionCode?: unknown } | undefined {
  try {
    const ctx = (globalThis as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT];
    const cf = ctx && typeof ctx === "object" ? (ctx as { cf?: unknown }).cf : undefined;
    return cf && typeof cf === "object" ? (cf as { country?: unknown; regionCode?: unknown }) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The country and state of a request. Prefers the Worker's `request.cf`, then
 * the `cf-ipcountry` / `cf-region-code` headers Cloudflare adds in front of a
 * plain Node host. Outside production the query string may set `country` and
 * `region`, or `CICIRO_DEV_GEO` (e.g. `US-TX`, `DE`) pins the answer for every
 * request, so a simulator can walk every case without a VPN.
 */
export function requestGeo(request: Request): RequestGeo {
  if (process.env.NODE_ENV !== "production") {
    const params = new URL(request.url).searchParams;
    if (params.has("country")) {
      return { country: cleanCountry(params.get("country")), region: cleanRegion(params.get("region")) };
    }
  }
  const pinned = process.env.NODE_ENV !== "production" ? process.env.CICIRO_DEV_GEO?.trim() : undefined;
  if (pinned) {
    const [country, region] = pinned.split("-");
    return { country: cleanCountry(country), region: cleanRegion(region) };
  }
  const cf = workerCf();
  const country = cleanCountry(cf?.country ?? request.headers.get("cf-ipcountry"));
  const region = cleanRegion(cf?.regionCode ?? request.headers.get("cf-region-code"));
  return { country, region: country ? region : null };
}
