import { NextRequest } from "next/server";
import { authorizeProject } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import {
  createNamedBibleFile,
  ensureBible,
  getBibleFile,
  listBible,
  writeBibleFile,
} from "@/lib/bible";

export const runtime = "nodejs";

// GET /api/bible?projectId=...            -> list files (index)
// GET /api/bible?projectId=...&path=x.md  -> read one file
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const p = req.nextUrl.searchParams.get("path");
  if (!projectId) return json({ error: "projectId required" }, 400);
  try {
    await authorizeProject(projectId, req);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
  await ensureBible(projectId);

  if (p) {
    try {
      const row = await getBibleFile(projectId, p);
      return json({ path: p, content: row?.content ?? "", revision: row?.revision ?? 0 }, 200);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }
  const entries = await listBible(projectId);
  return json(entries, 200);
}

// POST /api/bible  { projectId, path, content, expectedRevision? } -> write a file
// POST /api/bible  { projectId, newCharacter: "Name" }             -> create a character file
// POST /api/bible  { projectId, newPlot: "Name" }                  -> create a plot-line file
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { projectId } = body;
  if (!projectId) return json({ error: "projectId required" }, 400);
  try {
    await authorizeProject(projectId, req);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
  await ensureBible(projectId);

  if (body.newCharacter?.trim() || body.newPlot?.trim()) {
    const kind = body.newCharacter?.trim() ? "character" : "plot";
    const name = (kind === "character" ? body.newCharacter : body.newPlot).trim();
    try {
      const file = await createNamedBibleFile(projectId, kind, name);
      return json({ path: file.path, content: file.content, revision: file.revision }, 201);
    } catch (e) {
      const failure = responseFromAuthError(e);
      if (failure) return failure;
      return json({ error: (e as Error).message }, 400);
    }
  }

  if (typeof body.path === "string" && typeof body.content === "string") {
    const expectedRevision =
      typeof body.expectedRevision === "number" && Number.isInteger(body.expectedRevision)
        ? body.expectedRevision
        : undefined;
    try {
      const file = await writeBibleFile(projectId, body.path, body.content, expectedRevision);
      return json({ ok: true, path: file.path, revision: file.revision }, 200);
    } catch (e) {
      const failure = responseFromAuthError(e);
      if (failure) return failure;
      return json({ error: (e as Error).message }, 400);
    }
  }
  return json({ error: "path and content required" }, 400);
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
