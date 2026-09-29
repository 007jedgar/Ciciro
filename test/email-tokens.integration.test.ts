import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  EMAIL_TOKEN_CAP_WINDOW_MS,
  EMAIL_TOKEN_COOLDOWN_MS,
  EMAIL_TOKEN_TTL_MS,
  checkEmailToken,
  consumeEmailToken,
  RESET_EMAIL_CAP,
  issueEmailToken,
  type EmailTokenPurpose,
} from "@/lib/auth/email-tokens";

async function makeUser(email = "ada@example.com") {
  return prisma.user.create({ data: { email, passwordHash: "x" } });
}

async function issue(user: { id: string; email: string }, purpose: EmailTokenPurpose, now = Date.now()) {
  const result = await issueEmailToken(user, purpose, now);
  if (!result.ok) throw new Error("expected a token");
  return result.issued;
}

describe("email tokens", () => {
  beforeEach(async () => {
    await prisma.emailToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores only the token's hash", async () => {
    const user = await makeUser();
    const { token } = await issue(user, "verify_email");
    const rows = await prisma.emailToken.findMany();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    expect(rows[0].email).toBe("ada@example.com");
  });

  it("works once", async () => {
    const user = await makeUser();
    const { token } = await issue(user, "reset_password");
    await expect(consumeEmailToken(token, "reset_password")).resolves.toMatchObject({ ok: true, userId: user.id });
    await expect(consumeEmailToken(token, "reset_password")).resolves.toEqual({
      ok: false,
      problem: "used",
      userId: user.id,
      email: user.email,
    });
  });

  it("lets exactly one of two racing requests spend it", async () => {
    const user = await makeUser();
    const { token } = await issue(user, "reset_password");
    const results = await Promise.all([
      consumeEmailToken(token, "reset_password"),
      consumeEmailToken(token, "reset_password"),
      consumeEmailToken(token, "reset_password"),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it.each([
    ["verify_email", 48 * 60 * 60 * 1000],
    ["reset_password", 60 * 60 * 1000],
  ] as const)("a %s link expires after its lifetime", async (purpose, ttl) => {
    expect(EMAIL_TOKEN_TTL_MS[purpose]).toBe(ttl);
    const user = await makeUser();
    const start = Date.now();
    const { token } = await issue(user, purpose, start);
    await expect(checkEmailToken(token, purpose, start + ttl - 1000)).resolves.toMatchObject({ ok: true });
    await expect(consumeEmailToken(token, purpose, start + ttl)).resolves.toMatchObject({
      ok: false,
      problem: "expired",
    });
    // Still unspent, and still expired a moment later.
    const row = await prisma.emailToken.findFirstOrThrow();
    expect(row.usedAt).toBeNull();
    await expect(consumeEmailToken(token, purpose, start + ttl + 1)).resolves.toMatchObject({ problem: "expired" });
  });

  it("checking does not spend it", async () => {
    const user = await makeUser();
    const { token } = await issue(user, "reset_password");
    await checkEmailToken(token, "reset_password");
    await checkEmailToken(token, "reset_password");
    await expect(consumeEmailToken(token, "reset_password")).resolves.toMatchObject({ ok: true });
  });

  it("only works for its own purpose", async () => {
    const user = await makeUser();
    const { token } = await issue(user, "verify_email");
    await expect(consumeEmailToken(token, "reset_password")).resolves.toEqual({ ok: false, problem: "invalid" });
    await expect(consumeEmailToken(token, "verify_email")).resolves.toMatchObject({ ok: true });
  });

  it("rejects garbage", async () => {
    for (const token of [undefined, null, 42, "", "nope", "x".repeat(500)]) {
      await expect(consumeEmailToken(token, "verify_email")).resolves.toEqual({ ok: false, problem: "invalid" });
    }
  });

  it("holds each account to one link per kind per cooldown", async () => {
    const user = await makeUser();
    const other = await makeUser("grace@example.com");
    const start = Date.now();
    await issue(user, "reset_password", start);

    const again = await issueEmailToken(user, "reset_password", start + 10_000);
    expect(again).toEqual({ ok: false, retryAfterMs: EMAIL_TOKEN_COOLDOWN_MS - 10_000 });
    // Other kinds and other accounts are unaffected.
    await expect(issueEmailToken(user, "verify_email", start + 10_000)).resolves.toMatchObject({ ok: true });
    await expect(issueEmailToken(other, "reset_password", start + 10_000)).resolves.toMatchObject({ ok: true });

    await expect(
      issueEmailToken(user, "reset_password", start + EMAIL_TOKEN_COOLDOWN_MS)
    ).resolves.toMatchObject({ ok: true });
  });

  it("a newer reset link leaves earlier ones valid", async () => {
    const user = await makeUser();
    const start = Date.now();
    const firstReset = await issue(user, "reset_password", start);
    const later = start + EMAIL_TOKEN_COOLDOWN_MS;
    const secondReset = await issue(user, "reset_password", later);

    await expect(checkEmailToken(firstReset.token, "reset_password", later)).resolves.toMatchObject({ ok: true });
    await expect(checkEmailToken(secondReset.token, "reset_password", later)).resolves.toMatchObject({ ok: true });
  });

  it("caps reset emails per account per rolling day", async () => {
    const user = await makeUser();
    const other = await makeUser("grace@example.com");
    const start = Date.now();
    for (let i = 0; i < RESET_EMAIL_CAP; i++) {
      await issue(user, "reset_password", start + i * EMAIL_TOKEN_COOLDOWN_MS);
    }
    const next = start + RESET_EMAIL_CAP * EMAIL_TOKEN_COOLDOWN_MS;
    await expect(issueEmailToken(user, "reset_password", next)).resolves.toEqual({
      ok: false,
      retryAfterMs: start + EMAIL_TOKEN_CAP_WINDOW_MS - next,
    });
    await expect(issueEmailToken(other, "reset_password", next)).resolves.toMatchObject({ ok: true });
    await expect(
      issueEmailToken(user, "reset_password", start + EMAIL_TOKEN_CAP_WINDOW_MS + 1)
    ).resolves.toMatchObject({ ok: true });
  });

  it("sweeps expired links when issuing a new one", async () => {
    const user = await makeUser();
    const start = Date.now();
    await issue(user, "verify_email", start);
    await issue(user, "verify_email", start + EMAIL_TOKEN_TTL_MS.verify_email + 1);
    expect(await prisma.emailToken.count()).toBe(2);
    await issue(user, "verify_email", start + EMAIL_TOKEN_TTL_MS.verify_email + EMAIL_TOKEN_CAP_WINDOW_MS + 2);
    expect(await prisma.emailToken.count()).toBe(2);
  });
});
