import { prisma } from "@/lib/db";
import { sendEmail, type SendEmailResult } from "@/lib/email";
import type { EmailContent } from "@/lib/email/content";
import { renderEmail } from "@/lib/email/render";
import { marketingEnabled, preferencesUrl, unsubscribeUrl, type EmailTopic } from "@/lib/email/preferences";

// Every marketing send goes through here, never through sendTemplateEmail
// (account-emails.ts): it is the one place that (1) checks the topic is
// actually on, (2) is idempotent per (userId, key) via MarketingEmailLog, and
// (3) attaches the RFC 8058 one-click unsubscribe headers and the
// manage-preferences / unsubscribe footer links every marketing email must
// carry. See docs/hosting.md#email for the separate sending identity.

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The marketing sender, on its own subdomain so a complaint spike there
 *  never touches the transactional domain's reputation. Falls back to
 *  EMAIL_FROM in dev/self-hosted, where there is only one sending identity. */
function marketingFrom(): string | undefined {
  return readEnv("MARKETING_EMAIL_FROM") ?? readEnv("EMAIL_FROM");
}

export type SendMarketingEmailParams = {
  userId: string;
  email: string;
  topic: EmailTopic;
  /** Unique per (userId, key): the MarketingEmailLog dedup key, and the Resend idempotency key. */
  key: string;
  origin: string;
  /** Built last, once every gate has passed, with the unsubscribe links for this user. */
  buildContent: (unsubscribe: { manageUrl: string; unsubscribeUrl: string }) => EmailContent;
};

export type SendMarketingEmailResult = { sent: boolean; reason?: "topic_off" | "already_sent" | "send_failed" };

/**
 * Send one marketing email, or skip it. Never throws: a failed send is
 * logged by sendEmail and reported back as `{ sent: false }`, exactly like
 * the transactional sends in account-emails.ts.
 */
export async function sendMarketingEmail(
  params: SendMarketingEmailParams
): Promise<SendMarketingEmailResult> {
  const { userId, email, topic, key, origin } = params;
  if (!(await marketingEnabled(userId, topic))) return { sent: false, reason: "topic_off" };

  const pref = await prisma.emailPreference.findUnique({ where: { userId } });
  if (!pref) return { sent: false, reason: "topic_off" };

  // Claim the log row before sending: a duplicate cron tick or retry that
  // loses the race sees the unique constraint fail and skips, rather than
  // sending twice. If the send itself then fails, the row is removed so a
  // later retry is not blocked by a send that never went out.
  try {
    await prisma.marketingEmailLog.create({ data: { userId, key } });
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === "P2002") {
      return { sent: false, reason: "already_sent" };
    }
    throw error;
  }

  const manageUrl = preferencesUrl(origin, pref.unsubscribeToken);
  const oneClickUrl = unsubscribeUrl(origin, pref.unsubscribeToken, topic);
  const content = params.buildContent({ manageUrl, unsubscribeUrl: oneClickUrl });

  let result: SendEmailResult;
  try {
    const rendered = await renderEmail(content, origin);
    result = await sendEmail({
      to: email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: [{ name: "category", value: content.category }],
      idempotencyKey: `marketing/${key}`,
      from: marketingFrom(),
      headers: {
        "List-Unsubscribe": `<${oneClickUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  } catch (error) {
    console.error(`[email] marketing send "${key}" failed to render`, error);
    result = { sent: false, error: { message: "Could not render email" } };
  }

  if (!result.sent) {
    await prisma.marketingEmailLog.deleteMany({ where: { userId, key } });
    return { sent: false, reason: "send_failed" };
  }
  return { sent: true };
}
