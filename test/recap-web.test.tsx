// @vitest-environment jsdom

import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PreviouslyOn from "@/components/PreviouslyOn";
import StuckPrompts from "@/components/StuckPrompts";
import { RECAP_ABSENCE_MS } from "@/lib/recap-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.fn();

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function button(label: string): HTMLElement {
  const found = Array.from(host.querySelectorAll<HTMLElement>("button")).find((el) =>
    el.textContent?.includes(label)
  );
  if (!found) throw new Error(`No button "${label}"`);
  return found;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("PreviouslyOn", () => {
  it("stays quiet on a first open and on a quick return", async () => {
    await act(async () => root.render(<PreviouslyOn projectId="p1" />));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => root.render(<PreviouslyOn projectId="p1" key="again" />));
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.textContent).toBe("");
  });

  it("shows a dismissable recap after an absence", async () => {
    window.localStorage.setItem(
      "ciciro:last-opened:p1",
      String(Date.now() - RECAP_ABSENCE_MS - 1000)
    );
    fetchMock.mockResolvedValue(
      json({ recap: { text: "You left Marta on the pier.", generatedAt: "" } })
    );
    await act(async () => root.render(<PreviouslyOn projectId="p1" />));
    await settle();
    expect(host.textContent).toContain("You left Marta on the pier.");
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/recap");

    await act(async () => button("Dismiss").click());
    expect(host.textContent).toBe("");
  });

  it("still shows the recap under Strict Mode's double effect run", async () => {
    window.localStorage.setItem(
      "ciciro:last-opened:p1",
      String(Date.now() - RECAP_ABSENCE_MS - 1000)
    );
    fetchMock.mockImplementation(async () =>
      json({ recap: { text: "You left Marta on the pier.", generatedAt: "" } })
    );
    await act(async () =>
      root.render(
        <StrictMode>
          <PreviouslyOn projectId="p1" />
        </StrictMode>
      )
    );
    await settle();
    expect(host.textContent).toContain("You left Marta on the pier.");
  });

  it("shows nothing when there is no recap", async () => {
    window.localStorage.setItem("ciciro:last-opened:p1", "1");
    fetchMock.mockResolvedValue(json({ recap: null }));
    await act(async () => root.render(<PreviouslyOn projectId="p1" />));
    await settle();
    expect(host.textContent).toBe("");
  });
});

describe("StuckPrompts", () => {
  it("offers prompts and hands the chosen one over", async () => {
    fetchMock.mockResolvedValue(json({ prompts: ["Find the letter.", "Cut to the storm."] }));
    const onUse = vi.fn();
    await act(async () => root.render(<StuckPrompts projectId="p1" chapterId="c1" onUse={onUse} />));
    await act(async () => button("stuck").click());
    await settle();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ chapterId: "c1" });

    await act(async () => button("Cut to the storm.").click());
    expect(onUse).toHaveBeenCalledWith("Cut to the storm.");
    expect(host.textContent).not.toContain("Find the letter.");
  });

  it("keeps the newest ideas when an older request answers last", async () => {
    let resolveOld: (res: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (resolveOld = resolve)));
    fetchMock.mockResolvedValueOnce(json({ prompts: ["New idea."] }));
    await act(async () => root.render(<StuckPrompts projectId="p1" chapterId="c1" onUse={vi.fn()} />));
    await act(async () => button("stuck").click());
    await act(async () => button("stuck").click());
    await settle();
    expect(host.textContent).toContain("New idea.");

    resolveOld(json({ prompts: ["Old idea."] }));
    await settle();
    expect(host.textContent).toContain("New idea.");
    expect(host.textContent).not.toContain("Old idea.");
  });

  it("shows the server's error and lets the author retry", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Could not get ideas right now." }, 502));
    await act(async () => root.render(<StuckPrompts projectId="p1" chapterId="c1" onUse={vi.fn()} />));
    await act(async () => button("stuck").click());
    await settle();
    expect(host.textContent).toContain("Could not get ideas right now.");

    fetchMock.mockResolvedValueOnce(json({ prompts: ["Try this."] }));
    await act(async () => button("More ideas").click());
    await settle();
    expect(host.textContent).toContain("Try this.");
  });
});
