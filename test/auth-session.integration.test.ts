import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { AuthError, authenticate, registerUser } from "@/lib/auth/session";
import { hashSessionToken } from "@/lib/auth/tokens";

describe("account registration and authentication", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("registers a user and hashes the password", async () => {
    const user = await registerUser({
      email: "Author@Example.com",
      password: "long-enough-pw",
      name: "  Ada  ",
    });
    expect(user.email).toBe("author@example.com");
    expect(user.name).toBe("Ada");
    // The public user never exposes the hash; verify it is stored, not plaintext.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).not.toContain("long-enough-pw");
    expect(row.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(row.creditBalance).toBe(200);
    const grant = await prisma.creditTransaction.findMany({ where: { userId: user.id } });
    expect(grant).toHaveLength(1);
    expect(grant[0].reason).toBe("earn_grant");
    expect(grant[0].amount).toBe(200);
  });

  it("rejects invalid email and short password", async () => {
    await expect(
      registerUser({ email: "nope", password: "long-enough-pw" })
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      registerUser({ email: "ok@example.com", password: "short" })
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a duplicate email with a 409", async () => {
    await registerUser({ email: "dupe@example.com", password: "long-enough-pw" });
    await expect(
      registerUser({ email: "Dupe@example.com", password: "another-good-pw" })
    ).rejects.toMatchObject({ status: 409 });
  });

  it("authenticates correct credentials and rejects wrong ones", async () => {
    await registerUser({ email: "login@example.com", password: "the-right-password" });

    const ok = await authenticate({
      email: "login@example.com",
      password: "the-right-password",
    });
    expect(ok.email).toBe("login@example.com");

    await expect(
      authenticate({ email: "login@example.com", password: "wrong-password" })
    ).rejects.toMatchObject({ status: 401 });
  });

  it("returns a uniform 401 for an unknown account", async () => {
    await expect(
      authenticate({ email: "ghost@example.com", password: "whatever-here" })
    ).rejects.toMatchObject({ status: 401 });
  });

  it("only stores the hash of a session token, never the raw token", async () => {
    const user = await registerUser({
      email: "sess@example.com",
      password: "session-password",
    });
    const raw = "raw-token-value";
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(raw),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const stored = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashSessionToken(raw) },
    });
    expect(stored.tokenHash).not.toBe(raw);
    expect(stored.userId).toBe(user.id);
  });
});
