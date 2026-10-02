import type { EmailBlock, EmailContent } from "@/lib/email/content";

// Every email Ciciro sends, as plain data (see content.ts). Account emails are
// wired in by src/lib/email/account-emails.ts; the billing ones are built and
// previewable (/dev/emails) for billing to send once it exists.

function greeting(name: string | undefined): EmailBlock[] {
  const first = name?.trim().split(/\s+/)[0];
  return first ? [{ kind: "paragraph", text: `Hi ${first},` }] : [];
}

/** "October 12, 2026". Dates are UTC: nothing records the reader's time zone. */
export function formatEmailDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(date);
}

function hoursLabel(ms: number): string {
  const hours = Math.round(ms / (60 * 60 * 1000));
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

/**
 * Tags a template's primary link so a click is attributable to this email:
 * AnalyticsProvider reads src/cta off the landing page and records
 * cta_clicked with source "email" (see docs/analytics.md). Never applied to
 * the unsubscribe/preference links, which withUnsubscribePreview and
 * sendMarketingEmail attach separately.
 */
function withSource(url: string, cta: string): string {
  try {
    const tagged = new URL(url);
    tagged.searchParams.set("src", "email");
    tagged.searchParams.set("cta", cta);
    return tagged.toString();
  } catch {
    return url;
  }
}

// ---- Account ----------------------------------------------------------------

export function verifyEmailTemplate(props: {
  name?: string;
  verifyUrl: string;
  /** How long the link works, in ms. */
  expiresInMs: number;
}): EmailContent {
  const verifyUrl = withSource(props.verifyUrl, "verify_email");
  return {
    category: "verify_email",
    subject: "Confirm your email for Ciciro",
    preview: "One click to confirm this address is yours.",
    heading: "Confirm your email",
    blocks: [
      ...greeting(props.name),
      {
        kind: "paragraph",
        text: "Welcome to Ciciro. Confirm that this address is yours so we can reach you about your account, for instance if you ever need to reset your password.",
      },
      { kind: "button", label: "Confirm my email", href: verifyUrl },
      { kind: "fallback-link", href: verifyUrl },
      {
        kind: "note",
        text: `The link works for ${hoursLabel(props.expiresInMs)}. Keep writing in the meantime; nothing waits on it.`,
      },
    ],
    footer:
      "You're getting this because a Ciciro account was created with this address. If that wasn't you, ignore this email and the address stays unconfirmed.",
  };
}

export function welcomeTemplate(props: { name?: string; appUrl: string }): EmailContent {
  return {
    category: "welcome",
    subject: "Welcome to Ciciro",
    preview: "Your manuscripts, your story bible, and an editor that reads along.",
    heading: "Welcome to Ciciro",
    blocks: [
      ...greeting(props.name),
      { kind: "paragraph", text: "Your account is ready. A few good places to start:" },
      {
        kind: "list",
        items: [
          "Start a manuscript, or import one from Word, Google Docs, Scrivener or Markdown.",
          "Fill in the story bible with your characters, plot and canon, so Ciciro keeps them in mind.",
          "Ask Ciciro to draft, revise or check a scene. Its changes arrive as suggestions you accept or reject.",
          "Pick up where you left off on your phone: your work syncs with the Ciciro app.",
        ],
      },
      { kind: "button", label: "Open Ciciro", href: withSource(props.appUrl, "welcome") },
      {
        kind: "note",
        text: "What you write stays yours. You can export all of it, or delete your account, from settings at any time.",
      },
    ],
    footer: "You're getting this because you created a Ciciro account with this address.",
  };
}

export function passwordResetTemplate(props: {
  email: string;
  resetUrl: string;
  /** How long the link works, in ms. */
  expiresInMs: number;
}): EmailContent {
  const resetUrl = withSource(props.resetUrl, "password_reset");
  return {
    category: "password_reset",
    subject: "Reset your Ciciro password",
    preview: `Choose a new password. The link works for ${hoursLabel(props.expiresInMs)}.`,
    heading: "Reset your password",
    blocks: [
      {
        kind: "paragraph",
        text: `Someone asked to reset the password for the Ciciro account ${props.email}. If that was you, choose a new one here.`,
      },
      { kind: "button", label: "Choose a new password", href: resetUrl },
      { kind: "fallback-link", href: resetUrl },
      {
        kind: "note",
        text: `The link works once, for ${hoursLabel(props.expiresInMs)}. A new password signs you out on every device, so you'll sign in again with it.`,
      },
    ],
    footer: "If you didn't ask for this, ignore this email. Your password stays as it is.",
  };
}

export function accountDeletedTemplate(props: {
  name?: string;
  email: string;
  deletedAt: Date;
}): EmailContent {
  return {
    category: "account_deleted",
    subject: "Your Ciciro account has been deleted",
    preview: "Everything in it is gone from Ciciro.",
    heading: "Your account has been deleted",
    blocks: [
      ...greeting(props.name),
      {
        kind: "paragraph",
        text: `The Ciciro account ${props.email} was deleted on ${formatEmailDate(props.deletedAt)}. Everything in it is gone from Ciciro, including manuscripts, story bibles, chat history and beta reader links, and every device that was signed in has been signed out.`,
      },
      {
        kind: "paragraph",
        text: "Backups kept to recover from outages age out within 30 days, and after that nothing of the account remains.",
      },
      {
        kind: "note",
        text: "Thank you for writing here. You're welcome back any time with a new account.",
      },
    ],
    footer:
      "You're getting this because the Ciciro account for this address was deleted. If you didn't delete it, reply to this email so we can look into it.",
  };
}

// ---- Billing (built for billing to wire in) -----------------------------------

export function paymentFailedTemplate(props: {
  name?: string;
  planName: string;
  /** Formatted with its currency, e.g. "$8.00". */
  amount: string;
  attemptedAt: Date;
  /** When the card will be tried again, if it will. */
  nextAttemptAt?: Date;
  updatePaymentUrl: string;
}): EmailContent {
  const rows = [
    { label: "Plan", value: props.planName },
    { label: "Amount", value: props.amount },
    { label: "Attempted", value: formatEmailDate(props.attemptedAt) },
  ];
  if (props.nextAttemptAt) rows.push({ label: "Next try", value: formatEmailDate(props.nextAttemptAt) });
  return {
    category: "payment_failed",
    subject: "Your Ciciro payment didn't go through",
    preview: `We couldn't charge ${props.amount} for ${props.planName}. Update your payment details to keep it.`,
    heading: "We couldn't take your payment",
    blocks: [
      ...greeting(props.name),
      {
        kind: "paragraph",
        text: `We tried to charge ${props.amount} for your ${props.planName} subscription, but the payment didn't go through.`,
      },
      { kind: "details", rows },
      { kind: "button", label: "Update payment details", href: withSource(props.updatePaymentUrl, "payment_failed") },
      {
        kind: "note",
        text: props.nextAttemptAt
          ? `Nothing you've written is affected. We'll try again on ${formatEmailDate(props.nextAttemptAt)}, or as soon as you update your details.`
          : "Nothing you've written is affected. We'll try again as soon as you update your details.",
      },
    ],
    footer: "You're getting this because you have a Ciciro subscription billed to this address.",
  };
}

export function subscriptionCanceledTemplate(props: {
  name?: string;
  planName: string;
  /** When paid access ends. */
  endsAt: Date;
  resubscribeUrl: string;
}): EmailContent {
  return {
    category: "subscription_canceled",
    subject: "Your Ciciro subscription is canceled",
    preview: `You keep ${props.planName} until ${formatEmailDate(props.endsAt)}, and you won't be charged again.`,
    heading: "Your subscription is canceled",
    blocks: [
      ...greeting(props.name),
      {
        kind: "paragraph",
        text: `Your ${props.planName} subscription is canceled. You keep everything it includes until ${formatEmailDate(props.endsAt)}, and you won't be charged again.`,
      },
      {
        kind: "paragraph",
        text: "Your manuscripts stay in your account, and you can export them from settings whenever you like.",
      },
      { kind: "button", label: "Resubscribe", href: withSource(props.resubscribeUrl, "subscription_canceled") },
      { kind: "note", text: "Changed your mind? Resubscribing before that date keeps everything as it is." },
    ],
    footer: "You're getting this because a Ciciro subscription billed to this address was canceled.",
  };
}

export function renewalReminderTemplate(props: {
  name?: string;
  planName: string;
  /** Formatted with its currency, e.g. "$80.00". */
  amount: string;
  renewsAt: Date;
  manageUrl: string;
}): EmailContent {
  const date = formatEmailDate(props.renewsAt);
  return {
    category: "renewal_reminder",
    subject: `Your Ciciro subscription renews on ${date}`,
    preview: `${props.amount} for ${props.planName} on ${date}. Nothing to do if you're staying.`,
    heading: "Your subscription renews soon",
    blocks: [
      ...greeting(props.name),
      {
        kind: "paragraph",
        text: `Your ${props.planName} subscription renews on ${date}, and ${props.amount} will be charged to your payment method on file.`,
      },
      {
        kind: "details",
        rows: [
          { label: "Plan", value: props.planName },
          { label: "Amount", value: props.amount },
          { label: "Renews", value: date },
        ],
      },
      { kind: "button", label: "Manage subscription", href: withSource(props.manageUrl, "renewal_reminder") },
      {
        kind: "note",
        text: `There's nothing to do if you're staying. To cancel or change plans, do it before ${date} and you won't be charged.`,
      },
    ],
    footer: "You're getting this because you have a Ciciro subscription billed to this address.",
  };
}

// ---- Marketing (built for src/lib/email/cron.ts and entitlements.ts's allowance nudge) --------
//
// None of these set `unsubscribe` — sendMarketingEmail (marketing-send.ts)
// attaches it after calling the template, so these stay pure and previewable
// without a real EmailPreference row.

export function welcomeStep1Template(props: { changelogUrl: string }): EmailContent {
  return {
    category: "welcome_1",
    subject: "What Ciciro actually does for your draft",
    preview: "Roughly one email a week, mostly about your own writing.",
    heading: "What Ciciro actually does for your draft",
    blocks: [
      {
        kind: "paragraph",
        text: "Thanks for opting in. Expect roughly one email a week from here, mostly about your own writing, plus the occasional product update. Nothing else.",
      },
      { kind: "button", label: "See what's new", href: withSource(props.changelogUrl, "welcome_1") },
    ],
    footer: "You're getting this because you opted into email from Ciciro.",
  };
}

export function welcomeStep2Template(props: { appUrl: string }): EmailContent {
  return {
    category: "welcome_2",
    subject: "Most writers start here",
    preview: "One thing worth doing before chapter one.",
    heading: "Most writers start here",
    blocks: [
      {
        kind: "paragraph",
        text: "If you haven't started a manuscript yet, that's the one thing worth doing next. Start from a blank page, or import one from Word, Google Docs, Scrivener or Markdown — Ciciro keeps your formatting.",
      },
      { kind: "button", label: "Start or import a manuscript", href: withSource(props.appUrl, "welcome_2") },
    ],
    footer: "You're getting this because you opted into email from Ciciro.",
  };
}

export function welcomeStep3Template(props: { appUrl: string }): EmailContent {
  return {
    category: "welcome_3",
    subject: "Ask Ciciro to read your latest scene",
    preview: "The AI editor reads along and suggests, it never rewrites without asking.",
    heading: "Ask Ciciro to read your latest scene",
    blocks: [
      {
        kind: "paragraph",
        text: "Open your manuscript's latest scene and ask Ciciro to check it, tighten it, or just tell you what's working. Its changes arrive as suggestions — you accept or reject every one, nothing is rewritten behind your back.",
      },
      { kind: "button", label: "Try it on your current scene", href: withSource(props.appUrl, "welcome_3") },
    ],
    footer: "You're getting this because you opted into email from Ciciro.",
  };
}

export function welcomeStep4Template(props: { appUrl: string }): EmailContent {
  return {
    category: "welcome_4",
    subject: "The story bible: worth the five minutes",
    preview: "Characters, plot and canon, so Ciciro keeps them in mind as you write.",
    heading: "The story bible: worth the five minutes",
    blocks: [
      {
        kind: "paragraph",
        text: "A few minutes filling in your story bible — main characters, the plot so far, anything Ciciro should never contradict — pays off every time you ask for a suggestion afterward.",
      },
      { kind: "button", label: "Fill in your story bible", href: withSource(props.appUrl, "welcome_4") },
    ],
    footer: "You're getting this because you opted into email from Ciciro.",
  };
}

export function allowanceNudgeTemplate(props: {
  name?: string;
  planName: string;
  percentUsed: number;
  pricingUrl: string;
  /** "Half price your first year", when early access is still open; otherwise omit. */
  earlyAccessHeadline?: string;
}): EmailContent {
  return {
    category: "allowance_nudge",
    subject: `You've used ${props.percentUsed}% of this month's free AI`,
    preview: props.earlyAccessHeadline
      ? `${props.earlyAccessHeadline} of ${props.planName}.`
      : `Upgrade to ${props.planName} for more AI every month.`,
    heading: "Getting close to this month's free AI",
    blocks: [
      ...greeting(props.name),
      {
        kind: "paragraph",
        text: `You've used ${props.percentUsed}% of this month's free AI actions. Nothing changes until you hit the limit, and it resets next month either way.`,
      },
      {
        kind: "paragraph",
        text: props.earlyAccessHeadline
          ? `${props.earlyAccessHeadline} of ${props.planName} for a lot more AI every month, while it's still open.`
          : `${props.planName} adds a lot more AI every month, if you'd rather not think about the limit.`,
      },
      { kind: "button", label: "See Ciciro Pro", href: withSource(props.pricingUrl, "allowance_nudge") },
    ],
    footer: "You're getting this because you opted into offers from Ciciro.",
  };
}

export function changelogDigestTemplate(props: {
  entries: { id: string; summary: string }[];
  changelogUrl: string;
}): EmailContent {
  return {
    category: "changelog_digest",
    subject: props.entries.length === 1 ? "What's new in Ciciro" : `${props.entries.length} things new in Ciciro`,
    preview: props.entries[0]?.summary ?? "New in Ciciro this week.",
    heading: "What's new in Ciciro",
    blocks: [
      { kind: "list", items: props.entries.map((entry) => entry.summary) },
      { kind: "button", label: "Read the full changelog", href: withSource(props.changelogUrl, "changelog_digest") },
    ],
    footer: "You're getting this because you opted into the weekly email from Ciciro.",
  };
}

// ---- Previews -------------------------------------------------------------------

export type EmailPreview = {
  id: string;
  title: string;
  group: "Account" | "Billing" | "Marketing";
  content: EmailContent;
};

/** Every template with sample data, for /dev/emails and the template tests. */
export function emailPreviews(origin: string, now = new Date()): EmailPreview[] {
  const day = 24 * 60 * 60 * 1000;
  const token = "sample-token";
  return [
    {
      id: "verify-email",
      title: "Verify your email",
      group: "Account",
      content: verifyEmailTemplate({
        name: "Ada Lovelace",
        verifyUrl: `${origin}/verify-email?token=${token}`,
        expiresInMs: 48 * 60 * 60 * 1000,
      }),
    },
    {
      id: "welcome",
      title: "Welcome",
      group: "Account",
      content: welcomeTemplate({ name: "Ada Lovelace", appUrl: `${origin}/` }),
    },
    {
      id: "password-reset",
      title: "Password reset",
      group: "Account",
      content: passwordResetTemplate({
        email: "ada@example.com",
        resetUrl: `${origin}/reset-password?token=${token}`,
        expiresInMs: 60 * 60 * 1000,
      }),
    },
    {
      id: "account-deleted",
      title: "Account deleted",
      group: "Account",
      content: accountDeletedTemplate({ name: "Ada Lovelace", email: "ada@example.com", deletedAt: now }),
    },
    {
      id: "payment-failed",
      title: "Payment failed",
      group: "Billing",
      content: paymentFailedTemplate({
        name: "Ada Lovelace",
        planName: "Ciciro Pro",
        amount: "$8.00",
        attemptedAt: now,
        nextAttemptAt: new Date(now.getTime() + 3 * day),
        updatePaymentUrl: `${origin}/settings/billing`,
      }),
    },
    {
      id: "subscription-canceled",
      title: "Subscription canceled",
      group: "Billing",
      content: subscriptionCanceledTemplate({
        name: "Ada Lovelace",
        planName: "Ciciro Pro",
        endsAt: new Date(now.getTime() + 18 * day),
        resubscribeUrl: `${origin}/settings/billing`,
      }),
    },
    {
      id: "renewal-reminder",
      title: "Renewal reminder",
      group: "Billing",
      content: renewalReminderTemplate({
        name: "Ada Lovelace",
        planName: "Ciciro Pro, yearly",
        amount: "$80.00",
        renewsAt: new Date(now.getTime() + 7 * day),
        manageUrl: `${origin}/settings/billing`,
      }),
    },
    {
      id: "welcome-1",
      title: "Welcome sequence, 1 of 4",
      group: "Marketing",
      content: withUnsubscribePreview(welcomeStep1Template({ changelogUrl: `${origin}/changelog` }), origin),
    },
    {
      id: "welcome-2",
      title: "Welcome sequence, 2 of 4",
      group: "Marketing",
      content: withUnsubscribePreview(welcomeStep2Template({ appUrl: `${origin}/` }), origin),
    },
    {
      id: "welcome-3",
      title: "Welcome sequence, 3 of 4",
      group: "Marketing",
      content: withUnsubscribePreview(welcomeStep3Template({ appUrl: `${origin}/` }), origin),
    },
    {
      id: "welcome-4",
      title: "Welcome sequence, 4 of 4",
      group: "Marketing",
      content: withUnsubscribePreview(welcomeStep4Template({ appUrl: `${origin}/` }), origin),
    },
    {
      id: "allowance-nudge",
      title: "Allowance nudge",
      group: "Marketing",
      content: withUnsubscribePreview(
        allowanceNudgeTemplate({
          name: "Ada Lovelace",
          planName: "Ciciro Pro",
          percentUsed: 80,
          pricingUrl: `${origin}/pricing`,
          earlyAccessHeadline: "Half price your first year",
        }),
        origin
      ),
    },
    {
      id: "changelog-digest",
      title: "Changelog digest",
      group: "Marketing",
      content: withUnsubscribePreview(
        changelogDigestTemplate({
          entries: [
            { id: "sample-1", summary: "Auto-draft no longer commits text cut off mid-sentence." },
            { id: "sample-2", summary: "The website has a new look: paper texture and a light/dark toggle." },
          ],
          changelogUrl: `${origin}/changelog`,
        }),
        origin
      ),
    },
  ];
}

/** Preview-only: a marketing template's real send always gets this from sendMarketingEmail. */
function withUnsubscribePreview(content: EmailContent, origin: string): EmailContent {
  return {
    ...content,
    unsubscribe: {
      manageUrl: `${origin}/email/preferences?t=sample-token`,
      unsubscribeUrl: `${origin}/api/email/unsubscribe?t=sample-token&topic=productUpdates`,
    },
  };
}
