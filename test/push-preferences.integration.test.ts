import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_HEADER } from "@/lib/auth/constants";
import { hashSessionToken } from "@/lib/auth/tokens";
import { GET, PUT } from "@/app/api/push/preferences/route";

async function signIn(label: string) {
  const user = await prisma.user.create({ data: { email: `${label}@example.com`, passwordHash: "x" } });
  const token = `${label}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + 3600_000) },
  });
  return { userId: user.id, token };
}

function request(method: string, token: string | null, body?: unknown) {
  return new NextRequest("http://localhost/api/push/preferences", {
    method,
    headers: { "content-type": "application/json", ...(token ? { [SESSION_HEADER]: token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("push preferences route", () => {
  beforeEach(async () => {
    await prisma.pushPreference.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("requires a session", async () => {
    expect((await GET(request("GET", null))).status).toBe(401);
    expect((await PUT(request("PUT", null, { shareComments: false }))).status).toBe(401);
  });

  it("defaults every category on for an account with no row yet", async () => {
    const me = await signIn("ada");
    const res = await GET(request("GET", me.token));
    expect(await res.json()).toMatchObject({
      shareComments: true,
      writingNudge: true,
      chatFinished: true,
    });
    expect(await prisma.pushPreference.count()).toBe(0);
  });

  it("flips one category and leaves the others alone", async () => {
    const me = await signIn("ada");
    const res = await PUT(request("PUT", me.token, { writingNudge: false }));
    expect(await res.json()).toMatchObject({
      shareComments: true,
      writingNudge: false,
      chatFinished: true,
    });
    const again = await GET(request("GET", me.token));
    expect(await again.json()).toMatchObject({ writingNudge: false });
  });

  it("ignores unknown keys and non-boolean values", async () => {
    const me = await signIn("ada");
    const res = await PUT(
      request("PUT", me.token, { writingNudge: "nope", somethingElse: true, chatFinished: false })
    );
    expect(await res.json()).toMatchObject({ writingNudge: true, chatFinished: false });
  });

  it("never reaches another account's preferences", async () => {
    const ada = await signIn("ada");
    const ben = await signIn("ben");
    await PUT(request("PUT", ada.token, { chatFinished: false }));
    const bensView = await GET(request("GET", ben.token));
    expect(await bensView.json()).toMatchObject({ chatFinished: true });
  });
});
