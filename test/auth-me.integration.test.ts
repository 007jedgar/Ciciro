import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { NATIVE_CLIENT_HEADER, NATIVE_CLIENT_VALUE, SESSION_HEADER } from "@/lib/auth/constants";
import { hashSessionToken } from "@/lib/auth/tokens";
import { GET as me } from "@/app/api/auth/me/route";

const TOKEN = "phone-session-token";

function phoneRequest(headers: Record<string, string>) {
  return new NextRequest("http://localhost/api/auth/me", {
    headers: { [NATIVE_CLIENT_HEADER]: NATIVE_CLIENT_VALUE, ...headers },
  });
}

describe("GET /api/auth/me", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    const user = await prisma.user.create({ data: { email: "ada@example.com", passwordHash: "x" } });
    await prisma.session.create({
      data: { userId: user.id, tokenHash: hashSessionToken(TOKEN), expiresAt: new Date(Date.now() + 3_600_000) },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("echoes the token that matched, not a Cookie header iOS merged with a comma", async () => {
    const res = await me(
      phoneRequest({
        [SESSION_HEADER]: TOKEN,
        cookie: `ciciro_session=${TOKEN},ciciro_session=${TOKEN}`,
      })
    );
    const body = await res.json();
    expect(body.user.email).toBe("ada@example.com");
    expect(body.token).toBe(TOKEN);
    expect(res.headers.get(SESSION_HEADER)).toBe(TOKEN);
  });

  it("recovers a phone that already stored a garbled token next to its cookie", async () => {
    const res = await me(
      phoneRequest({
        [SESSION_HEADER]: `${TOKEN},ciciro_session=${TOKEN}`,
        cookie: `ciciro_session=${TOKEN}`,
      })
    );
    expect((await res.json()).token).toBe(TOKEN);
  });

  it("returns no user and no token without a valid session", async () => {
    const res = await me(phoneRequest({ [SESSION_HEADER]: "unknown" }));
    expect(await res.json()).toEqual({ user: null, settings: null });
  });
});
