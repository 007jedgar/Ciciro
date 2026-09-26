// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SNACKBAR_MS, SnackbarProvider, useSnackbar, type SnackbarInput } from "@/components/Snackbar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let show: (input: SnackbarInput) => void;

function Grab() {
  show = useSnackbar();
  return null;
}

const text = () => host.querySelector(".snackbar")?.textContent ?? null;

beforeEach(async () => {
  vi.useFakeTimers();
  document.documentElement.setAttribute("data-reduce-motion", "true");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <SnackbarProvider>
        <Grab />
      </SnackbarProvider>
    )
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.removeAttribute("data-reduce-motion");
  vi.useRealTimers();
});

describe("snackbar", () => {
  it("shows the message and takes itself away after six seconds", async () => {
    await act(async () => show({ message: "Downloaded" }));
    expect(text()).toBe("Downloaded");
    await act(async () => void vi.advanceTimersByTime(SNACKBAR_MS - 1));
    expect(text()).toBe("Downloaded");
    await act(async () => void vi.advanceTimersByTime(400));
    expect(text()).toBeNull();
  });

  it("commits deferred work when it times out", async () => {
    const onCommit = vi.fn();
    await act(async () => show({ message: "Deleted", actionLabel: "Undo", onAction: vi.fn(), onCommit }));
    expect(onCommit).not.toHaveBeenCalled();
    await act(async () => void vi.advanceTimersByTime(SNACKBAR_MS + 1));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("skips the commit when the action is pressed", async () => {
    const onAction = vi.fn();
    const onCommit = vi.fn();
    await act(async () => show({ message: "Deleted", actionLabel: "Undo", onAction, onCommit }));
    await act(async () => host.querySelector<HTMLButtonElement>(".snackbar-action")!.click());
    expect(onAction).toHaveBeenCalledTimes(1);
    await act(async () => void vi.advanceTimersByTime(SNACKBAR_MS * 2));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits the one on screen when another arrives", async () => {
    const first = vi.fn();
    const second = vi.fn();
    await act(async () => show({ message: "One", onCommit: first }));
    await act(async () => show({ message: "Two", onCommit: second }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(text()).toBe("Two");
  });

  it("holds a plain message back rather than settle one that still offers Undo", async () => {
    const onCommit = vi.fn();
    const onAction = vi.fn();
    await act(async () => show({ message: "Deleted", actionLabel: "Undo", onAction, onCommit }));
    await act(async () => show({ message: "Couldn't delete" }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(text()).toBe("DeletedUndo");
    await act(async () => host.querySelector<HTMLButtonElement>(".snackbar-action")!.click());
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(text()).toBe("Couldn't delete");
    await act(async () => void vi.advanceTimersByTime(SNACKBAR_MS + 400));
    expect(text()).toBeNull();
  });

  it("shows the held message once the one before it commits", async () => {
    const onCommit = vi.fn();
    await act(async () => show({ message: "Deleted", actionLabel: "Undo", onAction: vi.fn(), onCommit }));
    await act(async () => show({ message: "Couldn't delete" }));
    await act(async () => void vi.advanceTimersByTime(SNACKBAR_MS + 1));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(text()).toBe("Couldn't delete");
  });

  it("commits when the page is hidden, so a delete the writer saw go is not lost", async () => {
    const onCommit = vi.fn();
    await act(async () => show({ message: "Deleted", onCommit }));
    window.dispatchEvent(new Event("pagehide"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    // ... and only once, however it settles afterwards.
    await act(async () => void vi.advanceTimersByTime(SNACKBAR_MS * 2));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("holds the clock while the pointer is over it", async () => {
    const onCommit = vi.fn();
    await act(async () => show({ message: "Deleted", onCommit }));
    const bar = host.querySelector<HTMLElement>(".snackbar")!;
    await act(async () => void vi.advanceTimersByTime(4000));
    await act(async () => void bar.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    // React listens for mouseenter through mouseover on the root.
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(onCommit).toHaveBeenCalledTimes(0);
  });
});

describe("without a provider", () => {
  it("commits a deferred action straight away", async () => {
    await act(async () => root.unmount());
    root = createRoot(host);
    const onCommit = vi.fn();
    function Bare() {
      const notify = useSnackbar();
      notify({ message: "Deleted", onCommit });
      return null;
    }
    await act(async () => root.render(<Bare />));
    expect(onCommit).toHaveBeenCalled();
  });
});
