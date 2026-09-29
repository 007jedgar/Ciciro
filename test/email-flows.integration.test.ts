import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { authenticate, getSessionUser } from "@/lib/auth/session";
import { hashSessionToken } from "@/lib/auth/tokens";
import { hashPassword } from "@/lib/auth/password";
import { EMAIL_TOKEN_COOLDOWN_MS } from "@/lib/auth/email-tokens";
import { verifyEmail } from "@/lib/auth/verify-email";
import { POST as signup } from "@/app/api/auth/signup/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as resendVerification } from "@/app/api/auth/verify-email/resend/route";
import { POST as forgotPassword } from "@/app/api/auth/password/forgot/route";
import { POST as resetPasswordRoute } from "@/app/api/auth/password/reset/route";
import { DELETE as deleteAccountRoute } from "@/app/api/auth/account/route";

const ORIGIN = "http://localhost";

type SentEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  category: string;
  idempotencyKey: string;
};

const fetchMock = vi.fn();

function sent(): SentEmail[] {
  return fetchMock.mock.calls.map(([, init]) => {
    const body = JSON.parse(init.body);
    return {
      to: body.to,
      subject: body.subject,
      html: body.html,
      text: body.text,
      category: body.tags?.find((t: { name: string }) => t.name === "category")?.value,
      idempotencyKey: init.headers["Idempotency-Key"],
    };
  });
}

function linkIn(email: SentEmail, path: string): string {
  const match = email.text.match(new RegExp(`${ORIGIN}${path}\\?token=([^\\s]+)`));
  if (!match) throw new Error(`no ${path} link in:\n${email.text}`);
  return decodeURIComponent(match[1]);
}

function request(path: string, init: { method?: string; body?: unknown; session?: string } = {}) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? "POST",
    headers: {
      "content-type": "application/json",
      ...(init.session ? { [SESSION_HEADER]: init.session } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function passwordAccount(email = "ada@example.com", password = "old-password-1") {
  const user = await prisma.user.create({
    data: { email, name: "Ada Lovelace", passwordHash: await hashPassword(password) },
  });
  const sessions = ["phone-session", "laptop-session"];
  for (const token of sessions) {
    await prisma.session.create({
      data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
    });
  }
  return { user, password, sessions };
}

describe("account emails", () => {
  const env = { ...process.env };

  beforeEach(async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "Ciciro <hello@ciciro.test>";
    delete process.env.CICIRO_PUBLIC_URL;
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ id: `email_${fetchMock.mock.calls.length}` }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);
    await prisma.emailToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...env };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("signup and verification", () => {
    it("signup sends one verification email, and verifying sends one welcome", async () => {
      const res = await signup(
        request("/api/auth/signup", { body: { email: "Ada@Example.com", password: "long-enough-pw", name: "Ada" } })
      );
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.user).toMatchObject({ email: "ada@example.com", emailVerified: false });

      expect(sent()).toHaveLength(1);
      const [verify] = sent();
      expect(verify).toMatchObject({ to: "ada@example.com", category: "verify_email" });
      expect(verify.idempotencyKey).toMatch(/^verify-email\//);
      const token = linkIn(verify, "/verify-email");

      await expect(verifyEmail(token, ORIGIN)).resolves.toBe("verified");
      expect(sent().map((e) => e.category)).toEqual(["verify_email", "welcome"]);
      expect(sent()[1]).toMatchObject({ to: "ada@example.com", idempotencyKey: `welcome/${body.user.id}` });
      const user = await prisma.user.findUniqueOrThrow({ where: { email: "ada@example.com" } });
      expect(user.emailVerifiedAt).not.toBeNull();

      // A second click reports success without another welcome.
      await expect(verifyEmail(token, ORIGIN)).resolves.toBe("already_verified");
      expect(sent()).toHaveLength(2);
    });

    it("two racing clicks send one welcome", async () => {
      await signup(request("/api/auth/signup", { body: { email: "ada@example.com", password: "long-enough-pw" } }));
      const token = linkIn(sent()[0], "/verify-email");
      const outcomes = await Promise.all([verifyEmail(token, ORIGIN), verifyEmail(token, ORIGIN)]);
      expect(outcomes.sort()).toEqual(["already_verified", "verified"]);
      expect(sent().filter((e) => e.category === "welcome")).toHaveLength(1);
    });

    it("signup still succeeds when the email cannot go out", async () => {
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ message: "down" }), { status: 500 }));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await signup(
        request("/api/auth/signup", { body: { email: "ada@example.com", password: "long-enough-pw" } })
      );
      expect(res.status).toBe(201);
    });

    it("rejects an expired or unknown link", async () => {
      await signup(request("/api/auth/signup", { body: { email: "ada@example.com", password: "long-enough-pw" } }));
      const token = linkIn(sent()[0], "/verify-email");
      await prisma.emailToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await expect(verifyEmail(token, ORIGIN)).resolves.toBe("expired");
      await expect(verifyEmail("not-a-token", ORIGIN)).resolves.toBe("invalid");
      expect(sent()).toHaveLength(1);
      const user = await prisma.user.findUniqueOrThrow({ where: { email: "ada@example.com" } });
      expect(user.emailVerifiedAt).toBeNull();
    });

    it("/me reports whether the address is verified", async () => {
      const { user, sessions } = await passwordAccount();
      const unverified = await (await me(request("/api/auth/me", { method: "GET", session: sessions[0] }))).json();
      expect(unverified.user.emailVerified).toBe(false);
      await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      const verified = await (await me(request("/api/auth/me", { method: "GET", session: sessions[0] }))).json();
      expect(verified.user.emailVerified).toBe(true);
    });
  });

  describe("resending verification", () => {
    it("needs a session", async () => {
      const res = await resendVerification(request("/api/auth/verify-email/resend"));
      expect(res.status).toBe(401);
      expect(sent()).toHaveLength(0);
    });

    it("sends once per cooldown, and not at all once verified", async () => {
      const { user, sessions } = await passwordAccount();
      const first = await resendVerification(request("/api/auth/verify-email/resend", { session: sessions[0] }));
      expect(await first.json()).toEqual({ ok: true, status: "sent" });
      expect(sent()).toHaveLength(1);

      const second = await resendVerification(request("/api/auth/verify-email/resend", { session: sessions[0] }));
      expect(second.status).toBe(429);
      expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(sent()).toHaveLength(1);

      // Past the cooldown the next one goes out, and the older link still works.
      await prisma.emailToken.updateMany({
        data: { createdAt: new Date(Date.now() - EMAIL_TOKEN_COOLDOWN_MS - 1) },
      });
      const third = await resendVerification(request("/api/auth/verify-email/resend", { session: sessions[0] }));
      expect(third.status).toBe(200);
      expect(sent()).toHaveLength(2);
      await expect(verifyEmail(linkIn(sent()[0], "/verify-email"), ORIGIN)).resolves.toBe("verified");

      await prisma.emailToken.updateMany({
        where: { userId: user.id },
        data: { createdAt: new Date(Date.now() - EMAIL_TOKEN_COOLDOWN_MS - 1) },
      });
      const after = await resendVerification(request("/api/auth/verify-email/resend", { session: sessions[0] }));
      expect(await after.json()).toEqual({ ok: true, status: "already_verified" });
      expect(sent().filter((e) => e.category === "verify_email")).toHaveLength(2);
    });
  });

  describe("password reset", () => {
    it("answers the same for an unknown address and sends nothing", async () => {
      await passwordAccount();
      const res = await forgotPassword(request("/api/auth/password/forgot", { body: { email: "nobody@example.com" } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(sent()).toHaveLength(0);
    });

    it("rejects a malformed address", async () => {
      const res = await forgotPassword(request("/api/auth/password/forgot", { body: { email: "nope" } }));
      expect(res.status).toBe(400);
    });

    it("sends one reset email per cooldown", async () => {
      await passwordAccount();
      for (let i = 0; i < 3; i++) {
        const res = await forgotPassword(
          request("/api/auth/password/forgot", { body: { email: " ADA@example.com " } })
        );
        expect(await res.json()).toEqual({ ok: true });
      }
      expect(sent()).toHaveLength(1);
      expect(sent()[0]).toMatchObject({ to: "ada@example.com", category: "password_reset" });
      expect(sent()[0].idempotencyKey).toMatch(/^password-reset\//);
    });

    it("sets the new password, revokes every session, and spends the link", async () => {
      const { user, password, sessions } = await passwordAccount();
      await forgotPassword(request("/api/auth/password/forgot", { body: { email: "ada@example.com" } }));
      const token = linkIn(sent()[0], "/reset-password");

      const res = await resetPasswordRoute(
        request("/api/auth/password/reset", { body: { token, password: "brand-new-password" }, session: sessions[0] })
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("set-cookie")).toMatch(/ciciro_session=;/);

      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
      for (const session of sessions) {
        expect(await getSessionUser(request("/", { method: "GET", session }))).toBeNull();
      }
      await expect(authenticate({ email: "ada@example.com", password })).rejects.toMatchObject({ status: 401 });
      await expect(
        authenticate({ email: "ada@example.com", password: "brand-new-password" })
      ).resolves.toMatchObject({ id: user.id, emailVerified: true });

      const again = await resetPasswordRoute(
        request("/api/auth/password/reset", { body: { token, password: "another-password" } })
      );
      expect(again.status).toBe(400);
      expect(await again.json()).toMatchObject({ problem: "used" });
      await expect(
        authenticate({ email: "ada@example.com", password: "brand-new-password" })
      ).resolves.toMatchObject({ id: user.id });
      // Resetting sends no further email.
      expect(sent()).toHaveLength(1);
    });

    it("refuses an expired link without touching the account", async () => {
      const { user, password } = await passwordAccount();
      await forgotPassword(request("/api/auth/password/forgot", { body: { email: "ada@example.com" } }));
      const token = linkIn(sent()[0], "/reset-password");
      await prisma.emailToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });

      const res = await resetPasswordRoute(
        request("/api/auth/password/reset", { body: { token, password: "brand-new-password" } })
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ problem: "expired" });
      expect(await prisma.session.count({ where: { userId: user.id } })).toBe(2);
      await expect(authenticate({ email: "ada@example.com", password })).resolves.toMatchObject({ id: user.id });
    });

    it("a too-short password does not spend the link", async () => {
      await passwordAccount();
      await forgotPassword(request("/api/auth/password/forgot", { body: { email: "ada@example.com" } }));
      const token = linkIn(sent()[0], "/reset-password");
      const short = await resetPasswordRoute(request("/api/auth/password/reset", { body: { token, password: "short" } }));
      expect(short.status).toBe(400);
      const ok = await resetPasswordRoute(
        request("/api/auth/password/reset", { body: { token, password: "long-enough-now" } })
      );
      expect(ok.status).toBe(200);
    });
  });

  describe("account deletion", () => {
    it("emails one confirmation to the deleted address", async () => {
      const { password, sessions } = await passwordAccount();
      const res = await deleteAccountRoute(
        request("/api/auth/account", { method: "DELETE", body: { password }, session: sessions[0] })
      );
      expect(res.status).toBe(200);
      expect(sent()).toHaveLength(1);
      expect(sent()[0]).toMatchObject({ to: "ada@example.com", category: "account_deleted" });
      expect(sent()[0].text).toContain("The Ciciro account ada@example.com was deleted on");
    });

    it("sends nothing when the deletion is refused", async () => {
      const { sessions } = await passwordAccount();
      const res = await deleteAccountRoute(
        request("/api/auth/account", { method: "DELETE", body: { password: "wrong" }, session: sessions[0] })
      );
      expect(res.status).toBe(403);
      expect(sent()).toHaveLength(0);
    });
  });

  it("links point at CICIRO_PUBLIC_URL when it is set", async () => {
    process.env.CICIRO_PUBLIC_URL = "https://write.ciciro.test/";
    await passwordAccount();
    await forgotPassword(request("/api/auth/password/forgot", { body: { email: "ada@example.com" } }));
    expect(sent()[0].text).toContain("https://write.ciciro.test/reset-password?token=");
    expect(sent()[0].html).toContain('src="https://write.ciciro.test/brand/email-mark-warm.png"');
  });
});
