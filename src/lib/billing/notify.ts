import { PLAN_NAMES } from "@/lib/billing/config";
import { sendTemplateEmail } from "@/lib/email/account-emails";
import {
  paymentFailedTemplate,
  renewalReminderTemplate,
  subscriptionCanceledTemplate,
} from "@/lib/email/templates";

// Billing emails for web (Stripe) subscribers. The Stripe webhook calls these
// once per event (the event's idempotency claim guarantees it) and the event
// id is the Resend idempotency key, so a redelivery never sends twice. None of
// them throws: a failed send is logged and never fails the webhook. Store
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

const PLAN_NAME = PLAN_NAMES.pro;

function nameOf(user: BillingEmailRecipient): string | undefined {
  return user.name.trim() || undefined;
}

function originOf(url: string): string {
  return new URL(url).origin;
}

export async function notifyPaymentFailed(user: BillingEmailRecipient, notice: PaymentFailedNotice): Promise<void> {
  await sendTemplateEmail(
    user.email,
    paymentFailedTemplate({
      name: nameOf(user),
      planName: PLAN_NAME,
      amount: notice.amount,
      attemptedAt: notice.attemptedAt,
      nextAttemptAt: notice.nextAttemptAt ?? undefined,
      updatePaymentUrl: notice.updatePaymentUrl,
    }),
    originOf(notice.updatePaymentUrl),
    `billing/${notice.eventId}`
  );
}

export async function notifySubscriptionCanceled(
  user: BillingEmailRecipient,
  notice: SubscriptionCanceledNotice
): Promise<void> {
  await sendTemplateEmail(
    user.email,
    subscriptionCanceledTemplate({
      name: nameOf(user),
      planName: PLAN_NAME,
      endsAt: notice.endsAt,
      resubscribeUrl: notice.resubscribeUrl,
    }),
    originOf(notice.resubscribeUrl),
    `billing/${notice.eventId}`
  );
}

export async function notifyRenewalReminder(user: BillingEmailRecipient, notice: RenewalReminderNotice): Promise<void> {
  await sendTemplateEmail(
    user.email,
    renewalReminderTemplate({
      name: nameOf(user),
      planName: PLAN_NAME,
      amount: notice.amount,
      renewsAt: notice.renewsAt,
      manageUrl: notice.manageUrl,
    }),
    originOf(notice.manageUrl),
    `billing/${notice.eventId}`
  );
}
