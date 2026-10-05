// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatPanel from "@/components/ChatPanel";

let host: HTMLDivElement;
let root: Root;
let snapshot: { messages: unknown[]; runs: unknown[] };
let posts: Array<Record<string, unknown>>;

const message = (id: string, role: string, turnId: string, content: string) => ({
  id,
  projectId: "p1",
  role,
  content,
  kind: "chat",
  turnId,
  status: "complete",
  createdAt: "2026-01-01T00:00:00.000Z",
});
const run = (turnId: string, editsAllowed: boolean) => ({
  id: `run-${turnId}`,
  projectId: "p1",
  turnId,
  status: "completed",
  visibleOutput: "ok",
  iterationCount: 1,
  mutationCount: 0,
  editsAllowed,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

function ndjson(lines: unknown[]) {
  return new Response(lines.map((line) => JSON.stringify(line)).join("\n") + "\n", {
    headers: { "content-type": "application/x-ndjson" },
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout, so no scrolling.
  Element.prototype.scrollTo = () => {};
  sessionStorage.clear();
  snapshot = { messages: [], runs: [] };
  posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/chat/insertions")) return Response.json([]);
      if (url.startsWith("/api/chat?") && method === "GET") return Response.json(snapshot);
      if (url.startsWith("/api/chat?") && method === "DELETE") {
        snapshot = { messages: [], runs: [] };
        return Response.json({ ok: true, archivedAt: null, count: 0 });
      }
      if (url === "/api/chat" && method === "POST") {
        posts.push(JSON.parse(String(init?.body)));
        return ndjson([
          { type: "turn", id: "turn-new", runId: "run-new" },
          { type: "text", v: "Done." },
          { type: "done", status: "completed", runId: "run-new" },
        ]);
      }
      return Response.json({});
    })
  );
  vi.stubGlobal("confirm", () => true);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });

async function mount() {
  await act(async () =>
    root.render(
      <ChatPanel
        projectId="p1"
        activeChapterId="c1"
        chapters={[
          { id: "c1", title: "One", order: 0 },
          { id: "c2", title: "Two", order: 1 },
        ]}
        getSelection={() => ""}
        onInsertDraft={() => {}}
      />
    )
  );
  await settle();
}

const option = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
    (el) => el.textContent === label
  )!;
const checked = () =>
  [...host.querySelectorAll('[role="radio"]')]
    .filter((el) => el.getAttribute("aria-checked") === "true")
    .map((el) => el.textContent);
const click = (el: Element) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const chip = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".chip")].find((el) => el.textContent === label)!;

async function sendText(text: string) {
  const box = host.querySelector("textarea")!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    set.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(host.querySelector(".composer-action")!);
  await settle();
}

describe("the chat's Allow edits / Chat only switch", () => {
  it("defaults to Allow edits and sends editsAllowed with the turn", async () => {
    await mount();
    expect(checked()).toEqual(["Allow edits"]);
    await sendText("hello");
    expect(posts[0]).toMatchObject({ message: "hello", editsAllowed: true });
  });

  it("sends Chat only once chosen, and keeps it for the next message", async () => {
    await mount();
    await click(option("Chat only"));
    expect(checked()).toEqual(["Chat only"]);
    await sendText("what do you think?");
    await sendText("and now?");
    expect(posts.map((p) => p.editsAllowed)).toEqual([false, false]);
    expect(checked()).toEqual(["Chat only"]);
  });

  it("comes back on Chat only after a reload while the conversation continues", async () => {
    snapshot = {
      messages: [message("m1", "user", "t1", "hi"), message("m2", "assistant", "t1", "hello")],
      runs: [run("t1", false)],
    };
    await mount();
    expect(checked()).toEqual(["Chat only"]);
  });

  it("goes back to Allow edits on a new thread (Clear chat)", async () => {
    snapshot = {
      messages: [message("m1", "user", "t1", "hi"), message("m2", "assistant", "t1", "hello")],
      runs: [run("t1", false)],
    };
    await mount();
    expect(checked()).toEqual(["Chat only"]);
    const clear = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (el) => el.textContent === "Clear chat"
    )!;
    await click(clear);
    await settle();
    expect(checked()).toEqual(["Allow edits"]);
    await sendText("fresh start");
    expect(posts[0]).toMatchObject({ editsAllowed: true });
  });

  it("explains that edits are off, rather than sending, when a shortcut would write", async () => {
    await mount();
    await click(option("Chat only"));
    await click(chip("Fix misplaced passages"));
    expect(posts).toHaveLength(0);
    expect(host.querySelector(".edits-notice")?.textContent).toContain("Edits are off");
    // The notice offers the way back, and a read-only shortcut still sends.
    const allow = host.querySelector<HTMLButtonElement>(".edits-notice button")!;
    await click(allow);
    expect(checked()).toEqual(["Allow edits"]);
    expect(host.querySelector(".edits-notice")).toBeNull();
    await click(option("Chat only"));
    await click(chip("Find loose ends"));
    await settle();
    expect(posts[0]).toMatchObject({ editsAllowed: false, kind: "action" });
  });

  it("turns Auto off while edits are off", async () => {
    await mount();
    const auto = () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")].find((el) =>
        el.textContent?.startsWith("Auto")
      )!;
    await click(auto());
    expect(auto().textContent).toBe("Auto on");
    await click(option("Chat only"));
    expect(auto().textContent).toBe("Auto off");
    expect(auto().disabled).toBe(true);
  });
});
