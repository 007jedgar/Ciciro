import type { Node as PmNode } from "@tiptap/pm/model";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
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

type Range = { from: number; to: number };
type ReadAloudState = { ranges: Range[]; current: number | null; decorations: DecorationSet };
type ReadAloudMeta = { track: Range[] } | { highlight: number | null };
type ViewLike = { state: EditorState; dispatch: (tr: Transaction) => void };

const key = new PluginKey<ReadAloudState>("readAloud");

function liveRange(doc: PmNode, range: Range | undefined): Range | null {
  if (!range) return null;
  const from = Math.max(0, Math.min(range.from, doc.content.size));
  const to = Math.max(0, Math.min(range.to, doc.content.size));
  return to > from ? { from, to } : null;
}

function decorate(doc: PmNode, ranges: Range[], current: number | null): DecorationSet {
  const range = current === null ? null : liveRange(doc, ranges[current]);
  if (!range) return DecorationSet.empty;
  return DecorationSet.create(doc, [Decoration.inline(range.from, range.to, { class: "reading-aloud" })]);
}

/**
 * Tracks the sentences being read through edits (so a line edit made while
 * listening is heard and highlighted in place) and highlights the current one.
 */
export function readAloudPlugin() {
  return new Plugin<ReadAloudState>({
    key,
    state: {
      init: () => ({ ranges: [], current: null, decorations: DecorationSet.empty }),
      apply(tr, prev) {
        const meta = tr.getMeta(key) as ReadAloudMeta | undefined;
        if (!meta && !tr.docChanged) return prev;
        let { ranges, current } = prev;
        if (tr.docChanged) {
          ranges = ranges.map((r) => ({ from: tr.mapping.map(r.from, -1), to: tr.mapping.map(r.to, 1) }));
        }
        if (meta && "track" in meta) {
          ranges = meta.track;
          current = null;
        } else if (meta && "highlight" in meta) {
          current = meta.highlight;
          if (current === null) ranges = [];
        }
        return { ranges, current, decorations: decorate(tr.doc, ranges, current) };
      },
    },
    props: {
      decorations: (state) => key.getState(state)?.decorations,
    },
  });
}

export const ReadAloudHighlight = Extension.create({
  name: "readAloudHighlight",
  addProseMirrorPlugins() {
    return [readAloudPlugin()];
  },
});

function dispatchMeta(view: ViewLike, meta: ReadAloudMeta) {
  view.dispatch(view.state.tr.setMeta(key, meta).setMeta("addToHistory", false));
}

/** Start tracking these sentences; indices passed to the other helpers refer to this list. */
export function trackReadAloud(view: ViewLike, sentences: Range[]) {
  dispatchMeta(view, { track: sentences.map(({ from, to }) => ({ from, to })) });
}

/** Highlight the tracked sentence at `index`; null ends the reading and clears it. */
export function highlightReadAloud(view: ViewLike, index: number | null) {
  dispatchMeta(view, { highlight: index });
}

/** The tracked sentence at `index` as it reads now, or null if it was deleted. */
export function readAloudSentence(state: EditorState, index: number): DocSentence | null {
  const range = liveRange(state.doc, key.getState(state)?.ranges[index]);
  if (!range) return null;
  const text = state.doc.textBetween(range.from, range.to, " ").trim();
  return text ? { text, ...range } : null;
}
