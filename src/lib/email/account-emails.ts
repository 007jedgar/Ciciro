import { sendEmail, type SendEmailResult } from "@/lib/email";
import type { EmailContent } from "@/lib/email/content";
import { renderEmail } from "@/lib/email/render";
import {
  accountDeletedTemplate,
  passwordResetTemplate,
  verifyEmailTemplate,
  welcomeTemplate,
} from "@/lib/email/templates";

// The account emails, one function per send point. None of them throws: an
// email that fails to go out is logged by sendEmail and never fails the
// signup, reset or deletion that triggered it.

type Recipient = { id: string; email: string; name?: string };

async function send(
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
  return send(
    user.email,
    verifyEmailTemplate({ name: user.name, verifyUrl, expiresInMs: link.expiresInMs }),
    origin,
    `verify-email/${link.tokenId}`
  );
}

export function sendWelcomeEmail(user: Recipient, origin: string): Promise<SendEmailResult> {
  return send(user.email, welcomeTemplate({ name: user.name, appUrl: `${origin}/` }), origin, `welcome/${user.id}`);
}

export function sendPasswordResetEmail(
  user: Recipient,
  link: { tokenId: string; token: string; expiresInMs: number },
  origin: string
): Promise<SendEmailResult> {
  const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(link.token)}`;
  return send(
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
  return send(
    account.email,
    accountDeletedTemplate({ name: account.name, email: account.email, deletedAt }),
    origin,
    `account-deleted/${account.id}`
  );
}
