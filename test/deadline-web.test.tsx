// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeadlineCard from "@/components/DeadlineCard";
import DeadlinePanel from "@/components/DeadlinePanel";
import { SNACKBAR_MS, SnackbarProvider } from "@/components/Snackbar";
import { useDeadline } from "@/lib/use-deadline";
import { writingDayKey, shiftWritingDayKey } from "@/lib/writing-day";

const track = vi.fn();
vi.mock("@/lib/analytics-client", () => ({ getAnalytics: () => ({ track }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PID = "p1";
const TARGET_URL = `/api/projects/${PID}/target`;

type Target = { projectId: string; wordGoal: number; deadline: string; manuscriptWords: number; pace: unknown };

let server: { target: Target | null };
const calls: { method: string; url: string; body?: unknown }[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, url, body });
  if (url.startsWith("/api/writing/days")) return json({ days: [] });
  if (url === TARGET_URL) {
    if (method === "PUT") {
      server.target = { projectId: PID, ...body, manuscriptWords: 0, pace: null };
      return json({ target: server.target });
    }
    if (method === "DELETE") {
      server.target = null;
      return json({ ok: true });
    }
    return json({ target: server.target });
  }
  return json({ error: "unexpected " + url }, 500);
});

const targetCalls = (method: string) => calls.filter((c) => c.url === TARGET_URL && c.method === method);

function Harness({ words, open }: { words: number; open: boolean }) {
  const deadline = useDeadline(PID, words);
  return (
    <>
      <DeadlineCard deadline={deadline} onOpen={() => {}} />
      {open && <DeadlinePanel deadline={deadline} manuscriptWords={words} onClose={() => {}} />}
    </>
  );
}

let host: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function render(words: number, open = true) {
  await act(async () =>
    root.render(
      <SnackbarProvider>
        <Harness words={words} open={open} />
      </SnackbarProvider>
    )
  );
  await settle();
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((el) =>
    el.textContent?.includes(label)
  );
  if (!found) throw new Error(`No button "${label}"`);
  return found;
}

/** Typing into a React-controlled input. */
async function type(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  calls.length = 0;
  server = { target: null };
  fetchMock.mockClear();
  track.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the web deadline", () => {
  it("offers a round first target and a due date a month out for a manuscript with none", async () => {
    await render(1_200);
    expect(host.querySelector(".deadline-card")).toBeNull();
    expect(host.querySelector<HTMLInputElement>("#deadline-target")!.value).toBe("2500");
    expect(host.querySelector<HTMLInputElement>("#deadline-date")!.value).toBe(
      shiftWritingDayKey(writingDayKey(), 30)
    );
    expect(host.textContent).toContain("1,200 words written so far.");
    expect(button("Set deadline").disabled).toBe(false);
    expect(host.textContent).not.toContain("Remove deadline");
  });

  it("saves a target through the API and then shows the ring, the verdict and the card", async () => {
    await render(1_200);
    await type("#deadline-target", "10,000");
    await submit();
    expect(targetCalls("PUT")).toHaveLength(1);
    expect(targetCalls("PUT")[0].body).toEqual({
      wordGoal: 10_000,
      deadline: shiftWritingDayKey(writingDayKey(), 30),
    });
    expect(host.querySelector(".deadline-headline")!.textContent).toBe("Due in 30 days");
    expect(host.querySelector(".deadline-progress")!.textContent).toBe("1,200 of 10,000 words");
    expect(host.querySelector('[data-testid="deadline-verdict"]')!.textContent).toContain(
      "You need about 284 words a day"
    );
    expect(host.querySelector(".deadline-live")!.textContent).toContain("Deadline saved.");
    expect(host.querySelector(".deadline-card")!.textContent).toContain("1,200 of 10,000 words");
    expect(button("Save changes").disabled).toBe(true);
  });

  it("follows the words as they are written", async () => {
    server.target = { projectId: PID, wordGoal: 1_000, deadline: shiftWritingDayKey(writingDayKey(), 9), manuscriptWords: 0, pace: null };
    await render(400);
    expect(host.querySelector(".deadline-card")!.textContent).toContain("400 of 1,000 words");
    expect(host.querySelector(".deadline-ring")!.getAttribute("data-progress")).toBe("0.400");
    await render(1_000);
    expect(host.querySelector(".deadline-ring")!.getAttribute("data-complete")).toBe("true");
    expect(host.querySelector(".deadline-headline")!.textContent).toBe("Target reached");
    expect(host.querySelector('[data-testid="deadline-verdict"]')!.textContent).toBe(
      "You reached your word target. Nicely done."
    );
  });

  it("rejects a target that is not a number, and a cleared date, without calling the server", async () => {
    await render(0);
    await type("#deadline-target", "lots");
    await submit();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Enter a word target of at least 1.");
    await type("#deadline-target", "500");
    await type("#deadline-date", "");
    await submit();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("Choose a due date.");
    expect(targetCalls("PUT")).toHaveLength(0);
  });

  it("shows the server's reason when a save fails", async () => {
    await render(0);
    fetchMock.mockImplementationOnce(async () => json({ error: "wordGoal must be a positive integer." }, 400));
    // The first call after render is the PUT.
    await submit();
    expect(host.querySelector('[role="alert"]')!.textContent).toBe("wordGoal must be a positive integer.");
    expect(button("Set deadline").disabled).toBe(false);
  });

  it("removes a deadline only once Undo has lapsed, and Undo brings it back untouched", async () => {
    server.target = { projectId: PID, wordGoal: 5_000, deadline: shiftWritingDayKey(writingDayKey(), 20), manuscriptWords: 0, pace: null };
    await render(100);
    await act(async () => button("Remove deadline").click());
    await settle();
    expect(host.querySelector(".deadline-card")).toBeNull();
    expect(host.textContent).toContain("Deadline removed");
    expect(targetCalls("DELETE")).toHaveLength(0);

    await act(async () => button("Undo").click());
    await settle();
    expect(host.querySelector(".deadline-card")).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(SNACKBAR_MS + 500));
    expect(targetCalls("DELETE")).toHaveLength(0);
    expect(server.target?.wordGoal).toBe(5_000);

    await act(async () => button("Remove deadline").click());
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(SNACKBAR_MS + 500));
    await settle();
    expect(targetCalls("DELETE")).toHaveLength(1);
    expect(server.target).toBeNull();
    expect(host.querySelector<HTMLInputElement>("#deadline-target")!.value).toBe("1000");
  });

  it("does not delete a deadline saved while a removal's Undo was still open", async () => {
    server.target = { projectId: PID, wordGoal: 5_000, deadline: shiftWritingDayKey(writingDayKey(), 20), manuscriptWords: 0, pace: null };
    await render(100);
    await act(async () => button("Remove deadline").click());
    await settle();
    await type("#deadline-target", "7000");
    await submit();
    await act(async () => vi.advanceTimersByTimeAsync(SNACKBAR_MS + 500));
    await settle();
    expect(targetCalls("DELETE")).toHaveLength(0);
    expect(server.target?.wordGoal).toBe(7_000);
    expect(host.querySelector(".deadline-card")).not.toBeNull();
  });

  async function removeAndHoldDelete(status: number) {
    server.target = { projectId: PID, wordGoal: 5_000, deadline: shiftWritingDayKey(writingDayKey(), 20), manuscriptWords: 0, pace: null };
    await render(100);
    await act(async () => button("Remove deadline").click());
    await settle();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    fetchMock.mockImplementationOnce(async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? "GET", url });
      await held;
      if (status !== 200) return json({ error: "nope" }, status);
      server.target = null;
      return json({ ok: true });
    });
    await act(async () => vi.advanceTimersByTimeAsync(SNACKBAR_MS + 500));
    await settle();
    expect(targetCalls("DELETE")).toHaveLength(1);
    await type("#deadline-target", "7000");
    await submit();
    expect(targetCalls("PUT")).toHaveLength(0);
    release();
    await settle();
  }

  it("waits for a delete already on its way before saving, so the new deadline survives", async () => {
    await removeAndHoldDelete(200);
    expect(targetCalls("PUT")).toHaveLength(1);
    expect(server.target?.wordGoal).toBe(7_000);
    expect(host.querySelector(".deadline-card")!.textContent).toContain("100 of 7,000 words");
    expect(track).toHaveBeenCalledWith("deadline_saved", { created: true, daysAhead: 30 });
  });

  it("keeps a deadline saved after a delete that then fails, rather than putting the old one back", async () => {
    await removeAndHoldDelete(500);
    expect(targetCalls("PUT")).toHaveLength(1);
    expect(server.target?.wordGoal).toBe(7_000);
    expect(host.querySelector(".deadline-card")!.textContent).toContain("100 of 7,000 words");
    expect(host.textContent).not.toContain("nope");
    expect(track).toHaveBeenCalledWith("deadline_saved", { created: false, daysAhead: 30 });
  });

  it("counts a save inside a removal's Undo window as a change, not a new deadline", async () => {
    server.target = { projectId: PID, wordGoal: 5_000, deadline: shiftWritingDayKey(writingDayKey(), 20), manuscriptWords: 0, pace: null };
    await render(100);
    await act(async () => button("Remove deadline").click());
    await settle();
    await submit();
    expect(track).toHaveBeenCalledWith("deadline_saved", { created: false, daysAhead: 30 });
  });

  it("announces a save once, not again each time the verdict moves", async () => {
    await render(1_200);
    await type("#deadline-target", "10,000");
    await submit();
    const live = host.querySelector(".deadline-live")!;
    const announced = live.textContent;
    expect(announced).toContain("Deadline saved. You need about 284 words a day");
    await render(5_000);
    expect(host.querySelector('[data-testid="deadline-verdict"]')!.textContent).not.toContain("284");
    expect(live.textContent).toBe(announced);
  });

  it("puts a removal back when the server will not delete it", async () => {
    server.target = { projectId: PID, wordGoal: 5_000, deadline: shiftWritingDayKey(writingDayKey(), 20), manuscriptWords: 0, pace: null };
    await render(100);
    await act(async () => button("Remove deadline").click());
    await settle();
    fetchMock.mockImplementationOnce(async () => json({ error: "nope" }, 500));
    await act(async () => vi.advanceTimersByTimeAsync(SNACKBAR_MS + 500));
    await settle();
    expect(host.querySelector(".deadline-card")).not.toBeNull();
    expect(host.textContent).toContain("nope");
  });

  it("tracks saves, removals and a met target with counts only, the met event once per target", async () => {
    await render(100);
    await submit();
    expect(track).toHaveBeenCalledWith("deadline_saved", { created: true, daysAhead: 30 });

    await type("#deadline-target", "100");
    await submit();
    expect(track).toHaveBeenCalledWith("deadline_saved", { created: false, daysAhead: 30 });
    expect(track.mock.calls.filter(([name]) => name === "deadline_met")).toHaveLength(1);
    await render(150);
    expect(track.mock.calls.filter(([name]) => name === "deadline_met")).toHaveLength(1);

    await act(async () => button("Remove deadline").click());
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(SNACKBAR_MS + 500));
    await settle();
    expect(track).toHaveBeenLastCalledWith("deadline_removed", {});
    for (const [, props] of track.mock.calls) {
      expect(Object.values(props as object).every((v) => typeof v === "number" || typeof v === "boolean")).toBe(true);
    }
  });
});
