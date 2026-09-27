// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DictationButton, { DICTATION_ERROR_MS } from "@/components/DictationButton";
import OutlineBoard from "@/components/OutlineBoard";
import Presence from "@/components/Presence";
import SearchPanel from "@/components/SearchPanel";
import { SnackbarProvider } from "@/components/Snackbar";
import { useFocusPhase, type FocusPhase } from "@/lib/focus-phase";
import { MOTION_MS } from "@/lib/motion";
import type { Chapter } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.removeAttribute("data-reduce-motion");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const reduce = () => document.documentElement.setAttribute("data-reduce-motion", "true");
const advance = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));

describe("Presence", () => {
  const render = (open: boolean) =>
    act(async () => root.render(<Presence open={open}><div className="drawer" /></Presence>));

  it("stays mounted, inert, while its exit plays, then goes", async () => {
    await render(true);
    const wrapper = () => host.querySelector<HTMLElement>(".presence");
    expect(wrapper()?.dataset.state).toBe("open");
    expect(wrapper()?.hasAttribute("inert")).toBe(false);

    await render(false);
    expect(wrapper()?.dataset.state).toBe("closed");
    expect(wrapper()?.hasAttribute("inert")).toBe(true);
    await advance(MOTION_MS.drawerOut - 1);
    expect(wrapper()).not.toBeNull();
    await advance(2);
    expect(wrapper()).toBeNull();
  });

  it("unmounts at once when motion is reduced", async () => {
    reduce();
    await render(true);
    await render(false);
    expect(host.querySelector(".presence")).toBeNull();
  });

  it("is not mounted until first opened", async () => {
    await render(false);
    expect(host.querySelector(".presence")).toBeNull();
  });
});

describe("useFocusPhase", () => {
  let seen: FocusPhase;
  function Probe({ active }: { active: boolean }) {
    seen = useFocusPhase(active);
    return null;
  }
  const render = (active: boolean) => act(async () => root.render(<Probe active={active} />));

  it("hands over in two steps so the chrome can fade before it is removed", async () => {
    await render(false);
    expect(seen).toBe("off");
    await render(true);
    expect(seen).toBe("entering");
    await advance(MOTION_MS.focus + 1);
    expect(seen).toBe("on");
  });

  it("brings the chrome back hidden for a paint, then lets it fade in", async () => {
    await render(true);
    await advance(MOTION_MS.focus + 1);
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => setTimeout(() => fn(0), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    await render(false);
    expect(seen).toBe("leaving");
    await advance(40);
    expect(seen).toBe("off");
  });

  it("switches instantly when motion is reduced", async () => {
    reduce();
    await render(true);
    expect(seen).toBe("on");
    await render(false);
    expect(seen).toBe("off");
  });
});

describe("DictationButton", () => {
  class FakeRecognizer {
    static last: FakeRecognizer;
    lang = "";
    continuous = false;
    interimResults = false;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    constructor() {
      FakeRecognizer.last = this;
    }
    start() {}
    stop() {}
    abort() {}
  }

  async function mount() {
    vi.stubGlobal("SpeechRecognition", FakeRecognizer);
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognizer;
    await act(async () => root.render(<DictationButton onPhrase={() => {}} />));
    await act(async () => host.querySelector<HTMLButtonElement>(".dictation-mic")!.click());
  }

  it("rings the mic while listening", async () => {
    await mount();
    expect(host.querySelector(".dictation-mic")?.classList.contains("listening")).toBe(true);
  });

  it("shows a fatal error, drains a 5s bar, and dismisses itself", async () => {
    reduce();
    await mount();
    await act(async () => FakeRecognizer.last.onerror?.({ error: "not-allowed" }));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Microphone access is blocked");
    const bar = host.querySelector<HTMLElement>(".dictation-error-bar")!;
    expect(bar.style.animationDuration).toBe(`${DICTATION_ERROR_MS}ms`);
    await advance(DICTATION_ERROR_MS - 1);
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await advance(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector(".dictation-mic")?.classList.contains("listening")).toBe(false);
  });

  it("can be dismissed early by clicking it", async () => {
    reduce();
    await mount();
    await act(async () => FakeRecognizer.last.onerror?.({ error: "audio-capture" }));
    await act(async () => host.querySelector<HTMLElement>('[role="alert"]')!.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("SearchPanel replace", () => {
  const match = (offset: number) => ({
    chapterId: "c1",
    chapterTitle: "One",
    chapterNumber: 1,
    blockId: "b1",
    occurrence: offset,
    offset,
    length: 3,
    before: "a ",
    match: "cat",
    after: " sat",
  });

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  async function mount(onReplaced: () => unknown) {
    reduce();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/replace")) {
          return json({
            replaced: 13,
            chapters: [{ id: "c1", content: "<p>x</p>", revision: 4, wordCount: 1, replaced: 13 }],
          });
        }
        return json({ total: 13, chapters: 1, truncated: false, matches: [match(0), match(1)] });
      })
    );
    await act(async () =>
      root.render(
        <SnackbarProvider>
          <SearchPanel
            projectId="p1"
            onClose={() => {}}
            onJump={() => {}}
            flushSaves={async () => true}
            onReplaced={onReplaced as never}
          />
        </SnackbarProvider>
      )
    );
    const input = host.querySelector<HTMLInputElement>('[aria-label="Find"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "cat");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await advance(300);
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  }

  it("ends Replace all with an undoable snackbar and no confirm dialog", async () => {
    const undo = vi.fn(async () => true);
    const confirm = vi.spyOn(window, "confirm");
    await mount(() => undo);
    const all = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Replace all"
    )!;
    await act(async () => all.click());
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(host.querySelector(".snackbar-message")?.textContent).toBe("Replaced 13 in 1 chapter");
    await act(async () => host.querySelector<HTMLButtonElement>(".snackbar-action")!.click());
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("tells the writer what a partial Undo restored and refreshes the hits, even after a failed one", async () => {
    const undo = vi.fn(async () => ({ restored: 1, total: 2, changed: 1, failed: 0 }));
    await mount(() => undo);
    const searches = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) => !String(u).includes("/replace")).length;
    const all = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Replace all"
    )!;
    await act(async () => all.click());
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    const before = searches();
    await act(async () => host.querySelector<HTMLButtonElement>(".snackbar-action")!.click());
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(host.querySelector(".snackbar-message")?.textContent).toBe("Restored 1 of 2 chapters: 1 edited since and left as it is.");
    expect(searches()).toBeGreaterThan(before);
  });

  it("refreshes the hits after an Undo that restored nothing", async () => {
    const undo = vi.fn(async () => ({ restored: 0, total: 1, changed: 0, failed: 0, blocked: "unsaved" as const }));
    await mount(() => undo);
    const searches = () =>
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([u]) => !String(u).includes("/replace")).length;
    const all = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Replace all"
    )!;
    await act(async () => all.click());
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    const before = searches();
    await act(async () => host.querySelector<HTMLButtonElement>(".snackbar-action")!.click());
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(host.querySelector(".snackbar-message")?.textContent).toMatch(/haven't saved/);
    expect(searches()).toBeGreaterThan(before);
  });

  it("offers no Undo when the owner cannot take a replace back", async () => {
    await mount(() => undefined);
    const all = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent === "Replace all"
    )!;
    await act(async () => all.click());
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    expect(host.querySelector(".snackbar-message")?.textContent).toBe("Replaced 13 in 1 chapter");
    expect(host.querySelector(".snackbar-action")).toBeNull();
  });
});

describe("OutlineBoard drag", () => {
  const chapter = (id: string, title: string): Chapter =>
    ({ id, title, content: "", summary: "", wordCount: 0, status: "draft", order: 0 }) as unknown as Chapter;
  const chapters = [chapter("a", "One"), chapter("b", "Two"), chapter("c", "Three")];

  // jsdom has no layout: give every grid child a 100px slot by its position (the
  // carried card is out of the flow, so it takes none).
  const define = (name: string, get: (el: HTMLElement) => number) =>
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get() { return get(this as HTMLElement); } });
  const slot = (el: HTMLElement) =>
    Array.from(el.parentElement?.children ?? []).filter((c) => !c.classList.contains("dragging")).indexOf(el);

  beforeEach(() => {
    reduce();
    define("offsetLeft", (el) => (el.classList.contains("outline-card") ? slot(el) * 100 : 0));
    define("offsetTop", () => 0);
    define("offsetWidth", (el) => (el.classList.contains("outline-card") ? 90 : 0));
    define("offsetHeight", () => 50);
  });
  afterEach(() => {
    for (const name of ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"]) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
  });

  const pointer = (type: string, x: number, y: number, target: EventTarget = window) =>
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }) as unknown as PointerEvent
    );

  async function mount(onReorder = vi.fn(), onOpen = vi.fn()) {
    await act(async () =>
      root.render(
        <OutlineBoard
          chapters={chapters}
          activeId="a"
          onOpen={onOpen}
          onReorder={onReorder}
          onStatusChange={() => {}}
          onClose={() => {}}
        />
      )
    );
    return { onReorder, onOpen };
  }

  const cards = () => Array.from(host.querySelectorAll<HTMLElement>(".outline-card:not(.placeholder)"));

  it("carries the card, holds its place with a dashed gap, and drops it in the new slot", async () => {
    const { onReorder } = await mount();
    const first = cards()[0];
    await act(async () => void first.dispatchEvent(Object.assign(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10, button: 0 }))));
    await act(async () => void pointer("pointermove", 60, 10));
    expect(first.classList.contains("dragging")).toBe(true);
    expect(host.querySelector(".outline-card.placeholder")).not.toBeNull();

    // Over the third slot (x 200..290).
    await act(async () => void pointer("pointermove", 250, 10));
    await act(async () => void pointer("pointerup", 250, 10));
    expect(onReorder).toHaveBeenCalledWith(["b", "c", "a"]);
    expect(host.querySelector(".dragging")).toBeNull();
    expect(host.querySelector(".placeholder")).toBeNull();
  });

  it("does not reorder, or open the chapter, when a drag is dropped where it started", async () => {
    const { onReorder, onOpen } = await mount();
    const first = cards()[0];
    await act(async () => void first.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10, button: 0 })));
    await act(async () => void pointer("pointermove", 40, 10));
    await act(async () => void pointer("pointerup", 40, 10));
    await act(async () => first.querySelector<HTMLButtonElement>(".outline-title")!.click());
    expect(onReorder).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    // The click after that is a real one.
    await advance(1);
    await act(async () => first.querySelector<HTMLButtonElement>(".outline-title")!.click());
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("leaves the arrows and the status select to their own clicks", async () => {
    const { onReorder } = await mount();
    await act(async () => cards()[0].querySelector<HTMLButtonElement>('[aria-label="Move One later"]')!.click());
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
  });
});
