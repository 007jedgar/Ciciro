// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsProvider } from "@/components/SettingsProvider";
import { ConsentProvider } from "@/components/ConsentProvider";
import ThemePicker from "@/components/ThemePicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the editor's settings entry", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "matchMedia",
      (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })
    );
    vi.stubGlobal("fetch", async (url: string) => {
      if (typeof url === "string" && url.startsWith("/api/models")) return new Response("", { status: 404 });
      return new Response(JSON.stringify({ user: null, settings: null }));
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("is labeled Settings in the editor's compact toolbar, not just a color swatch", async () => {
    await act(async () =>
      root.render(
        <SettingsProvider>
          <ConsentProvider>
            <ThemePicker compact />
          </ConsentProvider>
        </SettingsProvider>
      )
    );
    const trigger = host.querySelector<HTMLButtonElement>(".theme-trigger")!;
    expect(trigger.textContent).toContain("Settings");
    await act(async () => trigger.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.querySelector('[role="dialog"][aria-label="App settings"]')).not.toBeNull();
  });

  it("keeps showing the current theme's name outside the editor (the library)", async () => {
    await act(async () =>
      root.render(
        <SettingsProvider>
          <ConsentProvider>
            <ThemePicker />
          </ConsentProvider>
        </SettingsProvider>
      )
    );
    const trigger = host.querySelector<HTMLButtonElement>(".theme-trigger")!;
    expect(trigger.textContent).not.toContain("Settings");
  });
});
