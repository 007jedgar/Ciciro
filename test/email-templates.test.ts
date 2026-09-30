import { describe, expect, it } from "vitest";
import { renderEmail } from "@/lib/email/render";
import { plainText, type EmailContent } from "@/lib/email/content";
import { emailPreviews, verifyEmailTemplate, welcomeTemplate } from "@/lib/email/templates";

const ORIGIN = "https://ciciro.test";

function textsOf(content: EmailContent): string[] {
  return content.blocks.flatMap((block) => {
    switch (block.kind) {
      case "paragraph":
      case "note":
        return [block.text];
      case "list":
        return block.items;
      case "button":
        return [block.label];
      case "details":
        return block.rows.flatMap((row) => [row.label, row.value]);
      case "fallback-link":
        return [];
    }
  });
}

function decode(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

describe("email templates", () => {
  const previews = emailPreviews(ORIGIN, new Date("2026-10-01T12:00:00Z"));

  it("covers the account, billing and marketing emails", () => {
    expect(previews.map((p) => p.id)).toEqual([
      "verify-email",
      "welcome",
      "password-reset",
      "account-deleted",
      "payment-failed",
      "subscription-canceled",
      "renewal-reminder",
      "welcome-1",
      "welcome-2",
      "welcome-3",
      "welcome-4",
      "allowance-nudge",
      "changelog-digest",
    ]);
  });

  for (const preview of emailPreviews(ORIGIN, new Date("2026-10-01T12:00:00Z"))) {
    it(`${preview.id} renders the same message as HTML and plain text`, async () => {
      const { subject, html, text } = await renderEmail(preview.content, ORIGIN);
      expect(subject).toBe(preview.content.subject);
      expect(html.startsWith("<!DOCTYPE html")).toBe(true);
      const readable = decode(html);
      expect(readable).toContain(`<title>${preview.content.subject}</title>`);
      expect(readable).toContain(preview.content.preview);
      expect(readable).toContain(preview.content.heading);
      expect(readable).toContain(preview.content.footer);
      expect(text).toContain(preview.content.heading);
      expect(text).toContain(preview.content.footer);
      expect(text).not.toMatch(/<[a-z]/i);
      for (const line of textsOf(preview.content)) {
        expect(readable, `HTML is missing "${line}"`).toContain(line);
        expect(text, `text is missing "${line}"`).toContain(line);
      }
      for (const block of preview.content.blocks) {
        if (block.kind === "button") {
          expect(readable).toContain(`href="${block.href}"`);
          expect(text).toContain(block.href);
        }
      }
    });
  }

  it("uses the brand mark from the public origin, with a dark-mode swap", async () => {
    const { html } = await renderEmail(welcomeTemplate({ appUrl: `${ORIGIN}/` }), ORIGIN);
    expect(html).toContain(`src="${ORIGIN}/brand/email-mark-warm.png"`);
    expect(html).toContain(`src="${ORIGIN}/brand/email-mark-ink.png"`);
    expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
  });

  it("escapes what an author typed", async () => {
    const content = verifyEmailTemplate({
      name: "<img src=x onerror=alert(1)>",
      verifyUrl: `${ORIGIN}/verify-email?token=t`,
      expiresInMs: 48 * 60 * 60 * 1000,
    });
    const { html } = await renderEmail(content, ORIGIN);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("Hi &lt;img");
  });

  it("greets by first name, and not at all without one", () => {
    const named = welcomeTemplate({ name: "  Ada Lovelace ", appUrl: "/" });
    expect(named.blocks[0]).toEqual({ kind: "paragraph", text: "Hi Ada," });
    const anonymous = welcomeTemplate({ appUrl: "/" });
    expect(anonymous.blocks[0]).toEqual({ kind: "paragraph", text: "Your account is ready. A few good places to start:" });
  });

  it("states how long a link works", () => {
    const text = plainText(
      verifyEmailTemplate({ verifyUrl: "https://x/v", expiresInMs: 48 * 60 * 60 * 1000 }),
      ORIGIN
    );
    expect(text).toContain("The link works for 48 hours.");
    expect(text).toContain("Confirm my email: https://x/v");
  });
});
