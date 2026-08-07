// Self-healing helpers for chat content that was cut off mid-stream or mid-tag.

const DRAFT_OPEN = "<draft>";
const DRAFT_CLOSE = "</draft>";

/** True when content has an unclosed <draft> (or other obvious truncation). */
export function hasOpenDraft(content: string): boolean {
  let depth = 0;
  let i = 0;
  while (i < content.length) {
    const open = content.indexOf(DRAFT_OPEN, i);
    const close = content.indexOf(DRAFT_CLOSE, i);
    if (open === -1 && close === -1) break;
    if (open !== -1 && (close === -1 || open < close)) {
      depth++;
      i = open + DRAFT_OPEN.length;
    } else if (close !== -1) {
      depth = Math.max(0, depth - 1);
      i = close + DRAFT_CLOSE.length;
    } else {
      break;
    }
  }
  return depth > 0;
}

/**
 * Close any unclosed <draft> tags so a truncated reply can be inserted/copied
 * instead of showing "writing..." forever once it is no longer live.
 */
export function closeOpenDrafts(content: string): string {
  if (!content || !hasOpenDraft(content)) return content;
  return content + DRAFT_CLOSE;
}

/**
 * Strip a trailing Ciciro error footer so a resume turn doesn't feed the
 * failure text back into the model as prose to continue from.
 */
export function stripErrorFooter(content: string): string {
  return content.replace(/\n\n\[Ciciro error:[\s\S]*$/, "").trimEnd();
}

/**
 * Prepare persisted assistant text: drop error footers, close dangling drafts
 * when the turn is finished (not when we still intend to resume).
 */
export function healAssistantContent(
  content: string,
  opts: { closeDrafts?: boolean } = {}
): string {
  let out = stripErrorFooter(content);
  if (opts.closeDrafts) out = closeOpenDrafts(out);
  return out;
}

/** User-facing continue prompt when a stream died mid-reply. */
export function continuePrompt(partial: string): string {
  const healed = stripErrorFooter(partial);
  return (
    "Your previous reply was interrupted by a connection drop. Continue exactly " +
    "where you left off - mid-word or mid-<draft> if that is where it cut off. " +
    "Do not repeat or restate anything already written, and do not comment on " +
    "the interruption.\n\n" +
    `<already_written>\n${healed}\n</already_written>`
  );
}
