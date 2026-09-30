import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import {
  EMAIL_TOPICS,
  getEmailPreference,
  setMarketingOptIn,
  updateTopics,
  type EmailTopic,
} from "@/lib/email/preferences";
import { sendWelcomeStep1 } from "@/lib/email/welcome-sequence";
import { publicOrigin } from "@/lib/public-origin";

export const runtime = "nodejs";

// Settings (web and mobile): the signed-in author's own marketing-email
// topics, and the combined opt-in checkbox itself. A false -> true flip here
// starts the welcome sequence exactly like signup does: step 1 goes out at
// once (best-effort; sendMarketingEmail's own MarketingEmailLog key means a
// writer who already has step 1 never gets a second one), and
// setMarketingOptIn's marketingOptInAt stamp is what steps 2-4 count their
// day-3/7/14 windows from. See src/app/email/preferences for the public,
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
    const before = await getEmailPreference(user.id);
    await setMarketingOptIn(user.id, body.marketingOptIn);
    if (body.marketingOptIn === true && !before?.marketingOptIn) {
      await sendWelcomeStep1(user, publicOrigin(req.nextUrl.origin)).catch((error) =>
        console.error("welcome step 1 failed", error)
      );
    }
  }
  const patch: Partial<Record<EmailTopic, boolean>> = {};
  for (const topic of EMAIL_TOPICS) {
    if (typeof body[topic] === "boolean") patch[topic] = body[topic] as boolean;
  }
  const pref = Object.keys(patch).length ? await updateTopics(user.id, patch) : await getEmailPreference(user.id);
  return NextResponse.json(shape(pref));
}
