import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { NO_PASSWORD, signInWithIdentity } from "@/lib/auth/identity";
import { authenticate, registerUser } from "@/lib/auth/session";

// Wrap the real verifier so each test can see what it was asked to check.
vi.mock("@/lib/auth/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/password")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const verify = vi.mocked(verifyPassword);

// An Apple / Google account with no password stores passwordHash = "".
describe("password sign-in against a password-less account", () => {
  beforeEach(async () => {
    await prisma.identity.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await signInWithIdentity({
      provider: "apple",
      subject: "001.nopw",
      email: "social@icloud.com",
      emailVerified: true,
      name: "",
    });
    verify.mockClear();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores the no-password marker", async () => {
    const row = await prisma.user.findUniqueOrThrow({ where: { email: "social@icloud.com" } });
    expect(row.passwordHash).toBe(NO_PASSWORD);
  });

  it.each(["", " ", "password", "scrypt$16384$8$1$00$00", "a".repeat(600)])(
    "rejects %j without ever verifying against the empty hash",
    async (password) => {
      await expect(
        authenticate({ email: "social@icloud.com", password })
      ).rejects.toMatchObject({ status: 401, message: "Incorrect email or password." });
      // The only verify is the timing dummy, never the stored "".
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0][1]).not.toBe(NO_PASSWORD);
    }
  );

  it("fails exactly like an unknown email, so it does not reveal the account", async () => {
    const social = await authenticate({ email: "social@icloud.com", password: "x" }).catch((e) => e);
    const unknown = await authenticate({ email: "nobody@icloud.com", password: "x" }).catch((e) => e);
    expect({ status: social.status, message: social.message }).toEqual({
      status: unknown.status,
      message: unknown.message,
    });
  });

  it("cannot be given a password through signup", async () => {
    await expect(
      registerUser({ email: "Social@iCloud.com", password: "long-enough-pw" })
    ).rejects.toMatchObject({ status: 409 });
    const row = await prisma.user.findUniqueOrThrow({ where: { email: "social@icloud.com" } });
    expect(row.passwordHash).toBe(NO_PASSWORD);
    await expect(
      authenticate({ email: "social@icloud.com", password: "long-enough-pw" })
    ).rejects.toMatchObject({ status: 401 });
  });

  it("the verifier itself refuses the empty hash too", async () => {
    const real = (await vi.importActual<typeof import("@/lib/auth/password")>("@/lib/auth/password"))
      .verifyPassword;
    await expect(real("", NO_PASSWORD)).resolves.toBe(false);
    await expect(real("anything", NO_PASSWORD)).resolves.toBe(false);
  });
});
