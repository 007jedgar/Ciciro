// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConsentProvider, useConsent } from "@/components/ConsentProvider";
import { CONSENT_COOKIE_NAME, buildConsentRecord } from "@/lib/consent";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function clearCookies() {
  for (const pair of document.cookie.split("; ")) {
    const name = pair.split("=")[0];
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

let latest: ReturnType<typeof useConsent> | null = null;
function Probe() {
  latest = useConsent();
  return null;
}

describe("ConsentProvider", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    clearCookies();
    latest = null;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("starts undecided, analytics off, with no initial record", () => {
    act(() =>
      root.render(
        <ConsentProvider>
          <Probe />
        </ConsentProvider>
      )
    );
    expect(latest?.decided).toBe(false);
    expect(latest?.categories.analytics).toBe(false);
  });

  it("acceptAll decides, writes the cookie, and grants analytics", async () => {
    act(() =>
      root.render(
        <ConsentProvider>
          <Probe />
        </ConsentProvider>
      )
    );
    await act(async () => latest?.acceptAll());
    expect(latest?.decided).toBe(true);
    expect(latest?.categories.analytics).toBe(true);
    expect(document.cookie).toContain(`${CONSENT_COOKIE_NAME}=`);
  });

  it("rejectAll decides with analytics withheld", async () => {
    act(() =>
      root.render(
        <ConsentProvider>
          <Probe />
        </ConsentProvider>
      )
    );
    await act(async () => latest?.rejectAll());
    expect(latest?.decided).toBe(true);
    expect(latest?.categories.analytics).toBe(false);
  });

  it("save() records a per-category choice from the preference center", async () => {
    act(() =>
      root.render(
        <ConsentProvider>
          <Probe />
        </ConsentProvider>
      )
    );
    await act(async () => latest?.save({ analytics: true }));
    expect(latest?.decided).toBe(true);
    expect(latest?.categories.analytics).toBe(true);
  });

  it("honors a server-read initial record with no flash of the banner", () => {
    const record = buildConsentRecord({ analytics: true });
    act(() =>
      root.render(
        <ConsentProvider initialRecord={record}>
          <Probe />
        </ConsentProvider>
      )
    );
    expect(latest?.decided).toBe(true);
    expect(latest?.categories.analytics).toBe(true);
  });

  it("opens and closes the preference center", async () => {
    act(() =>
      root.render(
        <ConsentProvider>
          <Probe />
        </ConsentProvider>
      )
    );
    expect(latest?.preferencesOpen).toBe(false);
    await act(async () => latest?.openPreferences());
    expect(latest?.preferencesOpen).toBe(true);
    await act(async () => latest?.closePreferences());
    expect(latest?.preferencesOpen).toBe(false);
  });
});
