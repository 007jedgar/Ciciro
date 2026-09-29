import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { getSession } from "@/lib/auth/session";
import { hashSessionToken } from "@/lib/auth/tokens";
import { MAX_PUSH_TOKENS_PER_ACCOUNT } from "@/lib/push/tokens";
import { DELETE, POST } from "@/app/api/push/tokens/route";
import { POST as LOGOUT } from "@/app/api/auth/logout/route";

const PHONE = "ExponentPushToken[phone-one]";

async function signIn(label: string, expiresInMs = 60 * 60 * 1000) {
  const user =
    (await prisma.user.findUnique({ where: { email: `${label}@example.com` } })) ??
    (await prisma.user.create({ data: { email: `${label}@example.com`, passwordHash: "x" } }));
  const token = `${label}-${Math.random().toString(36).slice(2)}`;
  const session = await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + expiresInMs) },
  });
  return { userId: user.id, sessionId: session.id, token };
}

function request(method: string, token: string | null, body: unknown, path = "/api/push/tokens") {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { [SESSION_HEADER]: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("push token registration", () => {
  beforeEach(async () => {
    await prisma.pushTicket.deleteMany();
    await prisma.pushToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("requires a session", async () => {
    const res = await POST(request("POST", null, { token: PHONE, platform: "ios" }));
    expect(res.status).toBe(401);
    expect(await prisma.pushToken.count()).toBe(0);
  });

  it("rejects anything but an Expo push token on a known platform", async () => {
    const me = await signIn("ada");
    for (const body of [
      {},
      { token: "not-a-token", platform: "ios" },
      { token: "ExponentPushToken[]", platform: "ios" },
      { token: PHONE, platform: "web" },
      { token: PHONE },
    ]) {
      const res = await POST(request("POST", me.token, body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await prisma.pushToken.count()).toBe(0);
  });

  it("stores the token against the account and the sign-in, once", async () => {
    const me = await signIn("ada");
    expect((await POST(request("POST", me.token, { token: PHONE, platform: "ios" }))).status).toBe(200);
    expect((await POST(request("POST", me.token, { token: PHONE, platform: "ios" }))).status).toBe(200);
    const rows = await prisma.pushToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ token: PHONE, platform: "ios", userId: me.userId, sessionId: me.sessionId });
  });

  it("moves a token to whoever registered it last", async () => {
    const ada = await signIn("ada");
    const ben = await signIn("ben");
    await POST(request("POST", ada.token, { token: PHONE, platform: "ios" }));
    await POST(request("POST", ben.token, { token: PHONE, platform: "ios" }));
    const rows = await prisma.pushToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ben.userId, sessionId: ben.sessionId });
  });

  it("keeps the most recent phones per account", async () => {
    const me = await signIn("ada");
    for (let i = 0; i <= MAX_PUSH_TOKENS_PER_ACCOUNT; i++) {
      await POST(request("POST", me.token, { token: `ExponentPushToken[phone-${i}]`, platform: "ios" }));
    }
    const tokens = (await prisma.pushToken.findMany()).map((row) => row.token);
    expect(tokens).toHaveLength(MAX_PUSH_TOKENS_PER_ACCOUNT);
    expect(tokens).not.toContain("ExponentPushToken[phone-0]");
    expect(tokens).toContain(`ExponentPushToken[phone-${MAX_PUSH_TOKENS_PER_ACCOUNT}]`);
  });

  it("removes only the caller's own registration", async () => {
    const ada = await signIn("ada");
    const ben = await signIn("ben");
    await POST(request("POST", ada.token, { token: PHONE, platform: "ios" }));
    expect((await DELETE(request("DELETE", ben.token, { token: PHONE }))).status).toBe(200);
    expect(await prisma.pushToken.count()).toBe(1);
    const row = await prisma.pushToken.findFirstOrThrow();
    await prisma.pushTicket.create({ data: { id: "ticket-1", pushTokenId: row.id } });
    expect((await DELETE(request("DELETE", ada.token, { token: PHONE }))).status).toBe(200);
    expect(await prisma.pushToken.count()).toBe(0);
    expect(await prisma.pushTicket.count()).toBe(0);
  });

  it("signing out drops that sign-in's tokens and no other", async () => {
    const phone = await signIn("ada");
    const tablet = await signIn("ada");
    await POST(request("POST", phone.token, { token: PHONE, platform: "ios" }));
    await POST(request("POST", tablet.token, { token: "ExponentPushToken[tablet]", platform: "ios" }));
    const row = await prisma.pushToken.findUniqueOrThrow({ where: { token: PHONE } });
    await prisma.pushTicket.create({ data: { id: "ticket-1", pushTokenId: row.id } });

    const res = await LOGOUT(request("POST", phone.token, undefined, "/api/auth/logout"));
    expect(res.status).toBe(200);
    expect((await prisma.pushToken.findMany()).map((r) => r.token)).toEqual(["ExponentPushToken[tablet]"]);
    expect(await prisma.pushTicket.count()).toBe(0);
  });

  it("an expired sign-in takes its tokens with it", async () => {
    const me = await signIn("ada", -1000);
    await prisma.pushToken.create({
      data: { userId: me.userId, sessionId: me.sessionId, token: PHONE, platform: "ios" },
    });
    await expect(getSession(request("GET", me.token, undefined))).resolves.toBeNull();
    expect(await prisma.pushToken.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
  });
});
