import { describe, expect, it } from "vitest";
import { isPublic } from "@/middleware";
import { isAuthPagePath } from "@/lib/auth/constants";

describe("middleware isPublic", () => {
  it("lets a signed-out visitor reach /changelog without a session", () => {
    // "What's new" in the landing footer links here while signed out; it
    // must not bounce through /login (see src/components/landing/Landing.tsx).
    expect(isPublic("/changelog")).toBe(true);
  });

  it("still requires a session for a real app route", () => {
    expect(isPublic("/settings")).toBe(false);
    expect(isPublic("/api/projects")).toBe(false);
  });

  it("keeps the other public marketing and auth pages public", () => {
    for (const path of ["/", "/login", "/signup", "/privacy", "/terms", "/pricing"]) {
      expect(isPublic(path)).toBe(true);
    }
  });

  it("lets a signed-out visitor reach /features without a session", () => {
    // Linked from the landing nav and footer, and must not require sign-in.
    expect(isPublic("/features")).toBe(true);
  });

  it("lets a link-unfurling bot fetch every page's preview image without a session", () => {
    // A crawler fetching an opengraph-image/twitter-image never sends a
    // session; bouncing it through /login broke every static page's link
    // preview on a hosted (CICIRO_REQUIRE_AUTH=true) deployment, which is
    // production's actual setting - caught by fetching these routes on the
    // real Workers runtime, not by guessing.
    for (const path of [
      "/opengraph-image",
      "/twitter-image",
      "/features/opengraph-image",
      "/changelog/twitter-image",
      "/privacy/opengraph-image",
      "/terms/twitter-image",
      "/read/some-token/opengraph-image",
    ]) {
      expect(isPublic(path)).toBe(true);
    }
  });
});

describe("isAuthPagePath", () => {
  it("names every page whose whole purpose is signing in or recovering an account", () => {
    for (const path of ["/login", "/signup", "/forgot-password", "/reset-password", "/verify-email"]) {
      expect(isAuthPagePath(path)).toBe(true);
    }
  });

  it("does not flag an ordinary public page", () => {
    expect(isAuthPagePath("/changelog")).toBe(false);
    expect(isAuthPagePath("/")).toBe(false);
  });
});
