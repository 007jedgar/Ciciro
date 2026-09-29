// Sends transactional email through Resend's HTTP API. Plain fetch, not the
// resend SDK, to match how the rest of src/lib talks to third-party HTTP APIs
// on Workers (see src/lib/fast-lane.ts) and to avoid a dependency of unclear
// workerd compatibility for a single POST.

import { authRequired } from "@/lib/auth/constants";

const RESEND_API_URL = "https://api.resend.com/emails";

// Bracket access so Next.js cannot replace these with empty strings from the
// Workers CI build environment. The hosted Worker copies secrets onto
// process.env per request in src/worker/index.ts.
function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function hasResendKey(): boolean {
  return Boolean(readEnv("RESEND_API_KEY"));
}

export interface EmailTag {
  name: string;
  value: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  tags?: EmailTag[];
  idempotencyKey?: string;
  replyTo?: string;
  /** Rethrow instead of returning a failed result. Default: false. */
  throwOnError?: boolean;
}

export interface SendEmailError {
  message: string;
  code?: string;
}

export interface SendEmailResult {
  sent: boolean;
  id?: string;
  error?: SendEmailError;
}

function fail(message: string, code: string | undefined, throwOnError: boolean | undefined): SendEmailResult {
  console.error(`[email] Resend send failed${code ? ` (${code})` : ""}: ${message}`);
  if (throwOnError) throw new Error(message);
  return { sent: false, error: { message, code } };
}

function maskAddress(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return "***";
  return `${address[0]}***${address.slice(at)}`;
}

function maskRecipients(to: string | string[]): string[] {
  return (Array.isArray(to) ? to : [to]).map(maskAddress);
}

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const apiKey = readEnv("RESEND_API_KEY");
  if (!apiKey) {
    const message = "RESEND_API_KEY is not configured";
    if (options.throwOnError) return fail(message, undefined, true);
    const detail = { to: maskRecipients(options.to), subject: options.subject, tags: options.tags };
    if (authRequired()) {
      console.error(`[email] ${message}; email not sent:`, detail);
    } else {
      console.log(`[email] ${message}; logging instead of sending:`, detail);
    }
    return { sent: false };
  }

  const from = readEnv("EMAIL_FROM");
  if (!from) {
    return fail("EMAIL_FROM is not configured", undefined, options.throwOnError);
  }

  const replyTo = options.replyTo ?? readEnv("EMAIL_REPLY_TO");

  const body: Record<string, unknown> = {
    from,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  };
  if (replyTo) body.reply_to = replyTo;
  if (options.tags?.length) body.tags = options.tags;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(RESEND_API_URL, { method: "POST", headers, body: JSON.stringify(body) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error sending email";
    return fail(message, undefined, options.throwOnError);
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { message?: string; name?: string } | null;
    const message = payload?.message ?? `Resend request failed with status ${res.status}`;
    return fail(message, payload?.name, options.throwOnError);
  }

  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { sent: true, id: data.id };
}
