import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { importManuscript } from "@/lib/import-manuscript";
import { IMPORT_MAX_BYTES } from "@/lib/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function field(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value : undefined;
}

// POST /api/import — multipart upload (`file`, optional `projectId`, `title`,
// `author`, `folderId`). Without projectId the file becomes a new manuscript;
// with it, the file's chapters are appended to that manuscript.
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: "Choose a file to import." }, { status: 400 });
  }
  if (file.size > IMPORT_MAX_BYTES) {
    return NextResponse.json({ error: "That file is too large to import (20 MB limit)." }, { status: 413 });
  }
  try {
    const result = await importManuscript(user, {
      filename: file.name,
      data: new Uint8Array(await file.arrayBuffer()),
      projectId: field(form, "projectId"),
      title: field(form, "title"),
      author: field(form, "author"),
      folderId: field(form, "folderId"),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
}
