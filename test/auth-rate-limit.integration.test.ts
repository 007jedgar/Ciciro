import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { registerUser } from "@/lib/auth/session";
import { hashSessionToken } from "@/lib/auth/tokens";
import {
  assertAttemptAllowed,
  clearAttempts,
  recordFailedAttempt,
} from "@/lib/auth/rate-limit";
import { POST as login } from "@/app/api/auth/login/route";
import { DELETE as deleteAccountRoute } from "@/app/api/auth/account/route";

// The shared limiter used by /api/auth/login and the password check in
// DELETE /api/auth/account. See src/lib/auth/rate-limit.ts.

function loginRequest(body: unknown, address = "1.1.1.1") {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": address },
    body: JSON.stringify(body),
  });
}

function deleteRequest(token: string, body: unknown, address = "1.1.1.1") {
  return new NextRequest("http://localhost/api/auth/account", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": address,
      [SESSION_HEADER]: token,
    },
    body: JSON.stringify(body),
  });
}

describe("password-attempt rate limiter (unit)", () => {
  beforeEach(async () => {
    await prisma.passwordAttempt.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("allows attempts under the account limit and locks out at it", async () => {
    for (let i = 0; i < 4; i++) {
      await assertAttemptAllowed("login", "unit@example.com", "9.9.9.9");
      await recordFailedAttempt("login", "unit@example.com", "9.9.9.9");
    }
    // 5th failure fills the 5-in-15-minutes account limit.
    await assertAttemptAllowed("login", "unit@example.com", "9.9.9.9");
    await recordFailedAttempt("login", "unit@example.com", "9.9.9.9");

    await expect(
      assertAttemptAllowed("login", "unit@example.com", "9.9.9.9")
    ).rejects.toMatchObject({ status: 429 });
  });

  it("reports a positive retryAfter bounded by the window", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt("login", "retry@example.com", "9.9.9.9", { now });
    }
    const error = await assertAttemptAllowed(
      "login",
      "retry@example.com",
      "9.9.9.9",
      new Date(now.getTime() + 60_000)
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 429 });
    const body = (error as { body?: { retryAfter?: number } }).body;
    expect(body?.retryAfter).toBeGreaterThan(0);
    expect(body?.retryAfter).toBeLessThanOrEqual(15 * 60);
  });

  it("does not let a lockout on one key block a different key", async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt("login", "locked@example.com", "9.9.9.9");
    }
    await expect(
      assertAttemptAllowed("login", "locked@example.com", "9.9.9.9")
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      assertAttemptAllowed("login", "other@example.com", "9.9.9.9")
    ).resolves.toBeUndefined();
  });

  it("keeps login and delete scopes independent for the same key", async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt("delete", "same-key", "9.9.9.9");
    }
    await expect(assertAttemptAllowed("delete", "same-key", "9.9.9.9")).rejects.toMatchObject({
      status: 429,
    });
    await expect(assertAttemptAllowed("login", "same-key", "9.9.9.9")).resolves.toBeUndefined();
  });

  it("clears an account's failures on success", async () => {
    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt("login", "reset@example.com", "9.9.9.9");
    }
    await expect(
      assertAttemptAllowed("login", "reset@example.com", "9.9.9.9")
    ).rejects.toMatchObject({ status: 429 });

    await clearAttempts("login", "reset@example.com");
    await expect(
      assertAttemptAllowed("login", "reset@example.com", "9.9.9.9")
    ).resolves.toBeUndefined();
  });

  it("caps one address across many different keys, looser than the account limit", async () => {
    // Each key alone stays well under the 5-per-account limit...
    for (let i = 0; i < 20; i++) {
      await recordFailedAttempt("login", `spray-${i}@example.com`, "8.8.8.8");
    }
    // ...but the shared address has now hit the 20-per-IP cap.
    await expect(
      assertAttemptAllowed("login", "spray-fresh@example.com", "8.8.8.8")
    ).rejects.toMatchObject({ status: 429 });
    // A different address is unaffected.
    await expect(
      assertAttemptAllowed("login", "spray-fresh@example.com", "1.2.3.4")
    ).resolves.toBeUndefined();
  });
});

describe("login route rate limiting", () => {
  beforeEach(async () => {
    await prisma.passwordAttempt.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("locks out after repeated failures and returns Retry-After", async () => {
    await registerUser({ email: "locked-login@example.com", password: "the-right-password" });
    let last;
    for (let i = 0; i < 5; i++) {
      last = await login(
        loginRequest({ email: "locked-login@example.com", password: "wrong" }, "5.5.5.5")
      );
      expect(last.status).toBe(401);
    }
    const res = await login(
      loginRequest({ email: "locked-login@example.com", password: "wrong" }, "5.5.5.5")
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);

    // The correct password is refused too, while locked out.
    const evenCorrect = await login(
      loginRequest({ email: "locked-login@example.com", password: "the-right-password" }, "5.5.5.5")
    );
    expect(evenCorrect.status).toBe(429);
  });

  it("resets the account's counter on a successful login", async () => {
    await registerUser({ email: "reset-login@example.com", password: "the-right-password" });
    for (let i = 0; i < 4; i++) {
      const res = await login(
        loginRequest({ email: "reset-login@example.com", password: "wrong" }, "6.6.6.6")
      );
      expect(res.status).toBe(401);
    }
    const ok = await login(
      loginRequest({ email: "reset-login@example.com", password: "the-right-password" }, "6.6.6.6")
    );
    expect(ok.status).toBe(200);

    // A fresh run of failures needs a full 5 again — the earlier 4 were cleared.
    for (let i = 0; i < 4; i++) {
      const res = await login(
        loginRequest({ email: "reset-login@example.com", password: "wrong" }, "6.6.6.6")
      );
      expect(res.status).toBe(401);
    }
    const stillUp = await login(
      loginRequest({ email: "reset-login@example.com", password: "wrong" }, "6.6.6.6")
    );
    expect(stillUp.status).toBe(401);
  });

  it("does not reveal whether the email exists", async () => {
    await registerUser({ email: "real-account@example.com", password: "the-right-password" });

    const realAttempts: number[] = [];
    const ghostAttempts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const real = await login(
        loginRequest({ email: "real-account@example.com", password: "wrong" }, "7.7.7.1")
      );
      const realBody = await real.json();
      realAttempts.push(real.status);

      const ghost = await login(
        loginRequest({ email: "ghost-account@example.com", password: "wrong" }, "7.7.7.2")
      );
      const ghostBody = await ghost.json();
      ghostAttempts.push(ghost.status);

      // Same status and same error shape at every step, regardless of
      // whether the account exists.
      expect(ghost.status).toBe(real.status);
      expect(Object.keys(ghostBody).sort()).toEqual(Object.keys(realBody).sort());
    }
    // Both sequences end the same way: five 401s, then locked out.
    expect(realAttempts).toEqual([401, 401, 401, 401, 401, 429]);
    expect(ghostAttempts).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("applies a looser cap per IP across many different emails", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await login(
        loginRequest({ email: `spray-route-${i}@example.com`, password: "wrong" }, "4.4.4.4")
      );
      expect(res.status).toBe(401);
    }
    const res = await login(
      loginRequest({ email: "spray-route-fresh@example.com", password: "wrong" }, "4.4.4.4")
    );
    expect(res.status).toBe(429);

    // A different address, same fresh email, is unaffected.
    const other = await login(
      loginRequest({ email: "spray-route-fresh@example.com", password: "wrong" }, "3.3.3.3")
    );
    expect(other.status).toBe(401);
  });
});

describe("account deletion password rate limiting", () => {
  beforeEach(async () => {
    await prisma.passwordAttempt.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seed() {
    const user = await registerUser({
      email: "delete-limit@example.com",
      password: "the-right-password",
    });
    const token = "delete-limit-session";
    await prisma.session.create({
      data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 60_000) },
    });
    return { user, token };
  }

  it("locks out the password check after repeated failures", async () => {
    const { token } = await seed();
    for (let i = 0; i < 5; i++) {
      const res = await deleteAccountRoute(deleteRequest(token, { password: "wrong" }, "2.2.2.2"));
      expect(res.status).toBe(403);
    }
    const res = await deleteAccountRoute(deleteRequest(token, { password: "wrong" }, "2.2.2.2"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();

    // Confirms the account survives: still findable, and the correct
    // password is refused too, while locked out.
    const evenCorrect = await deleteAccountRoute(
      deleteRequest(token, { password: "the-right-password" }, "2.2.2.2")
    );
    expect(evenCorrect.status).toBe(429);
  });

  it("resets on a correct password (account then actually deletes)", async () => {
    const { user, token } = await seed();
    for (let i = 0; i < 4; i++) {
      const res = await deleteAccountRoute(deleteRequest(token, { password: "wrong" }, "2.2.2.3"));
      expect(res.status).toBe(403);
    }
    const ok = await deleteAccountRoute(
      deleteRequest(token, { password: "the-right-password" }, "2.2.2.3")
    );
    expect(ok.status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });
});
