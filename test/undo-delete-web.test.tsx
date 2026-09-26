// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BetaReaders from "@/components/BetaReaders";
import ChapterSidebar from "@/components/ChapterSidebar";
import Scratchpad from "@/components/Scratchpad";
import { SNACKBAR_MS, SnackbarProvider } from "@/components/Snackbar";
import type { Chapter } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let root: Root;
let host: HTMLDivElement;
let calls: Array<{ url: string; method: string }>;

const note = (id: string, title: string) => ({
  id,
  projectId: "p1",
  title,
  content: "body",
  revision: 1,
  createdAt: "",
  updatedAt: "",
});
const comment = (id: string) => ({
  id,
  shareLinkId: "l1",
  linkLabel: "Group",
  chapterId: "c1",
  chapterTitle: "One",
  readerName: "Ada",
  body: `Comment ${id}`,
  quote: "quoted",
  status: "open",
  createdAt: "2026-09-01T00:00:00.000Z",
  resolvedAt: null,
  anchor: null,
});
const link = (id: string) => ({
  id,
  projectId: "p1",
  label: `Link ${id}`,
  path: `/read/${id}`,
  token: id,
  chapterIds: [],
  expiresAt: null,
  revokedAt: null,
  status: "active",
  commentCount: 2,
  openCommentCount: 1,
});

function routes(url: string, method: string) {
  if (method === "DELETE") return json({ ok: true });
  if (url.endsWith("/scratch")) return json({ notes: [note("n1", "Tides"), note("n2", "Names")] });
  if (url.includes("/share-comments")) return json({ comments: [comment("k1"), comment("k2")] });
  if (url.endsWith("/shares")) return json({ links: [link("s1")] });
  return json({});
}

const label = (el: Element) => el.textContent ?? "";
// Everything but the snackbar, which repeats the deleted thing's name.
const text = () =>
  Array.from(host.children)
    .filter((el) => !el.classList.contains("snackbar-region"))
    .map((el) => el.textContent)
    .join(" ");
const bar = () => document.querySelector(".snackbar");
const undo = () => document.querySelector<HTMLButtonElement>(".snackbar-action")!;
const deleted = () => calls.filter((c) => c.method === "DELETE");

function button(name: string, within: ParentNode = host): HTMLButtonElement {
  const found = Array.from(within.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => label(b).includes(name) || b.getAttribute("aria-label") === name
  );
  if (!found) throw new Error(`No button "${name}"`);
  return found;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  document.documentElement.setAttribute("data-reduce-motion", "true");
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method });
      return routes(url, method);
    })
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.removeAttribute("data-reduce-motion");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mount(node: React.ReactNode) {
  await act(async () => root.render(<SnackbarProvider>{node}</SnackbarProvider>));
  await settle();
}

describe("scratch notes", () => {
  it("removes the note at once and only deletes it on the server when Undo has lapsed", async () => {
    await mount(<Scratchpad projectId="p1" onClose={() => {}} />);
    expect(text()).toContain("Tides");
    await act(async () => button("Delete Tides").click());
    await settle();
    expect(text()).not.toContain("Tides");
    expect(text()).toContain("Names");
    expect(label(bar()!)).toContain('Deleted "Tides"');
    expect(deleted()).toEqual([]);

    await act(async () => void vi.advanceTimersByTime(SNACKBAR_MS + 1));
    await settle();
    expect(deleted()).toEqual([{ url: "/api/projects/p1/scratch/n1", method: "DELETE" }]);
  });

  it("brings the note back on Undo and never deletes it", async () => {
    await mount(<Scratchpad projectId="p1" onClose={() => {}} />);
    await act(async () => button("Delete Tides").click());
    await settle();
    await act(async () => undo().click());
    await settle();
    expect(text()).toContain("Tides");
    await act(async () => void vi.advanceTimersByTime(SNACKBAR_MS * 2));
    await settle();
    expect(deleted()).toEqual([]);
  });

  it("shows placeholder rows, not blank space, until the first fetch answers", async () => {
    let answer: (res: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve)))
    );
    await mount(<Scratchpad projectId="p1" onClose={() => {}} />);
    expect(host.querySelector('[aria-label="Loading notes"] .skeleton')).not.toBeNull();
    await act(async () => answer(json({ notes: [note("n1", "Tides")] })));
    await settle();
    expect(host.querySelector(".skeleton")).toBeNull();
    expect(text()).toContain("Tides");
  });
});

describe("beta reader comments and links", () => {
  const mountBeta = (tab: "comments" | "links") =>
    mount(
      <BetaReaders
        projectId="p1"
        chapters={[{ id: "c1", title: "One" }]}
        activeChapterId="c1"
        tab={tab}
        onTabChange={() => {}}
        focusCommentId={null}
        onJump={() => {}}
        onCommentsChanged={onChanged}
        onClose={() => {}}
      />
    );
  const onChanged = vi.fn();

  it("deletes a comment only after Undo has lapsed, then tells the editor", async () => {
    await mountBeta("comments");
    expect(text()).toContain("Comment k1");
    const first = host.querySelector<HTMLElement>('[data-comment-id="k1"]')!;
    await act(async () => button("Delete", first).click());
    await settle();
    expect(text()).not.toContain("Comment k1");
    expect(deleted()).toEqual([]);
    expect(onChanged).not.toHaveBeenCalled();

    await act(async () => void vi.advanceTimersByTime(SNACKBAR_MS + 1));
    await settle();
    expect(deleted()).toEqual([{ url: "/api/share-comments/k1", method: "DELETE" }]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("restores a comment on Undo", async () => {
    await mountBeta("comments");
    const first = host.querySelector<HTMLElement>('[data-comment-id="k1"]')!;
    await act(async () => button("Delete", first).click());
    await settle();
    await act(async () => undo().click());
    await settle();
    expect(text()).toContain("Comment k1");
    expect(deleted()).toEqual([]);
  });

  it("deletes a link without a confirm dialog, and says its comments go too", async () => {
    const confirm = vi.spyOn(window, "confirm");
    await mountBeta("links");
    await act(async () => button("Delete").click());
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(label(bar()!)).toContain("Link deleted and 2 comments");
    expect(text()).not.toContain("Link s1");
    await act(async () => void vi.advanceTimersByTime(SNACKBAR_MS + 1));
    await settle();
    expect(deleted()).toEqual([{ url: "/api/shares/s1", method: "DELETE" }]);
  });
});

describe("chapters", () => {
  const chapter = (id: string, title: string, content: string): Chapter =>
    ({ id, title, content, wordCount: 0, status: "draft", order: 0 }) as unknown as Chapter;

  it("hands an empty chapter's delete straight over, with no confirm dialog", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const onDelete = vi.fn();
    await act(async () =>
      root.render(
        <ChapterSidebar
          chapters={[chapter("a", "One", "<p>Words</p>"), chapter("b", "Two", "")]}
          activeId="a"
          onSelect={() => {}}
          onAdd={() => {}}
          onDelete={onDelete}
          leavingIds={new Set(["b"])}
        />
      )
    );
    const row = host.querySelector('[data-row-id="b"]')!;
    expect(row.classList.contains("is-leaving")).toBe(true);
    await act(async () => row.querySelector<HTMLElement>('[role="button"]')!.click());
    expect(confirm).not.toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledWith("b");
  });
});
