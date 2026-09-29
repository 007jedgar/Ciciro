// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider, useSettings } from "@/components/SettingsProvider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function prefersDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({ matches: dark && query.includes("dark"), media: query, addEventListener() {}, removeEventListener() {} })
  );
}

let seen = "";
function Probe() {
  seen = useSettings().settings.theme;
  return null;
}

describe("SettingsProvider first visit", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ user: null, settings: null })));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  async function mount() {
    await act(async () => {
      root.render(
        <SettingsProvider>
          <Probe />
        </SettingsProvider>
      );
    });
  }

  it("follows a dark OS instead of pinning Parchment", async () => {
    prefersDark(true);
    await mount();
    expect(seen).toBe("ember");
    expect(document.documentElement.getAttribute("data-theme")).toBe("ember");
    expect(localStorage.getItem("ciciro-theme")).toBe("ember");
  });

  it("starts on Parchment for a light OS", async () => {
    prefersDark(false);
    await mount();
    expect(seen).toBe("parchment");
  });

  it("keeps a theme the author already chose", async () => {
    prefersDark(true);
    localStorage.setItem("ciciro-theme", "parchment");
    await mount();
    expect(seen).toBe("parchment");
  });
});
