import { prisma } from "@/lib/db";
import { deletePushTokens } from "@/lib/push/tokens";

// Sends through the Expo Push API (https://docs.expo.dev/push-notifications/sending-notifications/),
// which hands off to APNs and FCM with the credentials EAS holds for the app.
// Plain fetch, like src/lib/email/index.ts, rather than expo-server-sdk.
//
// Delivery is two steps. The send returns a ticket per message: an error
// ticket can already say the phone is gone. An ok ticket is stored as a
// PushTicket, and its receipt (ready within 15 minutes, kept for a day) says
// whether Apple or Google took it. checkPushReceipts reads the due receipts;
// every send runs it first, so bookkeeping keeps up without a cron. A
// DeviceNotRegistered answer at either step deletes the token.

export const EXPO_PUSH_SEND_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_PUSH_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

/** Expo's limits: 100 messages per send request, 1000 ids per receipts request. */
const SEND_BATCH = 100;
const RECEIPT_BATCH = 1000;
/** Receipts are usually ready sooner; Expo asks for a 15-minute wait. */
export const RECEIPT_DELAY_MS = 15 * 60 * 1000;
/** Expo drops receipts after a day, so a ticket older than this never gets one. */
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

export type PushMessage = {
  title: string;
  body: string;
  /** Delivered to the app with the notification. Up to about 4 KiB. */
  data?: Record<string, unknown>;
  /** Android notification channel; the app creates it before it is used. */
  channelId?: string;
};

export type PushOptions = {
  fetch?: typeof fetch;
  now?: Date;
  /** Backoff between retries of a throttled or failed request. */
  sleep?: (ms: number) => Promise<void>;
};

export type PushSendResult = {
  /** Expo accepted these (an ok ticket); delivery is confirmed by the receipt. */
  accepted: number;
  failed: number;
  /** Tokens deleted because the phone no longer takes notifications. */
  removed: number;
};

type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message?: string; details?: { error?: string } };

type ExpoReceipt = { status: "ok" } | { status: "error"; message?: string; details?: { error?: string } };

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function headers(): Record<string, string> {
  const out: Record<string, string> = {
    accept: "application/json",
    "accept-encoding": "gzip, deflate",
    "content-type": "application/json",
  };
  // Required once "enhanced push security" is on for the EAS project.
  const token = readEnv("EXPO_ACCESS_TOKEN");
  if (token) out.authorization = `Bearer ${token}`;
  return out;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * POST to Expo, retrying a 429, a 5xx or a network failure with exponential
 * backoff. Returns the parsed `data`, or throws once retries run out or on a
 * request Expo rejected outright (bad payload, missing credentials).
 */
async function postExpo<T>(url: string, body: unknown, options: PushOptions): Promise<T> {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await doFetch(url, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    } catch (error) {
      lastError = error;
      continue;
    }
    const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: unknown };
    if (res.ok && json.data !== undefined) return json.data;
    lastError = new Error(`Expo push ${res.status}: ${JSON.stringify(json.errors ?? json)}`);
    if (res.status !== 429 && res.status < 500) break;
  }
  throw lastError;
}

function errorCode(item: { details?: { error?: string } }): string | undefined {
  return item.details?.error;
}

/**
 * Send one notification to every phone the account registered. Never throws:
 * a notification is never worth failing the request that triggered it, so
 * failures are logged and counted instead.
 */
export async function sendPushToUser(
  userId: string,
  message: PushMessage,
  options: PushOptions = {}
): Promise<PushSendResult> {
  const result: PushSendResult = { accepted: 0, failed: 0, removed: 0 };
  await checkPushReceipts(options).catch((error) => {
    console.error("push: receipt check failed", error);
  });

  let tokens: { id: string; token: string }[];
  try {
    tokens = await prisma.pushToken.findMany({
      where: { userId },
      select: { id: true, token: true },
      orderBy: { id: "asc" },
    });
  } catch (error) {
    console.error("push: could not read push tokens", error);
    return result;
  }

  for (const batch of chunks(tokens, SEND_BATCH)) {
    const messages = batch.map((row) => ({
      to: row.token,
      title: message.title,
      body: message.body,
      sound: "default",
      ...(message.data ? { data: message.data } : {}),
      ...(message.channelId ? { channelId: message.channelId } : {}),
    }));
    let tickets: ExpoTicket[];
    try {
      tickets = await postExpo<ExpoTicket[]>(EXPO_PUSH_SEND_URL, messages, options);
    } catch (error) {
      console.error("push: send failed", error);
      result.failed += batch.length;
      continue;
    }

    const gone: string[] = [];
    const accepted: { id: string; pushTokenId: string }[] = [];
    batch.forEach((row, index) => {
      const ticket = tickets[index];
      if (ticket?.status === "ok") {
        accepted.push({ id: ticket.id, pushTokenId: row.id });
        return;
      }
      result.failed += 1;
      if (ticket && errorCode(ticket) === "DeviceNotRegistered") gone.push(row.id);
      else console.error("push: ticket error", ticket?.message ?? "no ticket", errorCode(ticket ?? {}));
    });
    result.accepted += accepted.length;
    try {
      if (accepted.length) await prisma.pushTicket.createMany({ data: accepted });
      await deletePushTokens(gone);
      result.removed += gone.length;
    } catch (error) {
      console.error("push: could not record tickets", error);
    }
  }
  return result;
}

export type ReceiptCheckResult = {
  /** Tickets settled: a receipt came back, or it is too old to ever come. */
  settled: number;
  /** Tokens deleted because Apple or Google said the phone is gone. */
  removed: number;
};

/**
 * Read the receipts that are due (15 minutes after the send), drop tokens
 * whose phone is gone, and forget settled tickets. A ticket still without a
 * receipt is kept for a later check until Expo would have dropped it.
 */
export async function checkPushReceipts(options: PushOptions = {}): Promise<ReceiptCheckResult> {
  const now = (options.now ?? new Date()).getTime();
  const due = await prisma.pushTicket.findMany({
    where: { createdAt: { lte: new Date(now - RECEIPT_DELAY_MS) } },
    orderBy: { createdAt: "asc" },
    take: RECEIPT_BATCH,
    select: { id: true, pushTokenId: true, createdAt: true },
  });
  const result: ReceiptCheckResult = { settled: 0, removed: 0 };
  if (!due.length) return result;

  const receipts = await postExpo<Record<string, ExpoReceipt>>(
    EXPO_PUSH_RECEIPTS_URL,
    { ids: due.map((ticket) => ticket.id) },
    options
  );
  const settled: string[] = [];
  const gone = new Set<string>();
  for (const ticket of due) {
    const receipt = receipts[ticket.id];
    if (!receipt) {
      if (now - ticket.createdAt.getTime() > RECEIPT_TTL_MS) settled.push(ticket.id);
      continue;
    }
    settled.push(ticket.id);
    if (receipt.status === "ok") continue;
    if (errorCode(receipt) === "DeviceNotRegistered") gone.add(ticket.pushTokenId);
    else console.error("push: receipt error", receipt.message, errorCode(receipt));
  }
  await prisma.pushTicket.deleteMany({ where: { id: { in: settled } } });
  await deletePushTokens([...gone]);
  return { settled: settled.length, removed: gone.size };
}
