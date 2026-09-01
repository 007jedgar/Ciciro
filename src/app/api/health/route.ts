import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health — liveness/readiness probe for load balancers and uptime
// checks. Reports whether the database is reachable. Public (see middleware).
export async function GET() {
  const startedAt = Date.now();
  let db: "ok" | "down" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "down";
  }
  const ok = db === "ok";
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      db,
      authRequired: process.env.CICIRO_REQUIRE_AUTH === "true",
      latencyMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
