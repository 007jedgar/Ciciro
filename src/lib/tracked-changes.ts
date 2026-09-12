// Word-level tracked changes that round-trip in chapter HTML as <ins>/<del>
// marks. Accept/reject rewrites HTML so the existing chapter PATCH → ops
// path persists them without a separate CRDT.

import { diffWords } from "diff";

export type SuggestionKind = "insert" | "delete";
export type SuggestionAction = "accept" | "reject";

const SUGGESTION_RE =
  /<(ins|del|span)\b([^>]*\bdata-suggestion=["']?(insert|delete)["']?[^>]*)>([\s\S]*?)<\/\1>/gi;

export function newSuggestionId(): string {
  return crypto.randomUUID();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function splitDraftParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function wrapSuggestion(kind: SuggestionKind, id: string, innerHtml: string): string {
  // Use <span> for deletions so StarterKit Strike does not claim a bare <del>.
  const tag = kind === "delete" ? "span" : "ins";
  return `<${tag} data-suggestion="${kind}" data-suggestion-id="${id}">${innerHtml}</${tag}>`;
}

/** Inline HTML for one paragraph of net-new prose (insertion mark). */
export function trackedInsertInlineHtml(text: string, id: string): string {
  return wrapSuggestion("insert", id, escapeHtml(text).replace(/\n/g, "<br>"));
}

function htmlForPart(text: string, wrap?: (inner: string) => string): string {
  const paras = text.split(/\n{2,}/);
  return paras
    .map((p, i) => {
      const inner = escapeHtml(p).replace(/\n/g, "<br>");
      const body = wrap ? wrap(inner) : inner;
      return (i === 0 ? "" : "</p><p>") + body;
    })
    .join("");
}

/**
 * Word-diff `oldText` vs `newText` into inline ins/del HTML sharing `id`.
 * Paragraph breaks become `</p><p>` so a multi-paragraph rewrite stays split.
 */
export function trackedDiffHtml(oldText: string, newText: string, id: string): string {
  return diffWords(oldText, newText)
    .map((part) => {
      if (part.added) {
        return htmlForPart(part.value, (inner) => wrapSuggestion("insert", id, inner));
      }
      if (part.removed) {
        return htmlForPart(part.value, (inner) => wrapSuggestion("delete", id, inner));
      }
      return htmlForPart(part.value);
    })
    .join("");
}

function parseKind(tag: string, explicit: string): SuggestionKind {
  if (explicit === "delete" || tag === "del") return "delete";
  return "insert";
}

function suggestionIdFromAttrs(attrs: string): string | null {
  return attrs.match(/\bdata-suggestion-id=["']([^"']+)["']/i)?.[1] ?? null;
}

export function suggestionIdsInHtml(html: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  SUGGESTION_RE.lastIndex = 0;
  for (const match of html.matchAll(new RegExp(SUGGESTION_RE.source, "gi"))) {
    const id = suggestionIdFromAttrs(match[2] ?? "") ?? `anon:${match.index ?? 0}`;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Accept keeps insertions and drops deletions; reject does the inverse.
 * Pass `id` to apply one hunk; omit it to apply every pending change.
 */
export function applySuggestions(
  html: string,
  action: SuggestionAction,
  id?: string
): string {
  SUGGESTION_RE.lastIndex = 0;
  return html.replace(SUGGESTION_RE, (full, tag: string, attrs: string, kind: string, body: string) => {
    const spanId = suggestionIdFromAttrs(attrs);
    if (id != null && spanId !== id) return full;
    const isInsert = parseKind(tag, kind) === "insert";
    if (action === "accept") return isInsert ? body : "";
    return isInsert ? "" : body;
  });
}

export function acceptSuggestions(html: string, id?: string): string {
  return applySuggestions(html, "accept", id);
}

export function rejectSuggestions(html: string, id?: string): string {
  return applySuggestions(html, "reject", id);
}
