import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * A short-lived highlight on a range of the page: a search hit or the next
 * suggestion pulses (accent), an accepted change flashes green, a rejected one
 * red. The decoration only exists while the CSS animation plays and is never
 * part of the saved HTML.
 */
export type FlashTone = "pulse" | "accept" | "reject";

export type FlashRange = { from: number; to: number };

type FlashMeta = { add: { id: number; ranges: FlashRange[]; tone: FlashTone } } | { clear: number };

const key = new PluginKey<DecorationSet>("ciciroFlash");
let nextId = 0;

/** How long each tone stays on the page: the length of its animation. */
export const FLASH_MS: Record<FlashTone, number> = { pulse: 700, accept: 400, reject: 400 };

export const FlashHighlight = Extension.create({
  name: "flashHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            let next = set.map(tr.mapping, tr.doc);
            const meta = tr.getMeta(key) as FlashMeta | undefined;
            if (!meta) return next;
            if ("add" in meta) {
              const size = tr.doc.content.size;
              const decorations = meta.add.ranges
                .map((r) => ({ from: Math.max(0, r.from), to: Math.min(size, r.to) }))
                .filter((r) => r.to > r.from)
                .map((r) =>
                  Decoration.inline(r.from, r.to, { class: `flash-${meta.add.tone}` }, { flashId: meta.add.id })
                );
              next = next.add(tr.doc, decorations);
            } else {
              next = next.remove(next.find(undefined, undefined, (spec) => spec.flashId === meta.clear));
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});

/** Highlight `ranges` (document positions) and remove the highlight when it has played. */
export function flashRanges(editor: Editor, ranges: FlashRange[], tone: FlashTone): void {
  if (editor.isDestroyed || ranges.length === 0) return;
  const id = ++nextId;
  editor.view.dispatch(editor.state.tr.setMeta(key, { add: { id, ranges, tone } } satisfies FlashMeta).setMeta("addToHistory", false));
  setTimeout(() => {
    if (editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(key, { clear: id } satisfies FlashMeta).setMeta("addToHistory", false));
  }, FLASH_MS[tone]);
}
