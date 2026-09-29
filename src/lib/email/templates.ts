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

// ---- Account ----------------------------------------------------------------

export function verifyEmailTemplate(props: {
  name?: string;
  verifyUrl: string;
  /** How long the link works, in ms. */
  expiresInMs: number;
}): EmailContent {
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
      { kind: "button", label: "Confirm my email", href: props.verifyUrl },
      { kind: "fallback-link", href: props.verifyUrl },
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
      { kind: "button", label: "Open Ciciro", href: props.appUrl },
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
      { kind: "button", label: "Choose a new password", href: props.resetUrl },
      { kind: "fallback-link", href: props.resetUrl },
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
      { kind: "button", label: "Update payment details", href: props.updatePaymentUrl },
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
      { kind: "button", label: "Resubscribe", href: props.resubscribeUrl },
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
      { kind: "button", label: "Manage subscription", href: props.manageUrl },
      {
        kind: "note",
        text: `There's nothing to do if you're staying. To cancel or change plans, do it before ${date} and you won't be charged.`,
      },
    ],
    footer: "You're getting this because you have a Ciciro subscription billed to this address.",
  };
}

// ---- Previews -------------------------------------------------------------------

export type EmailPreview = { id: string; title: string; group: "Account" | "Billing"; content: EmailContent };

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
  ];
}
