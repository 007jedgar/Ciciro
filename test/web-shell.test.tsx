// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DrawerHead from "@/components/DrawerHead";
import OpenInApp from "@/components/OpenInApp";
import TopbarMore from "@/components/TopbarMore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("DrawerHead", () => {
  it("renders the title with a labelled Close icon button", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<DrawerHead title="Scratchpad" onClose={onClose} />));
    expect(host.querySelector("h2")?.textContent).toBe("Scratchpad");
    const close = host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    await act(async () => close.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("TopbarMore", () => {
  const items = (onSelect = vi.fn()) => [
    { key: "q", label: "Questions", count: 2, onSelect },
    { key: "w", label: "Weekly review", dot: true, onSelect },
  ];

  it("opens on click, runs an item and closes", async () => {
    const onSelect = vi.fn();
    await act(async () => root.render(<TopbarMore items={items(onSelect)} />));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>(".more-trigger")!.click());
    const first = host.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    expect(first.textContent).toContain("Questions");
    expect(first.querySelector(".count-chip")?.textContent).toBe("2");
    await act(async () => first.click());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("flags the trigger while something is waiting", async () => {
    await act(async () => root.render(<TopbarMore items={items()} />));
    expect(host.querySelector(".more-trigger .more-dot")).not.toBeNull();
    await act(async () =>
      root.render(<TopbarMore items={[{ key: "q", label: "Questions", onSelect: vi.fn() }]} />)
    );
    expect(host.querySelector(".more-trigger .more-dot")).toBeNull();
  });
});

describe("OpenInApp", () => {
  it("links to the app and back to the manuscripts", async () => {
    await act(async () => root.render(<OpenInApp title="The Salt Road" />));
    expect(host.querySelector("h1")?.textContent).toContain("The Salt Road");
    expect(host.querySelector<HTMLAnchorElement>('a[href="ciciro://"]')).not.toBeNull();
    expect(host.querySelector<HTMLAnchorElement>('a[href="/"]')).not.toBeNull();
  });
});

describe("theme tokens", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  it("defines --on-accent for every theme", () => {
    for (const id of ["parchment", "sage", "ember", "walnut", "inkwell", "candle"]) {
      const block = css.match(new RegExp(`\\[data-theme="${id}"\\] \\{[^}]*\\}`))?.[0] ?? "";
      expect(block, id).toContain("--on-accent:");
    }
  });

  it("paints primary buttons with --on-accent, not white", () => {
    const rule = css.match(/\.btn\.primary \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("color: var(--on-accent)");
  });
});
