// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Scratchpad from "@/components/Scratchpad";
import type { ScratchNote } from "@/lib/scratch-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function note(over: Partial<ScratchNote> = {}): ScratchNote {
  return {
    id: "n1",
    projectId: "p1",
    title: "Tides",
    content: "moon",
    revision: 2,
    createdAt: "",
    updatedAt: "",
    ...over,
  } as ScratchNote;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let root: Root;
let host: HTMLDivElement;
let saveFails: boolean;
let server: ScratchNote;
const patches: Array<Record<string, unknown>> = [];

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(label: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>("button, [role=button]")).find(
    (el) => el.textContent?.includes(label)
  );
  if (!found) throw new Error(`No button "${label}"`);
  return found;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
  await settle();
}

async function type(value: string) {
  const area = host.querySelector("textarea")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  patches.length = 0;
  saveFails = true;
  server = note();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patches.push(body);
        if (saveFails) return json({ error: "Server unavailable" }, 500);
        server = note({ ...body, revision: server.revision + 1 });
        return json(server);
      }
      return json({ notes: [server] });
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

describe("Scratchpad after a failed save", () => {
  it("lets the writer leave, keeps the typing, and saves it on a later retry", async () => {
    const onClose = vi.fn();
    await act(async () => root.render(<Scratchpad projectId="p1" onClose={onClose} />));
    await settle();

    await click(button("Tides"));
    await type("moon and tides");
    await click(button("All notes"));

    expect(patches.length).toBeGreaterThan(0);
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).toContain("Not saved yet, will retry");

    await click(button("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);

    await click(button("Tides"));
    expect(host.querySelector("textarea")!.value).toBe("moon and tides");
    await click(button("All notes"));

    saveFails = false;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    await settle();

    expect(patches.at(-1)).toMatchObject({ content: "moon and tides", expectedRevision: 2 });
    expect(server.content).toBe("moon and tides");
    expect(host.textContent).not.toContain("Not saved yet");
  });
});
