import { PLAN_NAMES } from "@/lib/billing/config";
import { sendEmail, type SendEmailResult } from "@/lib/email";
import type { EmailContent } from "@/lib/email/content";
import { renderEmail } from "@/lib/email/render";
import {
  accountDeletedTemplate,
  passwordResetTemplate,
  paymentFailedTemplate,
  renewalReminderTemplate,
  subscriptionCanceledTemplate,
  verifyEmailTemplate,
  welcomeTemplate,
} from "@/lib/email/templates";

// The account emails, one function per send point. None of them throws: an
// email that fails to go out is logged by sendEmail and never fails the
// signup, reset or deletion that triggered it.

type Recipient = { id: string; email: string; name?: string };

/** Render a template and send it once: Resend drops a repeat of the same key. */
export async function sendTemplateEmail(
  to: string,
  content: EmailContent,
  origin: string,
  idempotencyKey: string
): Promise<SendEmailResult> {
  let rendered;
  try {
    rendered = await renderEmail(content, origin);
  } catch (error) {
    console.error(`[email] could not render ${content.category}`, error);
    return { sent: false, error: { message: "Could not render email" } };
  }
  return sendEmail({
    to,
    ...rendered,
    tags: [{ name: "category", value: content.category }],
    // Resend drops a repeat of the same key within 24 hours, so a retried
    // request cannot send the same email twice.
    idempotencyKey,
  });
}

export function sendVerifyEmail(
  user: Recipient,
  link: { tokenId: string; token: string; expiresInMs: number },
  origin: string
): Promise<SendEmailResult> {
  const verifyUrl = `${origin}/verify-email?token=${encodeURIComponent(link.token)}`;
  return sendTemplateEmail(
    user.email,
    verifyEmailTemplate({ name: user.name, verifyUrl, expiresInMs: link.expiresInMs }),
    origin,
    `verify-email/${link.tokenId}`
  );
}

export function sendWelcomeEmail(user: Recipient, origin: string): Promise<SendEmailResult> {
  return sendTemplateEmail(user.email, welcomeTemplate({ name: user.name, appUrl: `${origin}/` }), origin, `welcome/${user.id}`);
}

export function sendPasswordResetEmail(
  user: Recipient,
  link: { tokenId: string; token: string; expiresInMs: number },
  origin: string
): Promise<SendEmailResult> {
  const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(link.token)}`;
  return sendTemplateEmail(
    user.email,
    passwordResetTemplate({ email: user.email, resetUrl, expiresInMs: link.expiresInMs }),
    origin,
    `password-reset/${link.tokenId}`
  );
}

export function sendAccountDeletedEmail(
  account: Recipient,
  origin: string,
  deletedAt = new Date()
): Promise<SendEmailResult> {
  return sendTemplateEmail(
    account.email,
    accountDeletedTemplate({ name: account.name, email: account.email, deletedAt }),
    origin,
    `account-deleted/${account.id}`
  );
}

// Billing emails for web (Stripe) subscribers. The Stripe webhook sends these
// once per event (the event's idempotency claim guarantees it) and the event
// id is the Resend idempotency key, so a redelivery never sends twice. Store
// subscribers get these from Apple or Google, not from Ciciro.

export type BillingEmailRecipient = { id: string; email: string; name: string };

export type PaymentFailedNotice = {
  eventId: string;
  /** Formatted with its currency, e.g. "$12". */
  amount: string;
  attemptedAt: Date;
  /** When Stripe will try the card again, if it will. */
  nextAttemptAt: Date | null;
  /** Where to fix the card: the pricing page's Manage billing opens the Customer Portal. */
  updatePaymentUrl: string;
};

export type SubscriptionCanceledNotice = {
  eventId: string;
  /** When paid access ends: the end of the period, or now for an immediate cancel. */
  endsAt: Date;
  resubscribeUrl: string;
};

export type RenewalReminderNotice = {
  eventId: string;
  amount: string;
  renewsAt: Date;
  manageUrl: string;
};

const BILLING_PLAN_NAME = PLAN_NAMES.pro;

function billingNameOf(user: BillingEmailRecipient): string | undefined {
  return user.name.trim() || undefined;
}

export function sendPaymentFailedEmail(
  user: BillingEmailRecipient,
  notice: PaymentFailedNotice
): Promise<SendEmailResult> {
  return sendTemplateEmail(
    user.email,
    paymentFailedTemplate({
      name: billingNameOf(user),
      planName: BILLING_PLAN_NAME,
      amount: notice.amount,
      attemptedAt: notice.attemptedAt,
      nextAttemptAt: notice.nextAttemptAt ?? undefined,
      updatePaymentUrl: notice.updatePaymentUrl,
    }),
    new URL(notice.updatePaymentUrl).origin,
    `billing/${notice.eventId}`
  );
}

export function sendSubscriptionCanceledEmail(
  user: BillingEmailRecipient,
  notice: SubscriptionCanceledNotice
): Promise<SendEmailResult> {
  return sendTemplateEmail(
    user.email,
    subscriptionCanceledTemplate({
      name: billingNameOf(user),
      planName: BILLING_PLAN_NAME,
      endsAt: notice.endsAt,
      resubscribeUrl: notice.resubscribeUrl,
    }),
    new URL(notice.resubscribeUrl).origin,
    `billing/${notice.eventId}`
  );
}

export function sendRenewalReminderEmail(
  user: BillingEmailRecipient,
  notice: RenewalReminderNotice
): Promise<SendEmailResult> {
  return sendTemplateEmail(
    user.email,
    renewalReminderTemplate({
      name: billingNameOf(user),
      planName: BILLING_PLAN_NAME,
      amount: notice.amount,
      renewsAt: notice.renewsAt,
      manageUrl: notice.manageUrl,
    }),
    new URL(notice.manageUrl).origin,
    `billing/${notice.eventId}`
  );
}
