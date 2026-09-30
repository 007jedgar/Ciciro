import { NextRequest, NextResponse } from "next/server";
import {
  EMAIL_TOPICS,
  preferenceByToken,
  unsubscribeByToken,
  updateTopicsByToken,
  type EmailTopic,
} from "@/lib/email/preferences";

export const runtime = "nodejs";

// The public, no-session preferences endpoint every marketing email's
// "Manage email preferences" link opens (src/app/email/preferences/page.tsx).
// Keyed by the unsubscribeToken alone: no login needed, matching how most
// products let a reader manage a mailing list straight from the email.

function shape(pref: { marketingOptIn: boolean; productUpdates: boolean; weeklyEmail: boolean; offers: boolean }) {
  return {
    marketingOptIn: pref.marketingOptIn,
    productUpdates: pref.productUpdates,
    weeklyEmail: pref.weeklyEmail,
    offers: pref.offers,
  };
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const pref = token ? await preferenceByToken(token) : null;
  if (!pref) return NextResponse.json({ error: "This link is no longer valid." }, { status: 404 });
  return NextResponse.json(shape(pref));
}

/**
 * Body: any of the topic booleans to change, and/or `marketingOptIn: false`
 * for the page's "Unsubscribe from all" action (there is no way to turn the
 * combined opt-in back on from here — that only ever happens in Settings or
 * at signup, so a stray `marketingOptIn: true` is ignored).
 */
export async function PATCH(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const patch: Partial<Record<EmailTopic, boolean>> = {};
  for (const topic of EMAIL_TOPICS) {
    if (typeof body[topic] === "boolean") patch[topic] = body[topic] as boolean;
  }
  const pref = Object.keys(patch).length ? await updateTopicsByToken(token, patch) : await preferenceByToken(token);
  if (!pref) return NextResponse.json({ error: "This link is no longer valid." }, { status: 404 });

  if (body.marketingOptIn === false) {
    const unsubscribed = await unsubscribeByToken(token, "all");
    if (unsubscribed) return NextResponse.json(shape(unsubscribed));
  }
  return NextResponse.json(shape(pref));
}
