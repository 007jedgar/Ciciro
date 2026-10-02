import { beforeEach, describe, expect, it, vi } from "vitest";
import { scryptSync } from "node:crypto";

const { randomBytesMock, actualHolder } = vi.hoisted(() => ({
  randomBytesMock: vi.fn(),
  actualHolder: { randomBytes: null as null | ((...args: unknown[]) => Buffer) },
}));
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  actualHolder.randomBytes = actual.randomBytes as (...args: unknown[]) => Buffer;
  return { ...actual, randomBytes: randomBytesMock };
});

const { hashPassword, verifyPassword } = await import("@/lib/auth/password");

beforeEach(() => {
  randomBytesMock.mockImplementation((...args: unknown[]) => actualHolder.randomBytes!(...args));
});

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

  it("encodes the salt and hash to the exact same hex bytes for a fixed salt", async () => {
    // Regression guard for the Buffer.from(...).toString(encoding) wrapper
    // (see src/lib/auth/password.ts): a fixed salt must still produce the
    // same stored hex bytes as computing scrypt directly, byte for byte.
    const fixedSaltHex = "0102030405060708090a0b0c0d0e0f1";
    const fixedSalt = Buffer.from(fixedSaltHex + "0", "hex");
    randomBytesMock.mockReturnValue(fixedSalt);

    const hash = await hashPassword("fixed-input-password");
    const [prefix, n, r, p, saltHex, hashHex] = hash.split("$");
    expect(prefix).toBe("scrypt");
    expect(saltHex).toBe(fixedSalt.toString("hex"));

    const expectedDerived = scryptSync("fixed-input-password", fixedSalt, 32, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    expect(hashHex).toBe(expectedDerived.toString("hex"));
  });
});
