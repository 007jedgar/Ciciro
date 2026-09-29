// Billing emails. The webhook handlers call these once per event (the event's
// idempotency claim guarantees it), passing the event id so the email send is
// idempotent at Resend too.
//
// HOOK POINT: the payment-failed and subscription-canceled templates come from
// the email-templates work. Until they land these only log; wire each one to
// its template with sendEmail from @/lib/email, using `idempotencyKey`.
// Store subscribers get these emails from Apple or Google, not from Ciciro.

export type BillingEmailRecipient = { id: string; email: string; name: string };

export type PaymentFailedNotice = {
  eventId: string;
  /** Where to fix the card: the Stripe Customer Portal, via Settings. */
  manageUrl: string;
};

export type SubscriptionCanceledNotice = {
  eventId: string;
  /** When access ended, or ends. */
  endedAt: Date | null;
  /** Where to subscribe again. */
  resubscribeUrl: string;
};

export async function notifyPaymentFailed(
  user: BillingEmailRecipient,
  notice: PaymentFailedNotice
): Promise<void> {
  console.log(`[billing] payment failed for ${user.id} (${notice.eventId}); email template not wired yet`);
}

export async function notifySubscriptionCanceled(
  user: BillingEmailRecipient,
  notice: SubscriptionCanceledNotice
): Promise<void> {
  console.log(`[billing] subscription canceled for ${user.id} (${notice.eventId}); email template not wired yet`);
}
