import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { createProject, listProjects } from "@/lib/projects";

export const runtime = "nodejs";

// GET /api/projects — list projects (most recent first). When a user is signed
// in, only their manuscripts are returned; local-first (no session) lists all.
export async function GET() {
  try {
    const user = await getSessionUser();
    const projects = await listProjects(user);
    return NextResponse.json(projects);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}

// POST /api/projects — create a project with an opening chapter, owned by the
// signed-in user when there is one.
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  const body = await req.json().catch(() => ({}));
  try {
    const project = await createProject(user, body);
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
