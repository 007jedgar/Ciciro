import { NextRequest } from "next/server";
import {
  ensureBible,
  listBible,
  readBibleFile,
  writeBibleFile,
  slugify,
} from "@/lib/bible";

export const runtime = "nodejs";

// GET /api/bible?projectId=...            -> list files (index)
// GET /api/bible?projectId=...&path=x.md  -> read one file
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  const p = req.nextUrl.searchParams.get("path");
  if (!projectId) return json({ error: "projectId required" }, 400);
  await ensureBible(projectId);

  if (p) {
    try {
      const content = await readBibleFile(projectId, p);
      return json({ path: p, content }, 200);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }
  const entries = await listBible(projectId);
  return json(entries, 200);
}

// POST /api/bible  { projectId, path, content }         -> write a file
// POST /api/bible  { projectId, newCharacter: "Name" }  -> create a character file
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { projectId } = body;
  if (!projectId) return json({ error: "projectId required" }, 400);
  await ensureBible(projectId);

  if (body.newCharacter?.trim()) {
    const name = body.newCharacter.trim();
    const path = `characters/${slugify(name)}.md`;
    const content = `# ${name}\n> Character\n\n**Role:** \n\n## Description\n\n## Arc\n\n## Voice\n> How they speak: diction, rhythm, tics.\n`;
    try {
      await writeBibleFile(projectId, path, content);
      return json({ path, content }, 201);
    } catch (e) {
      return json({ error: (e as Error).message }, 400);
    }
  }

  if (typeof body.path === "string" && typeof body.content === "string") {
    try {
      await writeBibleFile(projectId, body.path, body.content);
      return json({ ok: true }, 200);
    } catch (e) {
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
