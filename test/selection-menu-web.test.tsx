// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SelectionMenu, { type SelectionMenuData } from "@/components/SelectionMenu";
import { selectionActionsFor, type SynonymContext } from "@/lib/selection-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = { startTop: 200, endBottom: 224, centerX: 300, minTop: 0, minLeft: 8, maxRight: 700 };

const passage: SelectionMenuData = {
  ...base,
  key: "5:20",
  target: "passage",
  actions: selectionActionsFor("passage"),
  context: null,
};

const word: SelectionMenuData = {
  ...base,
  key: "5:12",
  target: "word",
  actions: selectionActionsFor("word"),
  context: { word: "country", before: "the ", after: "." },
};

let root: Root;
let host: HTMLDivElement;
let props: Parameters<typeof SelectionMenu>[0];

function render(next: Partial<typeof props> = {}) {
  props = { ...props, ...next };
  act(() => root.render(<SelectionMenu {...props} />));
}

const settle = () => act(async () => {});
const labels = () =>
  Array.from(host.querySelectorAll<HTMLElement>("[data-roving]")).map(
    (el) => el.getAttribute("aria-label") ?? el.textContent
  );
const bar = () => host.querySelector<HTMLElement>('[role="toolbar"]')!;
const press = (el: Element, key: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  document.documentElement.setAttribute("data-reduce-motion", "true");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  props = {
    menu: null,
    lookup: vi.fn(async () => []),
    onAction: vi.fn(),
    onSynonym: vi.fn(),
    onEscape: vi.fn(),
    onFocusChange: vi.fn(),
    focusRequest: 0,
    shortcut: "Ctrl+K",
  };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.removeAttribute("data-reduce-motion");
});

describe("SelectionMenu", () => {
  it("renders nothing without a selection", () => {
    render();
    expect(host.querySelector(".selection-menu")).toBeNull();
  });

  it("offers a passage five actions and no synonyms", async () => {
    render({ menu: passage });
    await settle();
    expect(labels()).toEqual(["Comment", "Rewrite", "Describe", "Expand", "Fix"]);
    expect(props.lookup).not.toHaveBeenCalled();
    expect(bar().getAttribute("aria-label")).toBe("Selection actions");
  });

  it("reports the button pressed", async () => {
    render({ menu: passage });
    await settle();
    act(() => host.querySelector<HTMLElement>('[data-action="expand"]')!.click());
    expect(props.onAction).toHaveBeenCalledWith("expand");
  });

  it("offers a word three actions, then its synonyms, three shown and the rest behind a count", async () => {
    const list = ["homeland", "nation", "bush", "state", "land"];
    render({ menu: word, lookup: vi.fn(async () => list) });
    await settle();
    expect(props.lookup).toHaveBeenCalledWith(word.context);
    expect(labels()).toEqual(["Comment", "Describe", "Fix", "homeland", "nation", "bush", "2 more..."]);
  });

  it("holds the chips' place with a skeleton while the lookup is out", async () => {
    let resolve: (list: string[]) => void = () => {};
    render({ menu: word, lookup: vi.fn(() => new Promise<string[]>((r) => (resolve = r))) });
    await settle();
    expect(host.querySelectorAll(".selection-menu-skeleton")).toHaveLength(3);
    expect(labels()).toEqual(["Comment", "Describe", "Fix"]);
    resolve(["nation"]);
    await settle();
    expect(host.querySelectorAll(".selection-menu-skeleton")).toHaveLength(0);
    expect(labels()).toEqual(["Comment", "Describe", "Fix", "nation"]);
  });

  it("quietly drops the chips when the lookup fails or finds none", async () => {
    render({ menu: word, lookup: vi.fn(async () => Promise.reject(new Error("offline"))) });
    await settle();
    expect(labels()).toEqual(["Comment", "Describe", "Fix"]);
    expect(host.querySelector(".selection-menu-skeleton")).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("ignores a late answer for a word the writer has moved off", async () => {
    const resolvers = new Map<string, (list: string[]) => void>();
    const lookup = vi.fn(
      (context: SynonymContext) => new Promise<string[]>((r) => resolvers.set(context.word, r))
    );
    const other: SelectionMenuData = {
      ...word,
      key: "30:36",
      context: { word: "nation", before: "my ", after: "." },
    };
    render({ menu: word, lookup });
    await settle();
    render({ menu: other });
    await settle();
    resolvers.get("country")!(["homeland"]);
    await settle();
    expect(labels()).toEqual(["Comment", "Describe", "Fix"]);
    resolvers.get("nation")!(["state"]);
    await settle();
    expect(labels()).toEqual(["Comment", "Describe", "Fix", "state"]);
  });

  it("swaps in a chip's synonym", async () => {
    render({ menu: word, lookup: vi.fn(async () => ["homeland", "nation"]) });
    await settle();
    act(() => Array.from(host.querySelectorAll<HTMLElement>(".selection-menu-chip"))[1].click());
    expect(props.onSynonym).toHaveBeenCalledWith("nation", false);
  });

  it("opens the rest as a listbox and swaps in a pick from it", async () => {
    render({ menu: word, lookup: vi.fn(async () => ["a1", "b1", "c1", "d1", "e1"]) });
    await settle();
    const more = host.querySelector<HTMLElement>(".selection-menu-more")!;
    expect(more.getAttribute("aria-expanded")).toBe("false");
    act(() => more.click());
    const options = host.querySelectorAll<HTMLElement>('[role="option"]');
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(Array.from(options).map((o) => o.textContent)).toEqual(["d1", "e1"]);
    expect(document.activeElement).toBe(options[0]);
    press(options[0], "ArrowDown");
    expect(document.activeElement).toBe(options[1]);
    act(() => options[1].click());
    expect(props.onSynonym).toHaveBeenCalledWith("e1", true);
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it("closes the list on Escape and puts focus back on the count", async () => {
    render({ menu: word, lookup: vi.fn(async () => ["a1", "b1", "c1", "d1"]) });
    await settle();
    const more = host.querySelector<HTMLElement>(".selection-menu-more")!;
    act(() => more.click());
    press(host.querySelector('[role="option"]')!, "Escape");
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(more);
    expect(props.onEscape).not.toHaveBeenCalled();
  });

  it("walks the buttons with the arrow keys, one stop in the Tab order", async () => {
    render({ menu: passage });
    await settle();
    const items = Array.from(host.querySelectorAll<HTMLElement>("[data-roving]"));
    expect(items.map((el) => el.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    act(() => items[0].focus());
    press(items[0], "ArrowRight");
    expect(document.activeElement).toBe(items[1]);
    press(items[1], "End");
    expect(document.activeElement).toBe(items[4]);
    press(items[4], "ArrowRight");
    expect(document.activeElement).toBe(items[0]);
    press(items[0], "ArrowLeft");
    expect(document.activeElement).toBe(items[4]);
    act(() => items[4].blur());
  });

  it("moves focus to the first button when the shortcut is pressed", async () => {
    render({ menu: passage, focusRequest: 0 });
    await settle();
    render({ focusRequest: 1 });
    await settle();
    expect(document.activeElement).toBe(host.querySelector('[data-action="comment"]'));
    expect(props.onFocusChange).toHaveBeenCalledWith(true);
  });

  it("hands Escape back to the editor", async () => {
    render({ menu: passage, focusRequest: 1 });
    await settle();
    press(document.activeElement!, "Escape");
    expect(props.onEscape).toHaveBeenCalledTimes(1);
  });

  it("keeps the caret in the page when a button is pressed with the mouse", async () => {
    render({ menu: passage });
    await settle();
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    host.querySelector('[data-action="fix"]')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("goes icons-only in a narrow pane without losing the names", async () => {
    render({ menu: { ...passage, maxRight: 300 } });
    await settle();
    expect(host.querySelector(".selection-menu")!.hasAttribute("data-compact")).toBe(true);
    expect(labels()).toContain("Rewrite");
  });
});
