import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { hashSessionToken } from "@/lib/auth/tokens";
import { hashPassword } from "@/lib/auth/password";
import { POST as signup } from "@/app/api/auth/signup/route";
import { GET as getPublicPrefs, PATCH as patchPublicPrefs } from "@/app/api/email/preferences/route";
import { POST as unsubscribePost, GET as unsubscribeGet } from "@/app/api/email/unsubscribe/route";
import { GET as getSettingsPrefs, PATCH as patchSettingsPrefs } from "@/app/api/account/email-preferences/route";
import { sendMarketingEmail } from "@/lib/email/marketing-send";

const ORIGIN = "http://localhost";

const fetchMock = vi.fn();

function lastRequestInit(): { headers: Record<string, string>; body: string } {
  const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return init;
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

async function sessionFor(userId: string, token: string) {
  await prisma.session.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return token;
}

describe("email consent gating and unsubscribe", () => {
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
    await prisma.marketingEmailLog.deleteMany();
    await prisma.emailToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.emailPreference.deleteMany();
    await prisma.user.deleteMany();
  });

  afterEach(() => {
    process.env = { ...env };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("signup consent gating", () => {
    it("defaults to opted out, and sends no welcome-1, when the checkbox is unchecked", async () => {
      const res = await signup(
        request("/api/auth/signup", { body: { email: "ada@example.com", password: "long-enough-pw" } })
      );
      const { user } = await res.json();
      const pref = await prisma.emailPreference.findUnique({ where: { userId: user.id } });
      expect(pref?.marketingOptIn ?? false).toBe(false);
      const welcome1 = fetchMock.mock.calls.some(([, init]) => JSON.parse(init.body).tags?.some((t: { value: string }) => t.value === "welcome_1"));
      expect(welcome1).toBe(false);
    });

    it("opts in, stamps marketingOptInAt, and sends welcome-1 when the checkbox is checked", async () => {
      const res = await signup(
        request("/api/auth/signup", {
          body: { email: "bea@example.com", password: "long-enough-pw", marketingOptIn: true },
        })
      );
      const { user } = await res.json();
      const pref = await prisma.emailPreference.findUniqueOrThrow({ where: { userId: user.id } });
      expect(pref.marketingOptIn).toBe(true);
      expect(pref.marketingOptInAt).not.toBeNull();
      const welcome1 = fetchMock.mock.calls.filter(
        ([, init]) => JSON.parse(init.body).tags?.some((t: { value: string }) => t.value === "welcome_1")
      );
      expect(welcome1).toHaveLength(1);
    });
  });

  describe("public preferences endpoint", () => {
    async function seedPref(email: string) {
      const user = await prisma.user.create({
        data: { email, name: "Reader", passwordHash: await hashPassword("pw-long-enough") },
      });
      return prisma.emailPreference.create({
        data: {
          userId: user.id,
          unsubscribeToken: "public-token",
          marketingOptIn: true,
          marketingOptInAt: new Date(),
          productUpdates: true,
          weeklyEmail: true,
          offers: true,
        },
      });
    }

    it("404s an unknown token", async () => {
      const res = await getPublicPrefs(request("/api/email/preferences?t=nope", { method: "GET" }));
      expect(res.status).toBe(404);
    });

    it("reads and updates topics by token, with no session", async () => {
      await seedPref("cai@example.com");
      const got = await getPublicPrefs(request("/api/email/preferences?t=public-token", { method: "GET" }));
      expect((await got.json()).weeklyEmail).toBe(true);

      const patched = await patchPublicPrefs(
        request("/api/email/preferences?t=public-token", { method: "PATCH", body: { weeklyEmail: false } })
      );
      expect((await patched.json()).weeklyEmail).toBe(false);
    });

    it("unsubscribes from everything via marketingOptIn: false", async () => {
      await seedPref("dee@example.com");
      const patched = await patchPublicPrefs(
        request("/api/email/preferences?t=public-token", { method: "PATCH", body: { marketingOptIn: false } })
      );
      expect((await patched.json()).marketingOptIn).toBe(false);
    });
  });

  describe("one-click unsubscribe (RFC 8058)", () => {
    async function seedPref(email: string) {
      const user = await prisma.user.create({
        data: { email, name: "Reader", passwordHash: await hashPassword("pw-long-enough") },
      });
      return prisma.emailPreference.create({
        data: {
          userId: user.id,
          unsubscribeToken: "click-token",
          marketingOptIn: true,
          marketingOptInAt: new Date(),
          productUpdates: true,
          weeklyEmail: true,
          offers: true,
        },
      });
    }

    it("POST turns off only the one topic, silently", async () => {
      const pref = await seedPref("eve@example.com");
      const res = await unsubscribePost(
        request("/api/email/unsubscribe?t=click-token&topic=weeklyEmail", { method: "POST" })
      );
      expect(res.status).toBe(200);
      const after = await prisma.emailPreference.findUniqueOrThrow({ where: { userId: pref.userId } });
      expect(after.weeklyEmail).toBe(false);
      expect(after.productUpdates).toBe(true);
      expect(after.marketingOptIn).toBe(true);
    });

    it("POST with a bad token or topic 400s without throwing", async () => {
      const res = await unsubscribePost(request("/api/email/unsubscribe?t=&topic=weeklyEmail", { method: "POST" }));
      expect(res.status).toBe(400);
    });

    it("GET never mutates: it only redirects to a confirm prompt", async () => {
      const pref = await seedPref("finn@example.com");
      const res = await unsubscribeGet(
        request("/api/email/unsubscribe?t=click-token&topic=offers", { method: "GET" })
      );
      expect(res.status).toBe(303);
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("/email/preferences");
      expect(location).toContain("confirm=offers");
      // A scanner or link-prefetcher that only ever GETs must never unsubscribe anyone.
      const after = await prisma.emailPreference.findUniqueOrThrow({ where: { userId: pref.userId } });
      expect(after.offers).toBe(true);
      expect(after.marketingOptIn).toBe(true);
    });

    it("a marketing send carries List-Unsubscribe and the RFC 8058 one-click header", async () => {
      const pref = await seedPref("gia@example.com");
      const user = await prisma.user.findUniqueOrThrow({ where: { id: pref.userId } });
      await sendMarketingEmail({
        userId: user.id,
        email: user.email,
        topic: "weeklyEmail",
        key: "test-send",
        origin: ORIGIN,
        buildContent: (unsubscribe) => ({
          category: "test",
          subject: "Test",
          preview: "Test",
          heading: "Test",
          blocks: [],
          footer: "Test",
          unsubscribe,
        }),
      });
      const body = JSON.parse(lastRequestInit().body);
      expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      expect(body.headers["List-Unsubscribe"]).toContain("/api/email/unsubscribe?t=click-token&topic=weeklyEmail");
    });
  });

  describe("authenticated settings endpoint", () => {
    it("requires a session", async () => {
      const res = await getSettingsPrefs(request("/api/account/email-preferences", { method: "GET" }));
      expect(res.status).toBe(401);
    });

    it("reads defaults, then turns marketing on and changes a topic", async () => {
      const user = await prisma.user.create({
        data: { email: "hana@example.com", name: "Hana", passwordHash: await hashPassword("pw-long-enough") },
      });
      const token = await sessionFor(user.id, "hana-session");

      const before = await getSettingsPrefs(request("/api/account/email-preferences", { method: "GET", session: token }));
      expect((await before.json()).marketingOptIn).toBe(false);

      const after = await patchSettingsPrefs(
        request("/api/account/email-preferences", {
          method: "PATCH",
          session: token,
          body: { marketingOptIn: true, offers: false },
        })
      );
      const body = await after.json();
      expect(body.marketingOptIn).toBe(true);
      expect(body.offers).toBe(false);

      // Turning marketing on from Settings starts the welcome sequence just
      // like signup does, so it always begins at step 1.
      const welcome1 = fetchMock.mock.calls.filter(
        ([, init]) => JSON.parse(init.body).tags?.some((t: { value: string }) => t.value === "welcome_1")
      );
      expect(welcome1).toHaveLength(1);
      const pref = await prisma.emailPreference.findUniqueOrThrow({ where: { userId: user.id } });
      expect(pref.marketingOptInAt).not.toBeNull();
    });

    it("does not resend welcome-1 to someone who already received it", async () => {
      const user = await prisma.user.create({
        data: { email: "ivo@example.com", name: "Ivo", passwordHash: await hashPassword("pw-long-enough") },
      });
      const token = await sessionFor(user.id, "ivo-session");

      // Already opted in and already sent step 1 (e.g. from signup).
      await prisma.emailPreference.create({
        data: {
          userId: user.id,
          unsubscribeToken: "ivo-token",
          marketingOptIn: true,
          marketingOptInAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
          productUpdates: true,
          weeklyEmail: true,
          offers: true,
        },
      });
      await prisma.marketingEmailLog.create({ data: { userId: user.id, key: "welcome-1" } });

      // Toggle off, then back on from Settings.
      await patchSettingsPrefs(
        request("/api/account/email-preferences", { method: "PATCH", session: token, body: { marketingOptIn: false } })
      );
      fetchMock.mockClear();
      await patchSettingsPrefs(
        request("/api/account/email-preferences", { method: "PATCH", session: token, body: { marketingOptIn: true } })
      );

      const welcome1 = fetchMock.mock.calls.some(
        ([, init]) => JSON.parse(init.body).tags?.some((t: { value: string }) => t.value === "welcome_1")
      );
      expect(welcome1).toBe(false);
    });
  });
});
