import { Mark, mergeAttributes } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

export type SuggestionAction = "accept" | "reject";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    suggestion: {
      acceptSuggestion: (id?: string) => ReturnType;
      rejectSuggestion: (id?: string) => ReturnType;
      acceptAllSuggestions: () => ReturnType;
      rejectAllSuggestions: () => ReturnType;
    };
  }
}

type Range = { from: number; to: number; kind: string };

function suggestionMarkType(doc: PmNode) {
  return doc.type.schema.marks.suggestion;
}

function collectRanges(doc: PmNode, id?: string): Range[] {
  const markType = suggestionMarkType(doc);
  if (!markType) return [];
  const ranges: Range[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type === markType);
    if (!mark) return;
    if (id != null && mark.attrs.id !== id) return;
    ranges.push({ from: pos, to: pos + node.nodeSize, kind: mark.attrs.kind });
  });
  return ranges;
}

function applyAction(
  doc: PmNode,
  tr: Transaction,
  action: SuggestionAction,
  id: string | undefined,
  dispatch?: (tr: Transaction) => void
): boolean {
  const markType = suggestionMarkType(doc);
  if (!markType) return false;
  const ranges = collectRanges(doc, id);
  if (ranges.length === 0) return false;
  if (!dispatch) return true;
  ranges.sort((a, b) => b.from - a.from);
  for (const range of ranges) {
    const drop =
      (action === "accept" && range.kind === "delete") ||
      (action === "reject" && range.kind === "insert");
    if (drop) tr.delete(range.from, range.to);
    else tr.removeMark(range.from, range.to, markType);
  }
  dispatch(tr);
  return true;
}

export function suggestionIdAt(state: EditorState): string | null {
  const markType = suggestionMarkType(state.doc);
  if (!markType) return null;
  const inspect = (pos: number): string | null => {
    const clamped = Math.max(0, Math.min(pos, state.doc.content.size));
    const $pos = state.doc.resolve(clamped);
    const marked =
      $pos.marks().find((m) => m.type === markType) ||
      $pos.nodeAfter?.marks.find((m) => m.type === markType) ||
      $pos.nodeBefore?.marks.find((m) => m.type === markType);
    const id = marked?.attrs.id;
    return typeof id === "string" && id ? id : null;
  };
  const { from, to } = state.selection;
  return inspect(from) ?? (from !== to ? inspect(to) : null) ?? inspect(from - 1);
}

export function countSuggestionGroups(doc: PmNode): number {
  const markType = suggestionMarkType(doc);
  if (!markType) return 0;
  const ids = new Set<string>();
  doc.descendants((node) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type === markType);
    if (!mark) return;
    ids.add(typeof mark.attrs.id === "string" && mark.attrs.id ? mark.attrs.id : "anon");
  });
  return ids.size;
}

/** Inline mark that serializes to <ins>/<del data-suggestion> so HTML round-trips. */
export const Suggestion = Mark.create({
  name: "suggestion",
  inclusive: false,
  // Beat StarterKit Strike's generic `<del>` parse rule.
  priority: 1000,

  addAttributes() {
    return {
      kind: {
        default: "insert",
        parseHTML: (element) =>
          element.getAttribute("data-suggestion") ||
          (element.tagName === "DEL" ? "delete" : "insert"),
        renderHTML: (attributes) => ({
          "data-suggestion": attributes.kind === "delete" ? "delete" : "insert",
        }),
      },
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-suggestion-id"),
        renderHTML: (attributes) =>
          attributes.id ? { "data-suggestion-id": attributes.id } : {},
      },
    };
  },

  parseHTML() {
    return [
      { tag: "ins[data-suggestion]" },
      { tag: "del[data-suggestion]", priority: 61 },
      { tag: "span[data-suggestion]" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const kind = HTMLAttributes["data-suggestion"] === "delete" ? "delete" : "insert";
    const tag = kind === "delete" ? "span" : "ins";
    return [tag, mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      acceptSuggestion:
        (id?: string) =>
        ({ editor, tr, dispatch }) => {
          const target = id ?? suggestionIdAt(editor.state) ?? undefined;
          if (target == null) return false;
          return applyAction(editor.state.doc, tr, "accept", target, dispatch);
        },
      rejectSuggestion:
        (id?: string) =>
        ({ editor, tr, dispatch }) => {
          const target = id ?? suggestionIdAt(editor.state) ?? undefined;
          if (target == null) return false;
          return applyAction(editor.state.doc, tr, "reject", target, dispatch);
        },
      acceptAllSuggestions:
        () =>
        ({ editor, tr, dispatch }) =>
          applyAction(editor.state.doc, tr, "accept", undefined, dispatch),
      rejectAllSuggestions:
        () =>
        ({ editor, tr, dispatch }) =>
          applyAction(editor.state.doc, tr, "reject", undefined, dispatch),
    };
  },
});
