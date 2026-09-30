import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  EMAIL_TOPICS,
  getEmailPreference,
  setMarketingOptIn,
  updateTopics,
  type EmailTopic,
} from "@/lib/email/preferences";

export const runtime = "nodejs";

// Settings (web and mobile): the signed-in author's own marketing-email
// topics. The combined opt-in checkbox itself is set at signup or from
// Settings' "Marketing email" toggle (POST), not here — this route only
// changes topics once it is on. See src/app/email/preferences for the public,
// no-session equivalent every marketing email's footer links to.

function shape(pref: { marketingOptIn: boolean; productUpdates: boolean; weeklyEmail: boolean; offers: boolean } | null) {
  return {
    marketingOptIn: pref?.marketingOptIn ?? false,
    productUpdates: pref?.productUpdates ?? true,
    weeklyEmail: pref?.weeklyEmail ?? true,
    offers: pref?.offers ?? true,
  };
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const pref = await getEmailPreference(user.id);
  return NextResponse.json(shape(pref));
}

/** PATCH { productUpdates?, weeklyEmail?, offers?, marketingOptIn? }. */
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof body.marketingOptIn === "boolean") {
    await setMarketingOptIn(user.id, body.marketingOptIn);
  }
  const patch: Partial<Record<EmailTopic, boolean>> = {};
  for (const topic of EMAIL_TOPICS) {
    if (typeof body[topic] === "boolean") patch[topic] = body[topic] as boolean;
  }
  const pref = Object.keys(patch).length ? await updateTopics(user.id, patch) : await getEmailPreference(user.id);
  return NextResponse.json(shape(pref));
}
