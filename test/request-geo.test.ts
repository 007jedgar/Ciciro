import { afterEach, describe, expect, it, vi } from "vitest";
import { requestGeo } from "@/lib/request-geo";

const CONTEXT = Symbol.for("__cloudflare-context__");

function request(url = "https://ciciro.app/api/app/consent-region", headers: Record<string, string> = {}) {
  return new Request(url, { headers });
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CONTEXT];
  vi.unstubAllEnvs();
});

describe("requestGeo", () => {
  it("reads the Worker's country and state", () => {
    (globalThis as Record<symbol, unknown>)[CONTEXT] = { cf: { country: "US", regionCode: "TX" } };
    expect(requestGeo(request())).toEqual({ country: "US", region: "TX" });
  });

  it("falls back to the headers Cloudflare adds in front of a plain Node host", () => {
    expect(requestGeo(request(undefined, { "cf-ipcountry": "de", "cf-region-code": "by" }))).toEqual({
      country: "DE",
      region: "BY",
    });
  });

  it("says nothing when Cloudflare could not place the request", () => {
    expect(requestGeo(request())).toEqual({ country: null, region: null });
    expect(requestGeo(request(undefined, { "cf-ipcountry": "XX" }))).toEqual({ country: null, region: null });
    expect(requestGeo(request(undefined, { "cf-ipcountry": "T1" }))).toEqual({ country: null, region: null });
  });

  it("never reports a state without a country, or a malformed code", () => {
    expect(requestGeo(request(undefined, { "cf-region-code": "TX" }))).toEqual({ country: null, region: null });
    expect(requestGeo(request(undefined, { "cf-ipcountry": "USA", "cf-region-code": "TX" }))).toEqual({
      country: null,
      region: null,
    });
    expect(requestGeo(request(undefined, { "cf-ipcountry": "US", "cf-region-code": "<script>" }))).toEqual({
      country: "US",
      region: null,
    });
  });

  it("lets the query string set the place outside production, so every case can be walked without a VPN", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(requestGeo(request("https://x.test/api/app/consent-region?country=us&region=wa"))).toEqual({
      country: "US",
      region: "WA",
    });
  });

  it("lets CICIRO_DEV_GEO pin the place outside production, and ignores it in production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CICIRO_DEV_GEO", "US-TX");
    expect(requestGeo(request())).toEqual({ country: "US", region: "TX" });
    vi.stubEnv("CICIRO_DEV_GEO", "DE");
    expect(requestGeo(request())).toEqual({ country: "DE", region: null });
    vi.stubEnv("NODE_ENV", "production");
    expect(requestGeo(request())).toEqual({ country: null, region: null });
  });

  it("ignores the query string in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(requestGeo(request("https://x.test/api/app/consent-region?country=US&region=TX"))).toEqual({
      country: null,
      region: null,
    });
  });
});

describe("GET /api/app/consent-region", () => {
  it("answers with the caller's place, uncached, and is reachable signed out", async () => {
    const { GET } = await import("@/app/api/app/consent-region/route");
    const { isPublic } = await import("@/middleware");
    (globalThis as Record<symbol, unknown>)[CONTEXT] = { cf: { country: "US", regionCode: "OR" } };
    const res = await GET(request());
    expect(await res.json()).toEqual({ country: "US", region: "OR" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(isPublic("/api/app/consent-region")).toBe(true);
  });
});
