// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShortcutsPanel from "@/components/ShortcutsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the keyboard shortcuts panel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("lays out every row as a two-column table, one <kbd> per key", async () => {
    await act(async () => root.render(<ShortcutsPanel hasChapters={false} onClose={() => {}} />));
    const rows = host.querySelectorAll(".shortcuts-table tr");
    expect(rows.length).toBeGreaterThan(0);
    const [keysCell, labelCell] = rows[0].querySelectorAll("td");
    expect(keysCell.className).toBe("shortcuts-keys-cell");
    expect(labelCell.className).toBe("shortcuts-label-cell");
    // "Ctrl+Shift+Z" (Redo, non-Mac in jsdom) renders as three key caps.
    const redoRow = [...rows].find((r) => r.textContent?.includes("Redo"))!;
    expect(redoRow.querySelectorAll("kbd").length).toBe(3);
  });

  it("groups rows under section headings", async () => {
    await act(async () => root.render(<ShortcutsPanel hasChapters={false} onClose={() => {}} />));
    const headings = [...host.querySelectorAll(".shortcuts-group h3")].map((h) => h.textContent);
    expect(headings).toEqual(["Editing", "View & navigation"]);
  });

  it("adds a Screenplay elements section only when a screenplay is open", async () => {
    await act(async () => root.render(<ShortcutsPanel hasChapters={false} onClose={() => {}} />));
    expect(
      [...host.querySelectorAll(".shortcuts-group h3")].some((h) => h.textContent === "Screenplay elements")
    ).toBe(false);

    await act(async () =>
      root.render(<ShortcutsPanel kind="screenplay" hasChapters={false} onClose={() => {}} />)
    );
    expect(
      [...host.querySelectorAll(".shortcuts-group h3")].some((h) => h.textContent === "Screenplay elements")
    ).toBe(true);
  });

  it("closes on Escape and on an overlay click", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<ShortcutsPanel hasChapters={false} onClose={onClose} />));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () =>
      host.querySelector(".drawer-overlay")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
