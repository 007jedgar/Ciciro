import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  NATIVE_CLIENT_HEADER,
  NATIVE_CLIENT_VALUE,
  SESSION_COOKIE,
  SESSION_HEADER,
} from "@/lib/auth/constants";
import { hashSessionToken } from "@/lib/auth/tokens";
import { defaultSettings, type AppSettings } from "@/lib/settings";
import { GET, PATCH, PUT } from "@/app/api/settings/route";
import { GET as me } from "@/app/api/auth/me/route";

// One stored settings document serves both clients through /api/settings: the
// web app authenticates with its httpOnly cookie, the phone with the session
// header. These tests send each client's own request shapes (the PATCH bodies
// SettingsProvider.tsx and apps/mobile/lib/settings.tsx build, and the phone's
// full-document PUT) and read the result back from the other client.

const TOKEN = "settings-route-token";
const URL = "http://localhost/api/settings";

type Client = "web" | "phone";

function request(client: Client, method = "GET", body?: unknown) {
  const headers: Record<string, string> =
    client === "web"
      ? { cookie: `${SESSION_COOKIE}=${TOKEN}` }
      : { [NATIVE_CLIENT_HEADER]: NATIVE_CLIENT_VALUE, [SESSION_HEADER]: TOKEN };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(URL, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function read(client: Client): Promise<AppSettings> {
  const res = await GET(request(client));
  expect(res.status).toBe(200);
  return (await res.json()).settings;
}

/** The PATCH body each client sends: every synced field, from its current copy. */
function patchBody(settings: AppSettings) {
  const { updatedAt: _updatedAt, ...fields } = settings;
  return fields;
}

describe("/api/settings: the Experimental writing prompt setting", () => {
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

  it("is off by default for both clients, and in /api/auth/me", async () => {
    expect((await read("web")).craftDefaults).toBe(false);
    expect((await read("phone")).craftDefaults).toBe(false);
    const res = await me(request("phone"));
    expect((await res.json()).settings.craftDefaults).toBe(false);
  });

  it("turned on from the web shows on the phone", async () => {
    const web = await read("web");
    const res = await PATCH(request("web", "PATCH", { ...patchBody(web), craftDefaults: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).settings.craftDefaults).toBe(true);
    expect((await read("phone")).craftDefaults).toBe(true);
  });

  it("turned off from the phone shows on the web", async () => {
    await PATCH(request("web", "PATCH", { craftDefaults: true }));
    const phone = await read("phone");
    const res = await PATCH(request("phone", "PATCH", { ...patchBody(phone), craftDefaults: false }));
    expect(res.status).toBe(200);
    expect((await read("web")).craftDefaults).toBe(false);
  });

  it("takes the phone's newer full-document PUT, and keeps the stored value over an older one", async () => {
    const stored = await read("phone");
    const newer = { ...stored, craftDefaults: true, updatedAt: new Date(Date.now() + 60_000).toISOString() };
    const res = await PUT(request("phone", "PUT", newer));
    expect(res.status).toBe(200);
    expect((await read("web")).craftDefaults).toBe(true);

    const older = { ...stored, craftDefaults: false, updatedAt: "2020-01-01T00:00:00.000Z" };
    await PUT(request("phone", "PUT", older));
    expect((await read("web")).craftDefaults).toBe(true);
  });

  it("leaves the setting alone when a client that predates it patches other fields", async () => {
    await PATCH(request("web", "PATCH", { craftDefaults: true }));
    const { craftDefaults: _craft, ...olderClient } = patchBody(defaultSettings());
    const res = await PATCH(request("phone", "PATCH", { ...olderClient, theme: "ember" }));
    expect(res.status).toBe(200);
    const after = await read("web");
    expect(after.theme).toBe("ember");
    expect(after.craftDefaults).toBe(true);
  });

  it("rejects a value that is not a boolean", async () => {
    for (const client of ["web", "phone"] as const) {
      const res = await PATCH(request(client, "PATCH", { craftDefaults: "on" }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("craftDefaults must be a boolean.");
    }
    expect((await read("web")).craftDefaults).toBe(false);
  });

  it("requires a session", async () => {
    const res = await PATCH(new NextRequest(URL, { method: "PATCH", body: JSON.stringify({ craftDefaults: true }) }));
    expect(res.status).toBe(401);
  });
});
