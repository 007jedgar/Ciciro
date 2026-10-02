import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  EXPO_PUSH_RECEIPTS_URL,
  EXPO_PUSH_SEND_URL,
  RECEIPT_DELAY_MS,
  RECEIPT_TTL_MS,
  checkPushReceipts,
  sendPushToUser,
} from "@/lib/push/send";

type Call = { url: string; body: unknown; headers: Record<string, string> };

/** A stand-in for the Expo Push API: answers each call from `replies` in turn. */
function fakeExpo(replies: ((call: Call) => { status?: number; json: unknown } | Error)[]) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const call = { url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> };
    calls.push(call);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)](call);
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.json), { status: reply.status ?? 200 });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

/** Every message gets an ok ticket, unless its token is in `errors`. */
function tickets(errors: Record<string, string> = {}) {
  return (call: Call) => ({
    json: {
      data: (call.body as { to: string }[]).map((message, i) =>
        errors[message.to]
          ? { status: "error", message: "nope", details: { error: errors[message.to] } }
          : { status: "ok", id: `ticket-${message.to}-${i}` }
      ),
    },
  });
}

const sleep = vi.fn(async () => {});

async function account(tokens: number, label = "ada") {
  const user = await prisma.user.create({ data: { email: `${label}@example.com`, passwordHash: "x" } });
  const session = await prisma.session.create({
    data: { userId: user.id, tokenHash: `${label}-hash`, expiresAt: new Date(Date.now() + 3600_000) },
  });
  const rows = [];
  for (let i = 0; i < tokens; i++) {
    rows.push(
      await prisma.pushToken.create({
        data: {
          userId: user.id,
          sessionId: session.id,
          token: `ExponentPushToken[${label}-${String(i).padStart(3, "0")}]`,
          platform: "ios",
        },
      })
    );
  }
  return { userId: user.id, tokens: rows };
}

const message = { title: "Ciciro", body: "Hello", data: { href: "/manuscripts" } };

describe("sendPushToUser", () => {
  beforeEach(async () => {
    await prisma.pushTicket.deleteMany();
    await prisma.pushToken.deleteMany();
    await prisma.pushNotificationLog.deleteMany();
    await prisma.pushPreference.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    delete process.env.EXPO_ACCESS_TOKEN;
  });

  afterEach(() => {
    delete process.env.EXPO_ACCESS_TOKEN;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sends to every phone of the account, 100 messages per request, and stores the tickets", async () => {
    const me = await account(150);
    await account(1, "ben");
    const expo = fakeExpo([tickets()]);
    const result = await sendPushToUser(me.userId, message, { fetch: expo.fetch, sleep });

    expect(result).toEqual({ accepted: 150, failed: 0, removed: 0 });
    const sends = expo.calls.filter((call) => call.url === EXPO_PUSH_SEND_URL);
    expect(sends.map((call) => (call.body as unknown[]).length)).toEqual([100, 50]);
    expect((sends[0].body as object[])[0]).toEqual({
      to: "ExponentPushToken[ada-000]",
      title: "Ciciro",
      body: "Hello",
      sound: "default",
      data: { href: "/manuscripts" },
    });
    const everyone = sends.flatMap((call) => (call.body as { to: string }[]).map((m) => m.to));
    expect(everyone).not.toContain("ExponentPushToken[ben-000]");
    expect(await prisma.pushTicket.count()).toBe(150);
    expect(sends[0].headers).not.toHaveProperty("authorization");
  });

  it("drops a phone whose ticket says it is gone, and keeps one with another error", async () => {
    const me = await account(3);
    const expo = fakeExpo([
      tickets({
        "ExponentPushToken[ada-000]": "DeviceNotRegistered",
        "ExponentPushToken[ada-001]": "MessageRateExceeded",
      }),
    ]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await sendPushToUser(me.userId, message, { fetch: expo.fetch, sleep });

    expect(result).toEqual({ accepted: 1, failed: 2, removed: 1 });
    const left = (await prisma.pushToken.findMany({ orderBy: { token: "asc" } })).map((row) => row.token);
    expect(left).toEqual(["ExponentPushToken[ada-001]", "ExponentPushToken[ada-002]"]);
    expect(await prisma.pushTicket.count()).toBe(1);
    expect(error).toHaveBeenCalledWith("push: ticket error", "nope", "MessageRateExceeded");
  });

  it("retries a throttled or failing request with backoff", async () => {
    const me = await account(1);
    const expo = fakeExpo([
      () => ({ status: 429, json: { errors: [{ code: "TOO_MANY_REQUESTS" }] } }),
      () => new Error("socket hang up"),
      tickets(),
    ]);
    sleep.mockClear();
    const result = await sendPushToUser(me.userId, message, { fetch: expo.fetch, sleep });
    expect(result.accepted).toBe(1);
    expect(expo.calls).toHaveLength(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });

  it("never throws: a rejected or unreachable send is logged and counted", async () => {
    const me = await account(2);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const rejected = fakeExpo([() => ({ status: 400, json: { errors: [{ code: "VALIDATION_ERROR" }] } })]);
    await expect(sendPushToUser(me.userId, message, { fetch: rejected.fetch, sleep })).resolves.toEqual({
      accepted: 0,
      failed: 2,
      removed: 0,
    });
    expect(rejected.calls).toHaveLength(1);

    const down = fakeExpo([() => ({ status: 503, json: {} })]);
    await expect(sendPushToUser(me.userId, message, { fetch: down.fetch, sleep })).resolves.toMatchObject({
      failed: 2,
    });
    expect(down.calls).toHaveLength(3);
    expect(error).toHaveBeenCalled();
    expect(await prisma.pushToken.count()).toBe(2);
  });

  it("sends the access token when enhanced push security is on", async () => {
    process.env.EXPO_ACCESS_TOKEN = "expo-access";
    const me = await account(1);
    const expo = fakeExpo([tickets()]);
    await sendPushToUser(me.userId, message, { fetch: expo.fetch, sleep });
    expect(expo.calls[0].headers.authorization).toBe("Bearer expo-access");
  });

  it("sends nothing for an account without phones", async () => {
    const me = await account(0);
    const expo = fakeExpo([tickets()]);
    await expect(sendPushToUser(me.userId, message, { fetch: expo.fetch, sleep })).resolves.toEqual({
      accepted: 0,
      failed: 0,
      removed: 0,
    });
    expect(expo.calls).toHaveLength(0);
  });

  it("settles due receipts before sending", async () => {
    const me = await account(1);
    const now = new Date();
    await prisma.pushTicket.create({
      data: {
        id: "old-ticket",
        pushTokenId: me.tokens[0].id,
        createdAt: new Date(now.getTime() - RECEIPT_DELAY_MS - 1000),
      },
    });
    const expo = fakeExpo([
      (call) =>
        call.url === EXPO_PUSH_RECEIPTS_URL ? { json: { data: { "old-ticket": { status: "ok" } } } } : tickets()(call),
    ]);
    await sendPushToUser(me.userId, message, { fetch: expo.fetch, sleep, now });
    expect(expo.calls.map((call) => call.url)).toEqual([EXPO_PUSH_RECEIPTS_URL, EXPO_PUSH_SEND_URL]);
    expect(await prisma.pushTicket.findUnique({ where: { id: "old-ticket" } })).toBeNull();
    expect(await prisma.pushTicket.count()).toBe(1);
  });

  describe("category gating", () => {
    it("skips a category the account turned off, with no Expo call and no log row", async () => {
      const me = await account(1);
      await prisma.pushPreference.create({ data: { userId: me.userId, shareComments: false } });
      const expo = fakeExpo([tickets()]);
      const result = await sendPushToUser(
        me.userId,
        { ...message, category: "shareComments" },
        { fetch: expo.fetch, sleep }
      );
      expect(result).toEqual({ accepted: 0, failed: 0, removed: 0 });
      expect(expo.calls).toHaveLength(0);
      expect(await prisma.pushNotificationLog.count()).toBe(0);
    });

    it("sends a categorized message by default, and logs it", async () => {
      const me = await account(1);
      const expo = fakeExpo([tickets()]);
      const result = await sendPushToUser(
        me.userId,
        { ...message, category: "chatFinished", dedupeKey: "chat-finished:turn-1" },
        { fetch: expo.fetch, sleep }
      );
      expect(result).toEqual({ accepted: 1, failed: 0, removed: 0 });
      const logged = await prisma.pushNotificationLog.findMany({ where: { userId: me.userId } });
      expect(logged).toMatchObject([{ category: "chatFinished", key: "chat-finished:turn-1" }]);
    });

    it("sends a repeated dedupeKey at most once", async () => {
      const me = await account(1);
      const expo = fakeExpo([tickets()]);
      const send = () =>
        sendPushToUser(
          me.userId,
          { ...message, category: "shareComments", dedupeKey: "share-comment:c1" },
          { fetch: expo.fetch, sleep }
        );
      await expect(send()).resolves.toEqual({ accepted: 1, failed: 0, removed: 0 });
      await expect(send()).resolves.toEqual({ accepted: 0, failed: 0, removed: 0 });
      expect(expo.calls.filter((call) => call.url === EXPO_PUSH_SEND_URL)).toHaveLength(1);
      expect(await prisma.pushNotificationLog.count()).toBe(1);
    });

    it("caps a category at 5 per hour per account", async () => {
      const me = await account(1);
      const expo = fakeExpo([tickets()]);
      for (let i = 0; i < 5; i++) {
        await sendPushToUser(
          me.userId,
          { ...message, category: "shareComments", dedupeKey: `share-comment:c${i}` },
          { fetch: expo.fetch, sleep }
        );
      }
      const sixth = await sendPushToUser(
        me.userId,
        { ...message, category: "shareComments", dedupeKey: "share-comment:c5" },
        { fetch: expo.fetch, sleep }
      );
      expect(sixth).toEqual({ accepted: 0, failed: 0, removed: 0 });
      expect(expo.calls.filter((call) => call.url === EXPO_PUSH_SEND_URL)).toHaveLength(5);
    });

    it("does not cap a different category for the same account", async () => {
      const me = await account(1);
      const expo = fakeExpo([tickets()]);
      for (let i = 0; i < 5; i++) {
        await sendPushToUser(
          me.userId,
          { ...message, category: "shareComments", dedupeKey: `share-comment:c${i}` },
          { fetch: expo.fetch, sleep }
        );
      }
      const result = await sendPushToUser(
        me.userId,
        { ...message, category: "chatFinished", dedupeKey: "chat-finished:turn-1" },
        { fetch: expo.fetch, sleep }
      );
      expect(result).toEqual({ accepted: 1, failed: 0, removed: 0 });
    });
  });
});

describe("checkPushReceipts", () => {
  beforeEach(async () => {
    await prisma.pushTicket.deleteMany();
    await prisma.pushToken.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  async function ticket(id: string, pushTokenId: string, ageMs: number, now: Date) {
    await prisma.pushTicket.create({
      data: { id, pushTokenId, createdAt: new Date(now.getTime() - ageMs) },
    });
  }

  it("reads only receipts that are due, drops gone phones, and keeps what has not arrived", async () => {
    const me = await account(3);
    const now = new Date();
    const [a, b, c] = me.tokens;
    await ticket("fresh", a.id, 60_000, now);
    await ticket("delivered", a.id, RECEIPT_DELAY_MS + 1, now);
    await ticket("gone", b.id, RECEIPT_DELAY_MS + 1, now);
    await ticket("gone-too", b.id, RECEIPT_DELAY_MS + 2, now);
    await ticket("pending", c.id, RECEIPT_DELAY_MS + 1, now);
    await ticket("expired", c.id, RECEIPT_TTL_MS + 1, now);
    await ticket("failed", c.id, RECEIPT_DELAY_MS + 1, now);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const expo = fakeExpo([
      () => ({
        json: {
          data: {
            delivered: { status: "ok" },
            gone: { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
            failed: { status: "error", message: "big", details: { error: "MessageTooBig" } },
          },
        },
      }),
    ]);
    const result = await checkPushReceipts({ fetch: expo.fetch, sleep, now });

    expect(expo.calls).toHaveLength(1);
    expect((expo.calls[0].body as { ids: string[] }).ids.sort()).toEqual(
      ["delivered", "expired", "failed", "gone", "gone-too", "pending"].sort()
    );
    expect(result).toEqual({ settled: 4, removed: 1 });
    expect((await prisma.pushTicket.findMany()).map((t) => t.id).sort()).toEqual(["fresh", "pending"]);
    expect((await prisma.pushToken.findMany()).map((t) => t.id).sort()).toEqual([a.id, c.id].sort());
    expect(error).toHaveBeenCalledWith("push: receipt error", "big", "MessageTooBig");
  });

  it("asks for at most 1000 receipts at a time", async () => {
    const me = await account(1);
    const now = new Date();
    await prisma.pushTicket.createMany({
      data: Array.from({ length: 1001 }, (_, i) => ({
        id: `t-${i}`,
        pushTokenId: me.tokens[0].id,
        createdAt: new Date(now.getTime() - RECEIPT_DELAY_MS - 1000 - i),
      })),
    });
    const expo = fakeExpo([
      (call) => ({
        json: { data: Object.fromEntries((call.body as { ids: string[] }).ids.map((id) => [id, { status: "ok" }])) },
      }),
    ]);
    await checkPushReceipts({ fetch: expo.fetch, sleep, now });
    expect((expo.calls[0].body as { ids: string[] }).ids).toHaveLength(1000);
    expect(await prisma.pushTicket.count()).toBe(1);
  });

  it("makes no request when nothing is due", async () => {
    const expo = fakeExpo([() => ({ json: { data: {} } })]);
    await expect(checkPushReceipts({ fetch: expo.fetch, sleep })).resolves.toEqual({ settled: 0, removed: 0 });
    expect(expo.calls).toHaveLength(0);
  });
});
