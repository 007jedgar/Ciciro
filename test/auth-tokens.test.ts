import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashSessionToken,
  normalizeEmail,
  validatePassword,
} from "@/lib/auth/tokens";
import {
  MIN_PASSWORD_LENGTH,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from "@/lib/auth/constants";

describe("session tokens", () => {
  it("generates unique, url-safe tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });

  it("hashes a token deterministically and irreversibly", () => {
    const token = generateSessionToken();
    const h1 = hashSessionToken(token);
    const h2 = hashSessionToken(token);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
    expect(h1).not.toBe(token);
  });

  it("uses a stable cookie name and a positive TTL", () => {
    expect(SESSION_COOKIE).toBe("ciciro_session");
    expect(SESSION_TTL_MS).toBeGreaterThan(0);
  });
});

describe("email normalization", () => {
  it("lowercases and trims valid emails", () => {
    expect(normalizeEmail("  Author@Example.COM ")).toBe("author@example.com");
  });

  it("rejects malformed or non-string emails", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("no@domain")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});

describe("password policy", () => {
  it("accepts a sufficiently long password", () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it("rejects short, over-long, and non-string passwords", () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least/);
    expect(validatePassword("a".repeat(513))).toMatch(/too long/);
    expect(validatePassword(undefined)).toMatch(/required/);
  });
});
