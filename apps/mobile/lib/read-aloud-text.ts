import { htmlToDoc } from "./manuscript";

/** Chapter plain text with one paragraph per line, the same offsets the editor reports selections in. */
export function blocksPlainText(html: string): string {
  return htmlToDoc(html || "<p></p>", 0)
    .doc.blocks.map((block) => block.text)
    .join("\n");
}
