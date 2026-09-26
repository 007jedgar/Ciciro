import type { Node as PmNode } from "@tiptap/pm/model";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { splitSentences } from "@/lib/tts";

export type DocSentence = { text: string; from: number; to: number };

/**
 * Sentences of the doc (or of a `from`..`to` slice of it) with document
 * positions, so the sentence being read can be highlighted in place.
 */
export function docSentences(doc: PmNode, range?: { from: number; to: number }): DocSentence[] {
  const out: DocSentence[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    let text = "";
    const positions: number[] = [];
    node.forEach((child, offset) => {
      const at = pos + 1 + offset;
      if (child.isText) {
        const value = child.text ?? "";
        for (let i = 0; i < value.length; i++) positions.push(at + i);
        text += value;
      } else if (child.type.name === "hardBreak") {
        positions.push(at);
        text += " ";
      }
    });
    for (const s of splitSentences(text)) {
      let from = positions[s.start];
      let to = positions[s.end - 1] + 1;
      if (range) {
        from = Math.max(from, range.from);
        to = Math.min(to, range.to);
        if (to <= from) continue;
      }
      const sentence = doc.textBetween(from, to, " ").trim();
      if (sentence) out.push({ text: sentence, from, to });
    }
    return false;
  });
  return out;
}

const key = new PluginKey<DecorationSet>("readAloud");

/** Highlights the sentence being read. Drive it with a transaction meta of {from,to} or null. */
export const ReadAloudHighlight = Extension.create({
  name: "readAloudHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(key) as { from: number; to: number } | null | undefined;
            if (meta === null) return DecorationSet.empty;
            if (meta) {
              return DecorationSet.create(tr.doc, [
                Decoration.inline(meta.from, meta.to, { class: "reading-aloud" }),
              ]);
            }
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});

export function setReadAloudRange(
  view: { state: { tr: Transaction }; dispatch: (tr: Transaction) => void },
  range: { from: number; to: number } | null
) {
  view.dispatch(view.state.tr.setMeta(key, range).setMeta("addToHistory", false));
}
