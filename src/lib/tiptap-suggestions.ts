import { createDocument, Extension, Mark, type Editor } from "@tiptap/core";
import {
  Fragment,
  Slice,
  type Mark as PmMark,
  type MarkType,
  type Node as PmNode,
  type NodeType,
} from "@tiptap/pm/model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Mapping, ReplaceStep, type Step } from "@tiptap/pm/transform";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  newSuggestionId,
  resolveSuggestions,
  SUGGESTION_ATTRS,
  type SuggestionAction,
  type SuggestionAuthor,
} from "@/lib/suggestions";

// Tracked changes in the desk editor. Suggestions are two marks, rendered as
// the same <ins>/<del> elements src/lib/suggestions.ts reads and writes, so
// what TipTap saves is exactly what the server, the phone, and the model see.
//
// In suggest mode a plugin rewrites each edit after the fact: typed or pasted
// text gains an insertion mark, and deleted text is put back with a deletion
// mark instead of disappearing. Deleting a pending insertion removes it for
// real (it was never part of the manuscript). Paragraph splits and joins and
// formatting changes apply directly; only words are tracked.

/** Transactions carrying this meta are never tracked (accept/reject, loads). */
export const SUGGESTION_SKIP_META = "ciciroSuggestionSkip";

export const INSERTION_MARK = "suggestionInsertion";
export const DELETION_MARK = "suggestionDeletion";

export type SuggestionMarkAttrs = {
  suggestionId: string;
  authorId: string;
  authorName: string;
  createdAt: string;
};

function suggestionAttributes() {
  const attr = (name: string, key: keyof SuggestionMarkAttrs) => ({
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute(name),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes[key] == null ? {} : { [name]: attributes[key] },
  });
  // Declaration order is render order; it matches suggestionOpenTag.
  return {
    suggestionId: attr(SUGGESTION_ATTRS.id, "suggestionId"),
    authorId: attr(SUGGESTION_ATTRS.authorId, "authorId"),
    authorName: attr(SUGGESTION_ATTRS.authorName, "authorName"),
    createdAt: attr(SUGGESTION_ATTRS.createdAt, "createdAt"),
  };
}

// Priority above every formatting mark, so a suggestion is the outermost
// element around its text, the same nesting the shared serializer writes.
export const SuggestionInsertion = Mark.create({
  name: INSERTION_MARK,
  priority: 1100,
  inclusive: false,
  excludes: `${INSERTION_MARK} ${DELETION_MARK}`,
  addAttributes: suggestionAttributes,
  parseHTML() {
    return [{ tag: `ins[${SUGGESTION_ATTRS.id}]` }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["ins", HTMLAttributes, 0];
  },
});

export const SuggestionDeletion = Mark.create({
  name: DELETION_MARK,
  priority: 1100,
  inclusive: false,
  excludes: `${INSERTION_MARK} ${DELETION_MARK}`,
  addAttributes: suggestionAttributes,
  parseHTML() {
    // Ahead of StarterKit's Strike, which would otherwise claim every <del>.
    return [{ tag: `del[${SUGGESTION_ATTRS.id}]`, priority: 100 }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["del", HTMLAttributes, 0];
  },
});

export type TrackContext = {
  suggesting: boolean;
  author: SuggestionAuthor;
  now?: () => string;
  newId?: () => string;
};

function isTrackable(tr: Transaction): boolean {
  if (tr.getMeta(SUGGESTION_SKIP_META)) return false;
  // setContent(..., false): the document arriving from the server.
  if (tr.getMeta("preventUpdate")) return false;
  // Undo and redo replay edits that were already tracked once.
  if (tr.getMeta("history$")) return false;
  return true;
}

function suggestionMarkOf(node: PmNode | null | undefined, types: MarkType[]): PmMark | null {
  if (!node) return null;
  for (const mark of node.marks) if (types.includes(mark.type)) return mark;
  return null;
}

/**
 * Attributes for a new mark at [from, to): continue a neighbouring suggestion
 * by the same author (typing on, or the insertion half of a replacement), so a
 * word typed letter by letter is one change and not five.
 */
function attrsNear(
  doc: PmNode,
  from: number,
  to: number,
  types: MarkType[],
  ctx: TrackContext
): SuggestionMarkAttrs {
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  for (const node of [$from.nodeBefore, $to.nodeAfter]) {
    const mark = suggestionMarkOf(node, types);
    if (mark && mark.attrs.authorId === ctx.author.authorId && mark.attrs.suggestionId) {
      return {
        suggestionId: mark.attrs.suggestionId as string,
        authorId: ctx.author.authorId,
        authorName: ctx.author.authorName,
        createdAt: (mark.attrs.createdAt as string) || (ctx.now ?? isoNow)(),
      };
    }
  }
  return {
    suggestionId: (ctx.newId ?? newSuggestionId)(),
    authorId: ctx.author.authorId,
    authorName: ctx.author.authorName,
    createdAt: (ctx.now ?? isoNow)(),
  };
}

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * The removed content as it should come back: proposed text that was never
 * applied stays gone, text already marked deleted stays as it was, and
 * everything else gains the deletion mark.
 */
function markRemoved(
  fragment: Fragment,
  parent: NodeType,
  mark: PmMark,
  insertion: MarkType,
  deletion: MarkType
): Fragment {
  const nodes: PmNode[] = [];
  fragment.forEach((node) => {
    if (node.isInline) {
      if (insertion.isInSet(node.marks)) return;
      if (deletion.isInSet(node.marks) || !parent.allowsMarkType(deletion)) nodes.push(node);
      else nodes.push(node.mark(mark.addToSet(node.marks)));
      return;
    }
    nodes.push(node.copy(markRemoved(node.content, node.type, mark, insertion, deletion)));
  });
  return Fragment.from(nodes);
}

function hasInline(fragment: Fragment): boolean {
  let found = false;
  fragment.descendants((node) => {
    if (node.isInline) found = true;
    return !found;
  });
  return found;
}

/**
 * Rewrite the edits in `transactions` as tracked changes. Returns the
 * follow-up transaction, or null when there is nothing to track.
 *
 * Outside suggest mode it only makes sure fresh text never inherits a
 * deletion mark from the struck-through run it was typed into.
 */
export function trackTransactions(
  transactions: readonly Transaction[],
  oldState: EditorState,
  newState: EditorState,
  ctx: TrackContext
): Transaction | null {
  const changed = transactions.filter((tr) => tr.docChanged);
  if (changed.length === 0 || changed.some((tr) => !isTrackable(tr))) return null;
  const insertion = newState.schema.marks[INSERTION_MARK];
  const deletion = newState.schema.marks[DELETION_MARK];
  if (!insertion || !deletion) return null;

  const steps: Step[] = [];
  const docs: PmNode[] = [];
  for (const tr of changed) {
    tr.steps.forEach((step, i) => {
      steps.push(step);
      docs.push(tr.docs[i]);
    });
  }
  const maps = steps.map((step) => step.getMap());
  const out = newState.tr;
  let touched = false;
  let caret: number | null = null;

  steps.forEach((step, i) => {
    if (!(step instanceof ReplaceStep)) return;
    const { from, to, slice } = step;
    const later = new Mapping(maps.slice(i + 1));

    if (ctx.suggesting && to > from) {
      const removed = docs[i].slice(from, to);
      const at = out.mapping.map(later.map(from, -1), -1);
      const attrs = attrsNear(out.doc, at, at, [deletion, insertion], ctx);
      const parent = docs[i].resolve(from).parent.type;
      const content = markRemoved(removed.content, parent, deletion.create(attrs), insertion, deletion);
      if (hasInline(content)) {
        const back = new Slice(content, removed.openStart, removed.openEnd);
        try {
          const before = out.doc.content.size;
          out.replace(at, at, back);
          touched = true;
          const size = out.doc.content.size - before;
          // A lone Backspace leaves the caret before the struck text so the
          // next Backspace reaches the previous letter; Delete leaves it after.
          if (steps.length === 1 && slice.size === 0 && oldState.selection.empty) {
            caret = oldState.selection.head === to ? at : at + size;
          } else if (steps.length === 1 && slice.size === 0) {
            caret = at + size;
          }
        } catch {
          // Content that cannot go back where it was is left deleted.
        }
      }
    }

    if (slice.size > 0) {
      const start = out.mapping.map(later.map(from, 1), 1);
      const end = out.mapping.map(later.map(from + slice.size, -1), -1);
      if (end <= start) return;
      if (out.doc.rangeHasMark(start, end, deletion)) {
        out.removeMark(start, end, deletion);
        touched = true;
      }
      if (ctx.suggesting) {
        const attrs = attrsNear(out.doc, start, end, [insertion, deletion], ctx);
        out.removeMark(start, end, insertion);
        out.addMark(start, end, insertion.create(attrs));
        touched = true;
      }
    }
  });

  if (!touched) return null;
  if (caret !== null) out.setSelection(TextSelection.near(out.doc.resolve(caret)));
  out.setMeta(SUGGESTION_SKIP_META, true);
  return out;
}

/**
 * Struck-through text is not prose anyone will keep, and the browser reads
 * "slowly" and the "crossed" right after it as one misspelled word. Turn the
 * spellchecker off over deletions without touching the saved HTML.
 */
function deletionDecorations(doc: PmNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    if (node.marks.some((mark) => mark.type.name === DELETION_MARK)) {
      decorations.push(Decoration.inline(pos, pos + node.nodeSize, { spellcheck: "false" }));
    }
  });
  return decorations.length ? DecorationSet.create(doc, decorations) : DecorationSet.empty;
}

export type TrackChangesStorage = {
  suggesting: boolean;
  author: SuggestionAuthor;
};

/** Suggest mode for TipTap. Flip `editor.storage.trackChanges.suggesting`. */
export const TrackChanges = Extension.create<Record<string, never>, TrackChangesStorage>({
  name: "trackChanges",

  addStorage() {
    return { suggesting: false, author: { authorId: "author", authorName: "Author" } };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<DecorationSet>({
        key: new PluginKey("ciciroTrackChanges"),
        state: {
          init: (_config, state) => deletionDecorations(state.doc),
          apply: (tr, previous) => (tr.docChanged ? deletionDecorations(tr.doc) : previous),
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
        appendTransaction: (transactions, oldState, newState) =>
          trackTransactions(transactions, oldState, newState, {
            suggesting: storage.suggesting,
            author: storage.author,
          }),
      }),
    ];
  },
});

/** Every suggestion mark in the document, merged into one range per id. */
export function suggestionRanges(doc: PmNode): Map<string, { from: number; to: number }> {
  const ranges = new Map<string, { from: number; to: number }>();
  doc.descendants((node, pos) => {
    if (!node.isInline) return;
    for (const mark of node.marks) {
      if (mark.type.name !== INSERTION_MARK && mark.type.name !== DELETION_MARK) continue;
      const id = mark.attrs.suggestionId as string | null;
      if (!id) continue;
      const range = ranges.get(id);
      const end = pos + node.nodeSize;
      if (range) {
        range.from = Math.min(range.from, pos);
        range.to = Math.max(range.to, end);
      } else {
        ranges.set(id, { from: pos, to: end });
      }
    }
  });
  return ranges;
}

/** The suggestion under the caret (or at the start of a selection), if any. */
export function suggestionAt(state: EditorState): string | null {
  const { $from } = state.selection;
  for (const node of [$from.nodeAfter, $from.nodeBefore]) {
    if (!node) continue;
    for (const mark of node.marks) {
      if (mark.type.name === INSERTION_MARK || mark.type.name === DELETION_MARK) {
        return (mark.attrs.suggestionId as string | null) ?? null;
      }
    }
  }
  return null;
}

/**
 * Accept or reject suggestions in a live editor. The rules are the shared
 * ones in src/lib/suggestions.ts (so the desk, the phone, and the server agree
 * on what "accept" leaves behind); the result goes in as the smallest replace
 * that reaches it, so the caret, scroll position, and undo history survive.
 * Returns false when there was nothing to resolve.
 */
export function resolveInEditor(editor: Editor, action: SuggestionAction, ids?: readonly string[]): boolean {
  const html = editor.getHTML();
  const next = resolveSuggestions(html, action, ids ?? null);
  if (next === html) return false;
  const doc = editor.state.doc;
  // Parse exactly what getHTML wrote: collapsing whitespace would "change"
  // untouched paragraphs that hold a typed double space.
  const nextDoc = createDocument(next, editor.schema, { preserveWhitespace: "full" });
  const start = doc.content.findDiffStart(nextDoc.content);
  const end = doc.content.findDiffEnd(nextDoc.content);
  if (start == null || !end) return false;
  let { a: endA, b: endB } = end;
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  const tr = editor.state.tr.replace(start, endA, nextDoc.slice(start, endB)).setMeta(SUGGESTION_SKIP_META, true);
  editor.view.dispatch(tr);
  return true;
}
