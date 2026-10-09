// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BetaSignupForm from "@/components/landing/BetaSignupForm";
import { BETA } from "@/components/landing/copy";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

const emailInput = () => document.querySelector<HTMLInputElement>("#landing-beta-email")!;
const submitButton = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const alertText = () => document.querySelector('[role="alert"]')?.textContent ?? "";

async function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(emailInput(), value);
    emailInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    submitButton().form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("BetaSignupForm", () => {
  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<BetaSignupForm />));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it("labels the field and the button", () => {
    expect(document.querySelector('label[for="landing-beta-email"]')?.textContent).toBe(BETA.label);
    expect(submitButton().textContent).toBe("Join the iOS beta");
  });

  it("rejects a bad email without calling the server and flags the field", async () => {
    await type("nope");
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(alertText()).toBe(BETA.invalid);
    expect(emailInput().getAttribute("aria-invalid")).toBe("true");
    expect(emailInput().getAttribute("aria-describedby")).toBe("landing-beta-error");
  });

  it("shows a loading state, then the success message", async () => {
    let finish!: (value: unknown) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await type("ada@example.com");
    await submit();
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toBe(BETA.submitting);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ email: "ada@example.com", source: "landing", website: "" });

    await act(async () => finish({ ok: true, json: async () => ({ ok: true }) }));
    expect(document.querySelector('[role="status"]')?.textContent).toBe(BETA.success);
    expect(document.querySelector("form")).toBeNull();
  });

  it("shows the server's error and lets the person retry", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Too many signups from here. Try again later." }) });
    await type("ada@example.com");
    await submit();
    expect(alertText()).toBe("Too many signups from here. Try again later.");
    expect(submitButton().disabled).toBe(false);
  });

  it("falls back to a generic error when the request fails", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));
    await type("ada@example.com");
    await submit();
    expect(alertText()).toBe(BETA.failure);
  });
});
