// What an email says, independent of how it is drawn. Every template returns
// one of these; layout.tsx turns it into HTML and plainText() into the text
// part, so the two can never say different things.

export type EmailBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "button"; label: string; href: string }
  /** "If the button does not work, paste this link": the raw URL, for clients that mangle buttons. */
  | { kind: "fallback-link"; href: string }
  /** Label and value rows, for dates and amounts. */
  | { kind: "details"; rows: { label: string; value: string }[] }
  /** Smaller, quieter text under the main message. */
  | { kind: "note"; text: string };

export type EmailContent = {
  /** Sent to Resend as the `category` tag, so sends can be told apart in its dashboard. */
  category: string;
  subject: string;
  /** The inbox preview line shown after the subject. */
  preview: string;
  heading: string;
  blocks: EmailBlock[];
  /** Why the recipient is getting this email. */
  footer: string;
};

export const FALLBACK_LINK_LABEL = "If the button doesn't work, paste this link into your browser:";

function textBlock(block: EmailBlock): string {
  switch (block.kind) {
    case "paragraph":
    case "note":
      return block.text;
    case "list":
      return block.items.map((item) => `- ${item}`).join("\n");
    case "button":
      return `${block.label}: ${block.href}`;
    case "fallback-link":
      // The button line already carries the URL in plain text.
      return "";
    case "details":
      return block.rows.map((row) => `${row.label}: ${row.value}`).join("\n");
  }
}

/** The text/plain part of an email. */
export function plainText(content: EmailContent, origin: string): string {
  const parts = [
    "Ciciro",
    content.heading,
    ...content.blocks.map(textBlock).filter(Boolean),
    `--\n${content.footer}\nCiciro${origin ? ` · ${origin}` : ""}`,
  ];
  return `${parts.join("\n\n")}\n`;
}
