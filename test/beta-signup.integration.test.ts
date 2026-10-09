import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/beta-signup/route";

function signup(body: unknown, address: string | null = "9.9.9.9") {
  return new NextRequest("http://localhost/api/beta-signup", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(address ? { "cf-connecting-ip": address } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/beta-signup", () => {
  beforeEach(async () => {
    await prisma.betaSignup.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stores a normalized email with its source", async () => {
    const res = await POST(signup({ email: "  Ada@Example.COM ", source: "landing" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const rows = await prisma.betaSignup.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "ada@example.com", source: "landing" });
    expect(rows[0].ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows[0])).not.toContain("9.9.9.9");
  });

  it.each([{}, { email: "" }, { email: "nope" }, { email: "a@b" }, { email: 42 }])(
    "rejects an invalid email %j",
    async (body) => {
      const res = await POST(signup(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Enter a valid email address." });
      expect(await prisma.betaSignup.count()).toBe(0);
    }
  );

  it("answers a repeat quietly without a second row", async () => {
    await POST(signup({ email: "ada@example.com" }));
    const again = await POST(signup({ email: "ADA@example.com" }, "8.8.8.8"));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ ok: true });
    expect(await prisma.betaSignup.count()).toBe(1);
  });

  it("drops a honeypot submission without storing it", async () => {
    const res = await POST(signup({ email: "bot@example.com", website: "http://spam" }));
    expect(res.status).toBe(200);
    expect(await prisma.betaSignup.count()).toBe(0);
  });

  it("limits new signups per address, but not repeats or other addresses", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await POST(signup({ email: `p${i}@example.com` }))).status).toBe(200);
    }
    const blocked = await POST(signup({ email: "p5@example.com" }));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(await prisma.betaSignup.count()).toBe(5);

    expect((await POST(signup({ email: "p0@example.com" }))).status).toBe(200);
    expect((await POST(signup({ email: "other@example.com" }, "7.7.7.7"))).status).toBe(200);
    expect(await prisma.betaSignup.count()).toBe(6);
  });
});

describe("POST /api/beta-signup before the D1 upgrade", () => {
  it("answers 503 with a friendly message when the table is missing", async () => {
    const spy = vi.spyOn(prisma.betaSignup, "findUnique").mockRejectedValue(new Error("no such table: BetaSignup"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(signup({ email: "ada@example.com" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Signups are not open yet. Try again soon." });
    spy.mockRestore();
    err.mockRestore();
  });
});
