import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { createPlotPoint, listPlotPoints } from "@/lib/story";

export const runtime = "nodejs";

// GET /api/plotpoints?projectId=... — list plot points in order.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  const user = await getSessionUser();
  try {
    const points = await listPlotPoints(projectId, user);
    return NextResponse.json(points);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// POST /api/plotpoints — add a plot point / open loop to track.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  const body = await req.json().catch(() => ({}));
  try {
    const point = await createPlotPoint(user, body);
    return NextResponse.json(point, { status: 201 });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
