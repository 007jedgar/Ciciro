import { scriptBlocksToHtml } from "../fountain";
import { scriptFromFdx } from "../fdx";
import type { ImportedManuscript } from "./blocks";

/**
 * The text of an FDX file's bytes: UTF-8, or UTF-16 when a byte-order mark says
 * so (some tools write it). The XML declaration's own encoding is not consulted.
 */
export function decodeFdx(data: Uint8Array): string {
  if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data);
  if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data);
  return new TextDecoder("utf-8").decode(data);
}

/**
 * An FDX script (.fdx) as a screenplay: a single sequence, since FDX has no
 * sections. The title page comes with it (title, credit, author, source, draft
 * date and contact, sorted by `scriptFromFdx`) and whether the scenes were
 * numbered; dual dialogue and centered text keep their elements.
 */
export function parseFdx(source: string, fallbackTitle = ""): ImportedManuscript {
  const script = scriptFromFdx(source);
  const blocks = script.sequences.flatMap((s) => s.blocks);
  const chapters = blocks.length > 0 ? [{ title: "", html: scriptBlocksToHtml(blocks) }] : [];
  return {
    title: script.title || fallbackTitle,
    chapters,
    kind: "screenplay",
    author: script.author || undefined,
    script: { titlePage: script.titlePage, sceneNumbers: script.sceneNumbers },
  };
}
