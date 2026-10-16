/** Strip TipTap HTML to readable plain text. Not an editor. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    // Numeric entities (&#241;, &#xF1;) before "&amp;", so an escaped "&amp;#241;" stays literal text.
    // Android's native editor writes every non-ASCII letter this way.
    .replace(/&#x([0-9a-f]+);/gi, (m, hex: string) => codePointText(parseInt(hex, 16), m))
    .replace(/&#(\d+);/g, (m, dec: string) => codePointText(parseInt(dec, 10), m))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The character for a numeric entity's code point, or the entity itself when it is not a character. */
function codePointText(code: number, entity: string): string {
  return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
}

/** True when TipTap HTML has no prose (empty `<p></p>` counts as empty). */
export function isChapterEmpty(content: string | null | undefined): boolean {
  return htmlToPlainText(content ?? "") === "";
}
