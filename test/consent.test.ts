// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_COOKIE_NAME,
  CONSENT_VERSION,
  buildConsentRecord,
  defaultConsentCategories,
  honorsGlobalPrivacyControl,
  isCurrentConsentRecord,
  parseConsentRecord,
  serializeConsentRecord,
} from "@/lib/consent";
import { readConsentCookie, writeConsentCookie } from "@/lib/consent-cookie";

function clearCookies() {
  for (const pair of document.cookie.split("; ")) {
    const name = pair.split("=")[0];
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

describe("consent record versioning", () => {
  it("builds a current-version record stamped with the given time", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(buildConsentRecord({ analytics: true }, now)).toEqual({
      version: CONSENT_VERSION,
      categories: { analytics: true },
      decidedAt: now.toISOString(),
    });
  });

  it("round-trips through serialize and parse", () => {
    const record = buildConsentRecord({ analytics: true });
    expect(parseConsentRecord(serializeConsentRecord(record))).toEqual(record);
  });

  it("asks again when the stored version is older than the current one", () => {
    const stale = JSON.stringify({
      version: CONSENT_VERSION - 1,
      categories: { analytics: true },
      decidedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(parseConsentRecord(stale)).toBeNull();
  });

  it("asks again when the stored version is newer than the current one", () => {
    const future = JSON.stringify({
      version: CONSENT_VERSION + 1,
      categories: { analytics: true },
      decidedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(parseConsentRecord(future)).toBeNull();
  });

  it("rejects malformed or incomplete input instead of throwing", () => {
    expect(parseConsentRecord("not json")).toBeNull();
    expect(parseConsentRecord(null)).toBeNull();
    expect(parseConsentRecord(undefined)).toBeNull();
    expect(parseConsentRecord(JSON.stringify({ version: CONSENT_VERSION }))).toBeNull();
    expect(parseConsentRecord(JSON.stringify({ version: CONSENT_VERSION, categories: {}, decidedAt: "x" }))).toBeNull();
  });

  it("defaults every category off", () => {
    expect(defaultConsentCategories()).toEqual({ analytics: false });
  });

  it("isCurrentConsentRecord agrees with parseConsentRecord's acceptance", () => {
    const record = buildConsentRecord({ analytics: false });
    expect(isCurrentConsentRecord(record)).toBe(true);
    expect(isCurrentConsentRecord({ ...record, version: CONSENT_VERSION + 1 })).toBe(false);
    expect(isCurrentConsentRecord(null)).toBe(false);
  });
});

describe("honorsGlobalPrivacyControl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is false with no GPC signal", () => {
    expect(honorsGlobalPrivacyControl()).toBe(false);
  });

  it("is true once the browser sends Global Privacy Control", () => {
    vi.stubGlobal("navigator", { ...navigator, globalPrivacyControl: true });
    expect(honorsGlobalPrivacyControl()).toBe(true);
  });
});

describe("consent cookie", () => {
  afterEach(() => clearCookies());

  it("reads null with no cookie set yet", () => {
    expect(readConsentCookie()).toBeNull();
  });

  it("round-trips a written record and lands under the expected name", () => {
    const record = buildConsentRecord({ analytics: true });
    writeConsentCookie(record);
    expect(readConsentCookie()).toEqual(record);
    expect(document.cookie).toContain(`${CONSENT_COOKIE_NAME}=`);
  });

  it("overwrites a previous decision", () => {
    writeConsentCookie(buildConsentRecord({ analytics: true }));
    const rejected = buildConsentRecord({ analytics: false });
    writeConsentCookie(rejected);
    expect(readConsentCookie()).toEqual(rejected);
  });
});
