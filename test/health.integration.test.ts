import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { GET } from "@/app/api/health/route";
import { prisma } from "@/lib/db";
import { findSchemaFailures } from "@/lib/health";

describe("findSchemaFailures", () => {
  it("reports only the models whose read throws", async () => {
    const reader = (fail: boolean) => ({
      findFirst: async () => {
        if (fail) throw new Error("no such column: kind");
        return null;
      },
    });
    const client = { user: reader(false), project: reader(true), chapter: reader(false) };
    expect(await findSchemaFailures(client, ["User", "Project", "Chapter"])).toEqual(["Project"]);
  });

  it("treats a model with no delegate as a failure", async () => {
    expect(await findSchemaFailures({}, ["WeeklyReview"])).toEqual(["WeeklyReview"]);
  });

  it("covers every Prisma model by default", async () => {
    const seen: string[] = [];
    const client = new Proxy(
      {},
      { get: (_t, prop) => ({ findFirst: async () => void seen.push(String(prop)) }) }
    );
    expect(await findSchemaFailures(client)).toEqual([]);
    expect(seen).toHaveLength(Object.keys(Prisma.ModelName).length);
  });
});

describe("GET /api/health", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.CICIRO_REQUIRE_AUTH = "true";
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterEach(() => {
    process.env = { ...env };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("is ok when every model reads", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({
      status: "ok",
      db: "ok",
      schema: "ok",
      schemaFailures: [],
      anthropic: true,
      authRequired: true,
    });
  });

  it("is degraded when a column is missing, like the 2026-09-26 outage", async () => {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Project" DROP COLUMN "kind"`);
    try {
      const res = await GET();
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({
        status: "degraded",
        db: "ok",
        schema: "drift",
        schemaFailures: ["Project"],
      });
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Project" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'novel'`);
    }
  });

  it("reports a missing Anthropic key without failing, so self-hosted installs stay healthy", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", anthropic: false, authRequired: true });
  });
});
