// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatPanel from "@/components/ChatPanel";
import KnowledgeBoard from "@/components/KnowledgeBoard";
import StoryBible from "@/components/StoryBible";
import type { ClientUiEvent } from "@/lib/types";

// A chat run that records or retires a who-knows-what fact tells the desk, so
// an open Knowledge drawer or character file shows the change without reopening.

let host: HTMLDivElement;
let root: Root;
let ledger: Array<Record<string, unknown>>;
let joeFile: string;
let gets: string[];

const chapter = { id: "c1", title: "One", order: 0 };
const fact = (id: string, text: string) => ({
  id,
  characterPath: "characters/joe.md",
  fact: text,
  stance: "knows",
  topic: null,
  status: "active",
  chapterId: "c1",
  supersededAtChapterId: null,
  sourceQuote: "",
  chapter,
  supersededAtChapter: null,
});

function ndjson(lines: unknown[]) {
  return new Response(lines.map((line) => JSON.stringify(line)).join("\n") + "\n", {
    headers: { "content-type": "application/x-ndjson" },
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollTo = () => {};
  sessionStorage.clear();
  ledger = [fact("f1", "Mara took the pen")];
  joeFile = "# Joe\n";
  gets = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") gets.push(url);
      if (url.startsWith("/api/chat/insertions")) return Response.json([]);
      if (url.startsWith("/api/chat?")) return Response.json({ messages: [], runs: [] });
      if (url === "/api/chat" && method === "POST") {
        return ndjson([
          { type: "turn", id: "turn-new", runId: "run-new" },
          { type: "knowledge_changed", characterPath: "characters/joe.md" },
          { type: "text", v: "Recorded." },
          { type: "done", status: "completed", runId: "run-new" },
        ]);
      }
      if (url.startsWith("/api/projects/p1/knowledge")) return Response.json({ facts: ledger });
      if (url === "/api/bible?projectId=p1") {
        return Response.json([{ path: "characters/joe.md", summary: "Joe" }]);
      }
      if (url.startsWith("/api/bible?projectId=p1&path=")) return Response.json({ content: joeFile });
      return Response.json({});
    })
  );
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
const click = (el: Element) => act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

describe("knowledge_changed on the web", () => {
  it("is forwarded from the chat stream to the workspace", async () => {
    const events: ClientUiEvent[] = [];
    await act(async () =>
      root.render(
        <ChatPanel
          projectId="p1"
          activeChapterId="c1"
          chapters={[chapter]}
          getSelection={() => ""}
          onInsertDraft={() => {}}
          onUiEvent={(evt) => events.push(evt)}
        />
      )
    );
    await settle();
    const box = host.querySelector("textarea")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(box, "Joe knows Mara took the pen");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(host.querySelector(".composer-action")!);
    await settle();
    expect(events).toContainEqual({ type: "knowledge_changed", characterPath: "characters/joe.md" });
  });

  it("refetches the open Knowledge drawer", async () => {
    const render = (knowledgeChange: number) =>
      act(async () =>
        root.render(
          <KnowledgeBoard
            projectId="p1"
            chapters={[chapter]}
            activeChapterId="c1"
            knowledgeChange={knowledgeChange}
            onClose={() => {}}
          />
        )
      );
    await render(0);
    await settle();
    expect(host.textContent).toContain("Mara took the pen");
    expect(host.textContent).not.toContain("Suzy has the key");

    ledger = [...ledger, fact("f2", "Suzy has the key")];
    await render(1);
    await settle();
    expect(host.textContent).toContain("Suzy has the key");
  });

  it("reloads an open character file and its ledger box, but never over unsaved edits", async () => {
    const render = (knowledgeChange: number) =>
      act(async () =>
        root.render(
          <StoryBible
            projectId="p1"
            activeChapter={chapter}
            knowledgeChange={knowledgeChange}
            onClose={() => {}}
            onOpenKnowledge={() => {}}
          />
        )
      );
    await render(0);
    await settle();
    const entry = [...host.querySelectorAll(".bible-item")].find((el) => el.textContent?.includes("characters/joe.md"));
    await click(entry!);
    await settle();
    const textarea = () => host.querySelector("textarea")!;
    expect(textarea().value).toBe("# Joe\n");

    joeFile = "# Joe\n\n- knows: Suzy has the key\n";
    ledger = [...ledger, fact("f2", "Suzy has the key")];
    await render(1);
    await settle();
    expect(textarea().value).toBe(joeFile);
    expect(host.textContent).toContain("Suzy has the key");

    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(textarea(), "# Joe, being edited\n");
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
    joeFile = "# Joe\n\nchanged again\n";
    await render(2);
    await settle();
    expect(textarea().value).toBe("# Joe, being edited\n");
  });
});
