// Small text helpers shared between server and client.

// Strip HTML tags to plain text. Block tags become newlines so paragraphs survive.
export function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

// Pull prose out of the assistant's <draft>...</draft> block, if present.
export function extractDraft(reply: string): string | null {
  const match = reply.match(/<draft>([\s\S]*?)<\/draft>/i);
  return match ? match[1].trim() : null;
}
