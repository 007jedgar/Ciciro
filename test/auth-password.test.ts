import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing (scrypt)", () => {
  it("round-trips a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("s3cret-passphrase");
    expect(await verifyPassword("s3cret-passphras", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
    expect(await verifyPassword("SECRET-passphrase", hash)).toBe(false);
  });

  it("uses a distinct salt per hash", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    // Both still verify.
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("stores parseable scrypt parameters", async () => {
    const hash = await hashPassword("params-check");
    const parts = hash.split("$");
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe("scrypt");
    expect(Number(parts[1])).toBeGreaterThan(1); // N
    expect(parts[4]).toMatch(/^[0-9a-f]+$/); // salt hex
    expect(parts[5]).toMatch(/^[0-9a-f]+$/); // hash hex
  });

  it("returns false (never throws) for malformed stored values", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "scrypt$16384$8$1$zz$zz")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
  });

  it("throws on an empty password to hash", async () => {
    await expect(hashPassword("")).rejects.toThrow();
  });
});
