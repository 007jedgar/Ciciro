// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeleteAccountDialog from "@/components/DeleteAccountDialog";
import { EXPORT_URL } from "@/lib/account/copy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let assign: ReturnType<typeof vi.fn>;

function dialog() {
  return document.querySelector<HTMLFormElement>(".account-dialog")!;
}

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === label
  )!;
}

async function typePassword(value: string) {
  const input = dialog().querySelector<HTMLInputElement>('input[type="password"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function render(onClose = vi.fn()) {
  await act(async () => {
    root.render(<DeleteAccountDialog open email="ada@example.com" onClose={onClose} />);
  });
  return onClose;
}

describe("DeleteAccountDialog", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("says what goes, offers the export, and waits for a password", async () => {
    await render();
    const text = dialog().textContent ?? "";
    expect(text).toContain("permanently deletes ada@example.com");
    expect(text).toContain("Every manuscript");
    expect(text).toContain("can't be undone");
    const exportLink = dialog().querySelector<HTMLAnchorElement>("a[download]")!;
    expect(exportLink.getAttribute("href")).toBe(EXPORT_URL);
    expect(button("Delete account").disabled).toBe(true);
    await typePassword("hunter22");
    expect(button("Delete account").disabled).toBe(false);
  });

  it("deletes with the password and leaves for the confirmation page", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await typePassword("hunter22");
    await act(async () => button("Delete account").click());

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/account",
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ password: "hunter22" }) })
    );
    expect(assign).toHaveBeenCalledWith("/account/delete?deleted=1");
  });

  it("shows the server's reason and stays open on a wrong password", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Incorrect password." }), { status: 403 }))
    );
    await render();
    await typePassword("nope-nope");
    await act(async () => button("Delete account").click());

    expect(dialog().querySelector('[role="alert"]')?.textContent).toBe("Incorrect password.");
    expect(assign).not.toHaveBeenCalled();
    expect(button("Delete account").disabled).toBe(false);
  });

  it("closes on Escape and Cancel", async () => {
    const onClose = await render();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await act(async () => button("Cancel").click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
