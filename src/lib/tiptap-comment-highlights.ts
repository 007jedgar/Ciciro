import { Extension, type Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { nearestOccurrence } from "@/lib/share-view";
import { blockTextOf, textOffsetToPos } from "@/lib/tiptap-text-offset";

/** A reader comment's passage to mark in the editor. */
export type CommentHighlight = {
  id: string;
  blockId: string;
  quote: string;
  offset: number;
  /** Hover text: who said what. */
  title: string;
};

const key = new PluginKey<DecorationSet>("readerCommentHighlights");

/**
 * Underline each passage in its paragraph as the text is now. A passage the
 * author has since rewritten is left unmarked; the comments panel still lists it.
 */
export function buildCommentDecorations(doc: PmNode, highlights: CommentHighlight[]): DecorationSet {
  const decorations: Decoration[] = [];
  const wanted = new Set(highlights.map((h) => h.blockId));
  const blocks = new Map<string, { node: PmNode; pos: number }>();
  doc.descendants((node, pos) => {
    const id = node.attrs.blockId;
    if (typeof id === "string" && wanted.has(id) && !blocks.has(id)) {
      blocks.set(id, { node, pos });
      return false;
    }
  });
  for (const h of highlights) {
    const block = blocks.get(h.blockId);
    if (!block) continue;
    const at = nearestOccurrence(blockTextOf(block.node), h.quote, h.offset);
    if (at < 0) continue;
    const from = textOffsetToPos(block.node, block.pos, at, false);
    const to = textOffsetToPos(block.node, block.pos, at + h.quote.length, true);
    if (to <= from) continue;
    decorations.push(
      Decoration.inline(
        from,
        to,
        { class: "reader-comment-mark", title: h.title, "data-comment-id": h.id },
        { id: h.id }
      )
    );
  }
  return DecorationSet.create(doc, decorations);
}

/** Marks reader comments' passages; clicking one reports the comment's id. */
export const CommentHighlights = Extension.create<{ onClick: ((id: string) => void) | null }>({
  name: "readerCommentHighlights",

  addOptions() {
    return { onClick: null };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const next = tr.getMeta(key) as CommentHighlight[] | undefined;
            if (next) return buildCommentDecorations(tr.doc, next);
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
          handleClick(view, pos) {
            const hit = key.getState(view.state)?.find(pos, pos)[0];
            if (hit && options.onClick) options.onClick((hit.spec as { id: string }).id);
            return false;
          },
        },
      }),
    ];
  },
});

/** Replace the marked passages. */
export function setCommentHighlights(editor: Editor, highlights: CommentHighlight[]): void {
  editor.view.dispatch(editor.state.tr.setMeta(key, highlights));
}
