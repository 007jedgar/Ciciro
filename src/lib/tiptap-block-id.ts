import { Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "listItem",
  "horizontalRule",
]);

function assignMissingBlockIds(tr: Transaction, doc: PmNode): boolean {
  let modified = false;
  const seen = new Set<string>();
  doc.descendants((node, pos) => {
    if (!node.isBlock || !BLOCK_TYPES.has(node.type.name)) return;
    // A block pasted from elsewhere in the chapter arrives with an id that is
    // already taken; the first holder keeps it.
    const id = node.attrs.blockId as string | null;
    if (id && !seen.has(id)) {
      seen.add(id);
      return;
    }
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      blockId: crypto.randomUUID(),
    });
    modified = true;
  });
  return modified;
}

/** Persist stable `data-block-id` on TipTap block nodes so HTML round-trips. */
export const BlockId = Extension.create({
  name: "blockId",

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_TYPES],
        attributes: {
          blockId: {
            default: null,
            // Return splits a paragraph in two; only the first half is the
            // block the id names. The second gets its own.
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute("data-block-id"),
            renderHTML: (attributes) => {
              if (!attributes.blockId) return {};
              return { "data-block-id": attributes.blockId };
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockIdAssign"),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((t) => t.docChanged)) return null;
          const tr = newState.tr;
          if (!assignMissingBlockIds(tr, newState.doc)) return null;
          return tr;
        },
        view(view) {
          const tr = view.state.tr;
          if (assignMissingBlockIds(tr, view.state.doc)) {
            view.dispatch(tr);
          }
          return {};
        },
      }),
    ];
  },
});
