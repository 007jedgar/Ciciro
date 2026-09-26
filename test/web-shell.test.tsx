// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DrawerHead from "@/components/DrawerHead";
import OpenInApp, { APP_LAUNCH_WAIT_MS } from "@/components/OpenInApp";
import TopbarMore from "@/components/TopbarMore";
import WorkspaceGate from "@/components/WorkspaceGate";
import { PHONE_WIDTH_QUERY } from "@/lib/phone-width";
import type { Project } from "@/lib/types";
import { THEMES, applyTheme } from "@/lib/theme";

const { workspaceMounts, workspaceUnmounts } = vi.hoisted(() => ({
  workspaceMounts: vi.fn(),
  workspaceUnmounts: vi.fn(),
}));
vi.mock("@/components/Workspace", async () => {
  const { useEffect } = await import("react");
  return {
    default: function MockWorkspace() {
      useEffect(() => {
        workspaceMounts();
        return () => workspaceUnmounts();
      }, []);
      return <div data-testid="workspace" />;
    },
  };
});

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
    expect(host.textContent).not.toContain("iPhone");
  });

  function tapOpen() {
    const link = host.querySelector<HTMLAnchorElement>('a[href="ciciro://"]')!;
    link.addEventListener("click", (e) => e.preventDefault(), { once: true });
    link.click();
  }

  it("says the app is missing when the page is still here after the wait", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => root.render(<OpenInApp title="The Salt Road" />));
      await act(async () => tapOpen());
      await act(async () => vi.advanceTimersByTime(APP_LAUNCH_WAIT_MS - 1));
      expect(host.querySelector('[role="status"]')).toBeNull();
      await act(async () => vi.advanceTimersByTime(1));
      expect(host.querySelector('[role="status"]')?.textContent).toBe(
        "The Ciciro app is not installed on this device."
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet when the app takes the page away", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => root.render(<OpenInApp title="The Salt Road" />));
      await act(async () => tapOpen());
      await act(async () => window.dispatchEvent(new Event("pagehide")));
      await act(async () => vi.advanceTimersByTime(APP_LAUNCH_WAIT_MS * 2));
      expect(host.querySelector('[role="status"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
  it("takes the not-installed line back when the app opens after the wait", async () => {
    vi.useFakeTimers();
    try {
      await act(async () => root.render(<OpenInApp title="The Salt Road" />));
      await act(async () => tapOpen());
      await act(async () => vi.advanceTimersByTime(APP_LAUNCH_WAIT_MS));
      expect(host.querySelector('[role="status"]')).not.toBeNull();
      await act(async () => window.dispatchEvent(new Event("pagehide")));
      expect(host.querySelector('[role="status"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WorkspaceGate", () => {
  const width = { phone: false, listeners: new Set<() => void>() };

  function mockWidth(phone: boolean) {
    width.phone = phone;
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: width.phone && query === PHONE_WIDTH_QUERY,
        media: query,
        addEventListener: (_: string, fn: () => void) => width.listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => width.listeners.delete(fn),
      }))
    );
  }

  async function resizeTo(phone: boolean) {
    width.phone = phone;
    await act(async () => width.listeners.forEach((fn) => fn()));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    width.listeners.clear();
  });

  it("does not mount the workspace at phone widths", async () => {
    mockWidth(true);
    await act(async () => root.render(<WorkspaceGate initialProject={{} as Project} />));
    expect(workspaceMounts).not.toHaveBeenCalled();
    expect(host.innerHTML).toBe("");
  });

  it("mounts the workspace on wider screens", async () => {
    mockWidth(false);
    await act(async () => root.render(<WorkspaceGate initialProject={{} as Project} />));
    expect(workspaceMounts).toHaveBeenCalled();
    expect(host.querySelector("[data-testid=workspace]")).not.toBeNull();
  });

  it("keeps the workspace mounted when a desktop window narrows and widens", async () => {
    mockWidth(false);
    await act(async () => root.render(<WorkspaceGate initialProject={{} as Project} />));
    await resizeTo(true);
    await resizeTo(false);
    expect(workspaceMounts).toHaveBeenCalledTimes(1);
    expect(workspaceUnmounts).not.toHaveBeenCalled();
    expect(host.querySelector("[data-testid=workspace]")).not.toBeNull();
  });

  it("mounts the workspace once a phone-width window widens", async () => {
    mockWidth(true);
    await act(async () => root.render(<WorkspaceGate initialProject={{} as Project} />));
    await resizeTo(false);
    await resizeTo(true);
    expect(workspaceMounts).toHaveBeenCalledTimes(1);
    expect(host.querySelector("[data-testid=workspace]")).not.toBeNull();
  });
});

describe("theme contrast", () => {
  let sheet: HTMLStyleElement;

  beforeEach(() => {
    sheet = document.createElement("style");
    sheet.textContent = readFileSync("src/app/globals.css", "utf8");
    document.head.appendChild(sheet);
  });

  afterEach(() => {
    sheet.remove();
    document.documentElement.removeAttribute("data-theme");
  });

  function resolve(el: Element, value: string, depth = 0): string {
    const next = value.replace(/var\((--[\w-]+)\)/g, (_, name: string) =>
      getComputedStyle(el).getPropertyValue(name).trim()
    );
    return next.includes("var(") && depth < 8 ? resolve(el, next, depth + 1) : next.trim();
  }

  function luminance(color: string): number {
    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
    if (!hex) throw new Error(`unsupported color ${color}`);
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(full.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a: string, b: string): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  for (const className of ["btn primary", "count-chip"]) {
    it(`keeps .${className.replace(" ", ".")} text at AA on the accent in every theme`, () => {
      const el = document.createElement(className === "count-chip" ? "span" : "button");
      el.className = className;
      document.body.appendChild(el);
      try {
        for (const theme of THEMES) {
          applyTheme(theme.id);
          const style = getComputedStyle(el);
          const fg = resolve(el, style.color);
          const bg = resolve(el, style.getPropertyValue("background"));
          expect(contrast(fg, bg), `${theme.id}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      } finally {
        el.remove();
      }
    });
  }
});
