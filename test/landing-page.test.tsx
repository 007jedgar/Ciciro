// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ThemeToggle needs SettingsProvider context the bare component tree below
// doesn't supply; a render smoke test only cares that Landing composes and
// gates correctly, not that the toggle itself works.
vi.mock("@/components/ThemeToggle", () => ({ default: () => <button type="button">Theme</button> }));

import Landing from "@/components/landing/Landing";
import { ConsentProvider } from "@/components/ConsentProvider";

function withConsent(children: ReactNode) {
  return <ConsentProvider>{children}</ConsentProvider>;
}

describe("the landing page's header for a signed-in visitor (/about)", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    // CyclingWord and PhoneClip (the retyping headline and the autoplaying
    // phone clip, both inside Landing) read these browser APIs on mount;
    // jsdom has neither, and this smoke test does not exercise their motion.
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    );
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function IntersectionObserverStub() {
        return { observe: () => {}, disconnect: () => {} };
      })
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("offers Sign in and Get early access to a signed-out visitor", () => {
    act(() => root.render(withConsent(<Landing />)));
    expect(host.textContent ?? "").toContain("Sign in");
    expect(host.textContent ?? "").toContain("Get early access");
    expect(host.textContent ?? "").not.toContain("Open Ciciro");
  });

  it("offers a way back into the app instead, for a visitor with a session", () => {
    act(() => root.render(withConsent(<Landing openApp />)));
    const nav = host.querySelector(".landing-nav");
    expect(nav?.textContent ?? "").toContain("Open Ciciro");
    expect(nav?.textContent ?? "").not.toContain("Sign in");
    expect(nav?.textContent ?? "").not.toContain("Get early access");
    const openLink = nav?.querySelector('a[href="/"]');
    expect(openLink?.textContent ?? "").toContain("Open Ciciro");
  });
});
