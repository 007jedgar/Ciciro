// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryAnalyticsAdapter } from "@/lib/analytics-events";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const analytics = vi.hoisted(() => ({ adapter: null as unknown as MemoryAnalyticsAdapter }));
vi.mock("@/lib/analytics-client", () => ({ getAnalytics: () => analytics.adapter }));

import TrackedLink from "@/components/TrackedLink";

describe("TrackedLink", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    analytics.adapter = new MemoryAnalyticsAdapter();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("fires cta_clicked with the given cta and surface on click, alongside any onClick already on the link", async () => {
    const extra = vi.fn();
    act(() =>
      root.render(
        <TrackedLink href="/pricing" cta="see_pricing" surface="landing" onClick={extra}>
          See pricing
        </TrackedLink>
      )
    );
    const link = host.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/pricing");
    await act(async () => {
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(analytics.adapter.tracks).toEqual([
      { event: "cta_clicked", properties: { cta: "see_pricing", surface: "landing" }, options: undefined },
    ]);
    expect(extra).toHaveBeenCalledTimes(1);
  });
});
