import { createElement } from "react";
import { plainText, type EmailContent } from "@/lib/email/content";
import { EmailLayout } from "@/lib/email/layout";

export type RenderedEmail = { subject: string; html: string; text: string };

/**
 * Render an email to the HTML and plain-text parts Resend takes. `origin` is
 * the public origin (see publicOrigin), used for the logo and footer link.
 */
export async function renderEmail(content: EmailContent, origin: string): Promise<RenderedEmail> {
  // Imported on use, like React Email's own render: Next refuses a static
  // react-dom/server import anywhere a Server Component can reach.
  const { renderToStaticMarkup } = await import("react-dom/server");
  const markup = renderToStaticMarkup(createElement(EmailLayout, { content, origin }));
  return {
    subject: content.subject,
    html: `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">${markup}`,
    text: plainText(content, origin),
  };
}
