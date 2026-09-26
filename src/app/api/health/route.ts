import { NextResponse } from "next/server";
import { authRequired } from "@/lib/auth/constants";
import { hasAnthropicKey } from "@/lib/anthropic";
import { prisma } from "@/lib/db";
import { findSchemaFailures } from "@/lib/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health — readiness probe for load balancers and the uptime monitor
// (.github/workflows/uptime.yml). Public (see middleware).
//
// `ok` means the app can serve real traffic: the database answers and every
// model reads with every column (catches D1 upgrades that never ran). Anything
// else is 503 `degraded`. `anthropic` is reported, not required: self-hosted
// installs may run without AI, and ciciro.app's monitor checks it separately.
export async function GET() {
  const startedAt = Date.now();
  let db: "ok" | "down" = "ok";
  let schemaFailures: string[] = [];
  try {
    await prisma.$queryRaw`SELECT 1`;
    schemaFailures = await findSchemaFailures(prisma);
  } catch (error) {
    db = "down";
    console.error("health: database unreachable:", error instanceof Error ? error.message : error);
  }
  const ok = db === "ok" && schemaFailures.length === 0;
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      db,
      schema: db === "down" ? "unknown" : schemaFailures.length ? "drift" : "ok",
      schemaFailures,
      anthropic: hasAnthropicKey(),
      authRequired: authRequired(),
      latencyMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
