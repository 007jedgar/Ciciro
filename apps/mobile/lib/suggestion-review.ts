import { htmlToDoc } from "./manuscript";
import { hasSuggestions, type SuggestionAction, type SuggestionPiece, type SuggestionSummary } from "./suggestions";

// Small pure helpers behind the phone's suggestion review sheet.

export type SuggestionAge =
  | { key: "justNow" }
  | { key: "minutesAgo" | "hoursAgo" | "daysAgo"; count: number }
  | null;

/** How long ago a suggestion was made, as an i18n key and count. */
export function suggestionAge(createdAt: string, now = Date.now()): SuggestionAge {
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return { key: "justNow" };
  if (minutes < 60) return { key: "minutesAgo", count: minutes };
  const hours = Math.round(minutes / 60);
  if (hours < 24) return { key: "hoursAgo", count: hours };
  return { key: "daysAgo", count: Math.round(hours / 24) };
}

/** "Ciciro, Mara Quill": who has changes waiting, in the order they appear. */
export function suggestionAuthors(list: readonly SuggestionSummary[], someone: string): string {
  return [...new Set(list.map((s) => s.authorName.trim() || someone))].join(", ");
}

/**
 * Whether a paragraph holds a pending suggestion. The grammar pass rewrites a
 * paragraph from its plain text, which would turn a pending deletion into
 * permanent strikethrough, so it leaves these paragraphs alone.
 */
export function blockHasSuggestions(html: string, blockId: string): boolean {
  if (!hasSuggestions(html)) return false;
  const block = htmlToDoc(html, 0).doc.blocks.find((b) => b.id === blockId);
  return block ? hasSuggestions(block.html) : false;
}

export function clipText(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The inserted text flashes over this long before it settles into the prose. */
export const FLASH_MS = 400;
/** The text being removed shrinks away over this long. */
export const COLLAPSE_MS = 160;

export type ResolvingPiece = {
  text: string;
  /** What the piece was in the proposal, for its colour while it still shows as one. */
  kind: SuggestionPiece["kind"];
  /** `kept` text stays and flashes; `collapsing` text is on its way out. */
  role: "context" | "kept" | "collapsing";
  /** 1 at the start of the flash, easing to 0 as it settles. */
  flash: number;
};

/**
 * One suggestion mid-decision. Accepting keeps the inserted words (they flash
 * in the draft tint, then settle) and shrinks the struck words away; rejecting
 * is the mirror image. `elapsedMs` is time since the writer tapped, so the
 * card can draw any frame of it from the clock alone.
 */
export function resolvingPieces(
  pieces: readonly SuggestionPiece[],
  action: SuggestionAction,
  elapsedMs: number
): ResolvingPiece[] {
  const kept: SuggestionPiece["kind"] = action === "accept" ? "insert" : "delete";
  const flash = 1 - Math.min(1, Math.max(0, elapsedMs) / FLASH_MS);
  const remaining = 1 - Math.min(1, Math.max(0, elapsedMs) / COLLAPSE_MS);
  return pieces.map((piece) => {
    if (piece.kind === "context") return { text: piece.text, kind: piece.kind, role: "context", flash: 0 };
    if (piece.kind === kept) return { text: piece.text, kind: piece.kind, role: "kept", flash };
    // Trim characters off the end: the words draw in from the right, which reads as a horizontal collapse.
    const chars = [...piece.text];
    const text = chars.slice(0, Math.ceil(chars.length * remaining)).join("");
    return { text, kind: piece.kind, role: "collapsing", flash: 0 };
  });
}
