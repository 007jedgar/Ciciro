import { NextRequest, NextResponse } from "next/server";
import { renderEmail } from "@/lib/email/render";
import { emailPreviews } from "@/lib/email/templates";
import { publicOrigin } from "@/lib/public-origin";

export const runtime = "nodejs";

// GET /dev/emails/:id: one template rendered with sample data, exactly as it
// would be sent (?format=text for the plain-text part). Local development only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const { id } = await params;
  const origin = publicOrigin(req.nextUrl.origin);
  const preview = emailPreviews(origin).find((item) => item.id === id);
  if (!preview) return new NextResponse(null, { status: 404 });
  const rendered = await renderEmail(preview.content, origin);
  const text = req.nextUrl.searchParams.get("format") === "text";
  return new NextResponse(text ? rendered.text : rendered.html, {
    headers: {
      "content-type": text ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
