// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ThemeToggle needs SettingsProvider context the bare component tree below
// doesn't supply; a render smoke test only cares that Features composes and
// gates correctly, not that the toggle itself works.
vi.mock("@/components/ThemeToggle", () => ({ default: () => <button type="button">Theme</button> }));

import Features from "@/components/features/Features";
import { ConsentProvider } from "@/components/ConsentProvider";

function withConsent(children: ReactNode) {
  return <ConsentProvider>{children}</ConsentProvider>;
}

describe("Features page", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("renders every section's heading and the screenplay Beta caveats", () => {
    act(() => root.render(withConsent(<Features />)));
    const html = host.innerHTML;
    expect(html).toContain("Everything in Ciciro");
    expect(html).toContain("Who-knows-what ledger");
    expect(html).toMatch(/Beta/);
    expect(html).toContain("English and Spanish only");
    // FDX is interchange only; never claim Final Draft opens it unchanged.
    expect(html).toContain("Ciciro makes no claim that Final Draft opens the FDX unchanged.");
  });

  it("names no em dash anywhere in the page's own copy", () => {
    act(() => root.render(withConsent(<Features />)));
    expect(host.textContent ?? "").not.toContain("—");
  });

  it("hides any Pro or pricing language when Stripe is not configured", () => {
    act(() => root.render(withConsent(<Features />)));
    expect(host.querySelector('a[href="/pricing"]')).toBeNull();
    expect(host.textContent ?? "").not.toMatch(/\bPro\b/);
  });

  it("shows the pricing link once Stripe is configured", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("STRIPE_PRICE_PRO_MONTHLY", "price_month");
    vi.stubEnv("STRIPE_PRICE_PRO_YEARLY", "price_year");
    act(() => root.render(withConsent(<Features />)));
    expect(host.querySelector('a[href="/pricing"]')).not.toBeNull();
  });
});
