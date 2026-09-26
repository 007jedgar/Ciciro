import { NextRequest, NextResponse } from "next/server";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { postReaderComment } from "@/lib/shares";
import { COMMENT_REQUEST_MAX_BYTES } from "@/lib/share-view";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

const NO_STORE = { "cache-control": "no-store" };

/**
 * The reader's address, for rate limiting. Cloudflare sets cf-connecting-ip
 * and overwrites any a client sent; the others are for other hosts, where a
 * proxy in front must set them. Without one, readers share a single budget,
 * and the per-link limits still hold.
 */
function clientAddress(req: NextRequest): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

// POST /api/read/:token/comments — a beta reader comments on a passage. No
// session: the token is the credential. Body: { chapterId, blockId, quote,
// offset, body, name }.
export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > COMMENT_REQUEST_MAX_BYTES) {
    return NextResponse.json({ error: "That comment is too long." }, { status: 413, headers: NO_STORE });
  }
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > COMMENT_REQUEST_MAX_BYTES) {
    return NextResponse.json({ error: "That comment is too long." }, { status: 413, headers: NO_STORE });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid comment." }, { status: 400, headers: NO_STORE });
  }
  try {
    const receipt = await postReaderComment(token, body as Record<string, unknown>, {
      address: clientAddress(req),
    });
    return NextResponse.json(receipt, { status: 201, headers: NO_STORE });
  } catch (error) {
    const response = responseFromAuthError(error) ?? responseFromDbError(error);
    if (response) {
      response.headers.set("cache-control", "no-store");
      if (response.status === 429) response.headers.set("retry-after", "60");
      return response;
    }
    throw error;
  }
}
