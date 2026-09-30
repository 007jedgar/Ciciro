import { NextRequest, NextResponse } from "next/server";
import { EMAIL_TOPICS, unsubscribeByToken } from "@/lib/email/preferences";
import { publicOrigin } from "@/lib/public-origin";

export const runtime = "nodejs";

// The one-click unsubscribe target every marketing email's List-Unsubscribe
// header and footer link point at (RFC 8058, and the 2024 Gmail/Yahoo bulk-
// sender rules). `t` is the EmailPreference.unsubscribeToken, `topic` is the
// one topic that email belongs to — a one-click unsubscribe only ever leaves
// that one list, never every topic (that is the preferences page's separate
// "Unsubscribe from all" action).
//
// POST is the one-click path: a mail client posts here with no person
// looking at a page, per RFC 8058, and must get a fast, silent 200. GET
// never mutates: mail security scanners and link prefetchers (Outlook
// SafeLinks, Proofpoint, Apple Mail Privacy Protection) fetch every link in a
// message, so a GET that unsubscribed would silently opt someone out who
// never clicked. It redirects to the preferences page with a `confirm` query
// param instead; that page shows a button which itself POSTs.

function readTopic(value: string | null): (typeof EMAIL_TOPICS)[number] | "all" | null {
  if (value === "all") return "all";
  return (EMAIL_TOPICS as readonly string[]).includes(value ?? "")
    ? (value as (typeof EMAIL_TOPICS)[number])
    : null;
}

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const topic = readTopic(req.nextUrl.searchParams.get("topic"));
  if (!token || !topic) return new NextResponse(null, { status: 400 });
  await unsubscribeByToken(token, topic);
  return new NextResponse(null, { status: 200 });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const topic = readTopic(req.nextUrl.searchParams.get("topic"));
  const origin = publicOrigin(req.nextUrl.origin);
  const url = new URL("/email/preferences", origin);
  if (!token || !topic) return NextResponse.redirect(url, 303);
  url.searchParams.set("t", token);
  url.searchParams.set("confirm", topic);
  return NextResponse.redirect(url, 303);
}
