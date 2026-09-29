import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

// Webhook idempotency. Stripe and RevenueCat both deliver at least once, so
// each event is claimed by inserting its id before it is handled: a second
// delivery hits the unique index and is acknowledged without running again.
// A handler that fails releases its claim so the sender's retry runs it.

export type BillingEventSource = "stripe" | "revenuecat";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Claim an event. False when it was already claimed (a redelivery). */
export async function claimBillingEvent(
  source: BillingEventSource,
  eventId: string,
  type: string
): Promise<boolean> {
  try {
    await prisma.billingEvent.create({ data: { source, eventId, type: type.slice(0, 100) } });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

/** Record which account a claimed event belonged to (purged and exported with it). */
export async function attributeBillingEvent(
  source: BillingEventSource,
  eventId: string,
  userId: string
): Promise<void> {
  await prisma.billingEvent.updateMany({ where: { source, eventId }, data: { userId } });
}

/** Give up a claim after the handler failed, so the retry is not skipped. */
export async function releaseBillingEvent(source: BillingEventSource, eventId: string): Promise<void> {
  await prisma.billingEvent.deleteMany({ where: { source, eventId } });
}

/** Run `handle` once per event id; redeliveries return "duplicate". */
export async function handleOnce(
  source: BillingEventSource,
  eventId: string,
  type: string,
  handle: () => Promise<void>
): Promise<"handled" | "duplicate"> {
  if (!(await claimBillingEvent(source, eventId, type))) return "duplicate";
  try {
    await handle();
  } catch (error) {
    await releaseBillingEvent(source, eventId).catch(() => {});
    throw error;
  }
  return "handled";
}
