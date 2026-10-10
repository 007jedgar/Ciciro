import { scriptBlocksToHtml, scriptFromFountain } from "../fountain";
import type { ImportedManuscript } from "./blocks";

/**
 * A Fountain script (.fountain) as a screenplay: one sequence per `#` section
 * (the shallowest depth in the file), or a single sequence when there are none.
 * The title block's title and author come with it; notes, the boneyard and the
 * rest of the title page do not (src/lib/fountain.ts).
 */
export function parseFountain(source: string, fallbackTitle = ""): ImportedManuscript {
  const script = scriptFromFountain(source);
  const written = script.sequences.filter((s) => s.blocks.length > 0);
  // An empty section stays when it is the only thing there is to say; a script with no lines is not one.
  const chapters = written.map((s) => ({ title: s.title, html: scriptBlocksToHtml(s.blocks) }));
  return { title: script.title || fallbackTitle, chapters, kind: "screenplay", author: script.author || undefined };
}
