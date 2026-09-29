import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, SESSION_HEADER } from "@/lib/auth/constants";
import { getSessionUser } from "@/lib/auth/session";
import {
  PURGED_MODELS,
  deleteAccount,
  purgeAccountData,
  type PreDeleteHook,
} from "@/lib/account/delete";
import { DELETE } from "@/app/api/auth/account/route";
import { allModelNames, countAllModels, seedAccount, wipeDatabase } from "./account-fixture";
import { fakeAppleSigningKey } from "./helpers/fake-idp";

function deleteRequest(token: string | null, body: unknown) {
  return new NextRequest("http://localhost/api/auth/account", {
    method: "DELETE",
    headers: {
      "content-type": "application/json",
      ...(token ? { [SESSION_HEADER]: token } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("account deletion", () => {
  beforeEach(wipeDatabase);
  afterEach(async () => {
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("names every model in the purge", () => {
    expect([...PURGED_MODELS].sort()).toEqual(allModelNames().sort());
  });

  it("the seed reaches every model", async () => {
    await seedAccount("coverage");
    const counts = await countAllModels();
    for (const [model, count] of Object.entries(counts)) {
      expect(count, `${model} has no seeded row`).toBeGreaterThan(0);
    }
  });

  it("removes every row the account owns and leaves another account untouched", async () => {
    const keep = await seedAccount("keep");
    const before = await countAllModels();
    const gone = await seedAccount("gone");

    const res = await DELETE(deleteRequest(gone.sessionToken, { password: gone.password }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(await countAllModels()).toEqual(before);
    expect(await prisma.user.findUnique({ where: { id: gone.userId } })).toBeNull();
    const kept = await prisma.project.findUniqueOrThrow({
      where: { id: keep.projectId },
      include: { chapters: true },
    });
    expect(kept.chapters.map((c) => c.content)).toContain(
      '<p data-block-id="b1">The keep chapter begins.</p>'
    );
  });

  it("does not depend on foreign-key cascades", async () => {
    const keep = await seedAccount("keep");
    const before = await countAllModels();
    const gone = await seedAccount("gone");

    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    const [{ foreign_keys }] = await prisma.$queryRawUnsafe<{ foreign_keys: bigint }[]>(
      "PRAGMA foreign_keys"
    );
    expect(Number(foreign_keys)).toBe(0);

    await purgeAccountData(gone.userId);
    expect(await countAllModels()).toEqual(before);
    expect(await prisma.user.findUnique({ where: { id: keep.userId } })).not.toBeNull();
  });

  it("signs every device out and clears the session cookie", async () => {
    const gone = await seedAccount("gone");
    await prisma.session.create({
      data: {
        userId: gone.userId,
        tokenHash: "second-device",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const res = await DELETE(deleteRequest(gone.sessionToken, { password: gone.password }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain(`${SESSION_COOKIE}=;`);
    expect(await prisma.session.count({ where: { userId: gone.userId } })).toBe(0);
    const stale = new NextRequest("http://localhost/api/auth/me", {
      headers: { [SESSION_HEADER]: gone.sessionToken },
    });
    expect(await getSessionUser(stale)).toBeNull();
  });

  it("requires the password and keeps the account on a wrong one", async () => {
    const gone = await seedAccount("gone");
    const missing = await DELETE(deleteRequest(gone.sessionToken, {}));
    expect(missing.status).toBe(400);
    const wrong = await DELETE(deleteRequest(gone.sessionToken, { password: "not-it" }));
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ error: "Incorrect password." });
    expect(await prisma.project.count({ where: { userId: gone.userId } })).toBe(1);
  });

  it("requires a session", async () => {
    const gone = await seedAccount("gone");
    const res = await DELETE(deleteRequest(null, { password: gone.password }));
    expect(res.status).toBe(401);
    expect(await prisma.user.count({ where: { id: gone.userId } })).toBe(1);
  });

  it("asks an account without a password to type DELETE", async () => {
    const gone = await seedAccount("gone");
    await prisma.user.update({ where: { id: gone.userId }, data: { passwordHash: "" } });
    await expect(deleteAccount(gone.userId, { confirmation: "remove" })).rejects.toMatchObject({
      status: 400,
    });
    await deleteAccount(gone.userId, { confirmation: " delete " });
    expect(await prisma.user.count({ where: { id: gone.userId } })).toBe(0);
  });

  it("runs pre-delete hooks in order before the purge", async () => {
    const gone = await seedAccount("gone");
    const seen: string[] = [];
    const hooks: PreDeleteHook[] = [
      {
        name: "billing",
        run: async (account) => {
          seen.push(`billing:${account.email}`);
          expect(await prisma.user.count({ where: { id: account.id } })).toBe(1);
        },
      },
      { name: "apple", run: async () => void seen.push("apple") },
    ];
    await deleteAccount(gone.userId, { password: gone.password }, hooks);
    expect(seen).toEqual(["billing:gone@example.com", "apple"]);
    expect(await prisma.user.count({ where: { id: gone.userId } })).toBe(0);
  });

  it("keeps the account whole when a hook fails", async () => {
    const gone = await seedAccount("gone");
    const before = await countAllModels();
    const hooks: PreDeleteHook[] = [
      {
        name: "billing",
        run: async () => {
          throw new Error("Stripe is down");
        },
      },
    ];
    const error = await deleteAccount(gone.userId, { password: gone.password }, hooks).catch(
      (e: unknown) => e
    );
    expect(error).toMatchObject({ status: 502 });
    expect(await countAllModels()).toEqual(before);
  });
});

describe("account deletion with Sign in with Apple", () => {
  let applePem = "";

  beforeAll(async () => {
    applePem = (await fakeAppleSigningKey()).pem;
  });

  beforeEach(async () => {
    await wipeDatabase();
    vi.stubEnv("APPLE_TEAM_ID", "TEAM123456");
    vi.stubEnv("APPLE_KEY_ID", "KEY1234567");
    vi.stubEnv("APPLE_PRIVATE_KEY", applePem);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** A password-less account that signed in with Apple, holding a refresh token. */
  async function appleAccount() {
    const gone = await seedAccount("gone");
    await prisma.user.update({ where: { id: gone.userId }, data: { passwordHash: "" } });
    await prisma.identity.create({
      data: {
        userId: gone.userId,
        provider: "apple",
        subject: "001.gone",
        refreshToken: "gone-rt",
        refreshTokenClientId: "app.ciciro.mobile",
      },
    });
    return gone;
  }

  it("revokes the Apple token before the purge", async () => {
    const gone = await appleAccount();
    const revoked: URLSearchParams[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe("https://appleid.apple.com/auth/revoke");
        // Still there: the token lives on the Identity row the purge removes.
        expect(await prisma.user.count({ where: { id: gone.userId } })).toBe(1);
        revoked.push(new URLSearchParams(String(init?.body)));
        return new Response(null, { status: 200 });
      })
    );
    const res = await DELETE(deleteRequest(gone.sessionToken, { confirmation: "DELETE" }));
    expect(res.status).toBe(200);
    expect(revoked.map((body) => [body.get("token"), body.get("client_id")])).toEqual([
      ["gone-rt", "app.ciciro.mobile"],
    ]);
    expect(await prisma.user.count({ where: { id: gone.userId } })).toBe(0);
  });

  it("keeps the account whole when Apple does not confirm the revoke", async () => {
    const gone = await appleAccount();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    const before = await countAllModels();
    const res = await DELETE(deleteRequest(gone.sessionToken, { confirmation: "DELETE" }));
    expect(res.status).toBe(502);
    expect(await countAllModels()).toEqual(before);
    const identity = await prisma.identity.findFirstOrThrow({ where: { provider: "apple" } });
    expect(identity.refreshToken).toBe("gone-rt");
  });

  it("does not call Apple for an account without an Apple token", async () => {
    const gone = await seedAccount("gone");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await deleteAccount(gone.userId, { password: gone.password });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.user.count({ where: { id: gone.userId } })).toBe(0);
  });
});
