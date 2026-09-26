// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import SearchPanel from "@/components/SearchPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("overlay Escape", () => {
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    container?.remove();
    container = null;
  });

  it("closing the search panel claims Escape so focus mode stays on", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        createElement(SearchPanel, {
          projectId: "p1",
          onClose,
          onJump: () => {},
          flushSaves: async () => true,
          onReplaced: () => {},
        })
      );
    });

    // Workspace's focus-mode handler listens on window and skips prevented events.
    let seenByWindow: boolean | null = null;
    const onWindowKey = (e: KeyboardEvent) => {
      seenByWindow = e.defaultPrevented;
    };
    window.addEventListener("keydown", onWindowKey);
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => {
      document.body.dispatchEvent(event);
    });
    window.removeEventListener("keydown", onWindowKey);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(seenByWindow).toBe(true);
    await act(async () => root.unmount());
  });
});
