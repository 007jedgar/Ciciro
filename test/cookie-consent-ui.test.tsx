// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConsentProvider } from "@/components/ConsentProvider";
import CookieConsentBanner from "@/components/CookieConsentBanner";
import CookiePreferencesDialog from "@/components/CookiePreferencesDialog";
import CookieSettingsButton from "@/components/CookieSettingsButton";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function clearCookies() {
  for (const pair of document.cookie.split("; ")) {
    const name = pair.split("=")[0];
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

describe("cookie consent UI", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    clearCookies();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("shows the banner with equal-weight accept/reject and a Customize option, on first visit", async () => {
    await act(async () =>
      root.render(
        <ConsentProvider>
          <CookieConsentBanner />
          <CookiePreferencesDialog />
        </ConsentProvider>
      )
    );
    const region = document.querySelector('[role="region"][aria-label="Cookie consent"]');
    expect(region).not.toBeNull();
    const buttons = Array.from(region!.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toEqual(["Customize", "Reject all", "Accept all"]);
  });

  it("Accept all dismisses the banner immediately", async () => {
    await act(async () =>
      root.render(
        <ConsentProvider>
          <CookieConsentBanner />
          <CookiePreferencesDialog />
        </ConsentProvider>
      )
    );
    const acceptAll = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Accept all")!;
    await act(async () => acceptAll.click());
    const region = document.querySelector('[role="region"][aria-label="Cookie consent"][data-state="open"]');
    expect(region).toBeNull();
  });

  it("Customize opens the preference center with a per-category toggle, defaulting off", async () => {
    await act(async () =>
      root.render(
        <ConsentProvider>
          <CookieConsentBanner />
          <CookiePreferencesDialog />
        </ConsentProvider>
      )
    );
    const customize = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Customize")!;
    await act(async () => customize.click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const toggle = dialog!.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.textContent).toBe("Off");
  });

  it("CookieSettingsButton reopens the preference center after a decision was already made", async () => {
    await act(async () =>
      root.render(
        <ConsentProvider>
          <CookieConsentBanner />
          <CookiePreferencesDialog />
          <CookieSettingsButton />
        </ConsentProvider>
      )
    );
    const acceptAll = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Accept all")!;
    await act(async () => acceptAll.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    const settingsButton = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent === "Cookie settings"
    )!;
    await act(async () => settingsButton.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    const toggle = dialog.querySelector<HTMLButtonElement>('[role="switch"]')!;
    // Reopened after an accept, so the toggle reflects the current (granted) choice.
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });
});
