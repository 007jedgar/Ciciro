import { describe, expect, it } from "vitest";
import { shouldGoBack } from "@/lib/back-link";

const ORIGIN = "https://ciciro.app";

describe("shouldGoBack", () => {
  it("refuses to go back onto a sign-in/sign-up/recovery page", () => {
    for (const path of ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email"]) {
      expect(shouldGoBack(`${ORIGIN}${path}?next=/changelog`, ORIGIN)).toBe(false);
    }
  });

  it("allows going back to an ordinary same-origin page", () => {
    expect(shouldGoBack(`${ORIGIN}/`, ORIGIN)).toBe(true);
    expect(shouldGoBack(`${ORIGIN}/pricing`, ORIGIN)).toBe(true);
  });

  it("refuses a cross-origin referrer", () => {
    expect(shouldGoBack("https://example.com/login", ORIGIN)).toBe(false);
  });

  it("refuses an empty or unparseable referrer", () => {
    expect(shouldGoBack("", ORIGIN)).toBe(false);
    expect(shouldGoBack("not a url", ORIGIN)).toBe(false);
  });
});
