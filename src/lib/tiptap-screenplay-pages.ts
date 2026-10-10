import { Extension, type Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { layout, paginate, SCRIPT_START, type PageCursor, type ScriptBlock } from "@/lib/screenplay";

/**
 * Soft page-break markers: a dashed rule and the page number, drawn where the
 * page engine (src/lib/screenplay.ts) says a new page begins. A decoration, so
 * it is never part of the saved HTML, and it takes no height, so it never
 * moves a line. The same layout sets the "about N pages" count and the PDF, so
 * the markers, the count, and the printout agree.
 */

const key = new PluginKey<DecorationSet>("screenplayPages");

export type ScreenplayPagesOptions = {
  /** Where this sequence starts on the page; sequences run on from one another. */
  start: () => PageCursor;
};

/** A top-level node as the engine reads it. */
function scriptBlock(node: PmNode): ScriptBlock {
  return {
    element: node.type.name === "paragraph" ? String(node.attrs.screenplay ?? "action") : "action",
    // A hard break counts as one character and one position, like the "\n" it reads as.
    text: node.textBetween(0, node.content.size, "\n", "\n"),
  };
}

/** `indent` columns back to the page's left margin, for a marker inside an indented block. */
function marker(page: number, indent: number): HTMLElement {
  const rule = document.createElement("div");
  rule.className = "sp-page-break";
  rule.contentEditable = "false";
  rule.setAttribute("aria-hidden", "true");
  if (indent > 0) rule.style.marginLeft = `-${indent}ch`;
  const label = document.createElement("span");
  label.textContent = `${page}.`;
  rule.appendChild(label);
  return rule;
}

function markersFor(doc: PmNode, start: PageCursor): DecorationSet {
  const blocks: ScriptBlock[] = [];
  const starts: number[] = [];
  doc.forEach((node, offset) => {
    blocks.push(scriptBlock(node));
    starts.push(offset);
  });
  if (blocks.length === 0) return DecorationSet.empty;
  const laid = layout(blocks);
  const { breaks } = paginate(laid, { start });
  const decorations = breaks.map((b) => {
    // Just before the block, or inside it at the character where the page's first line begins.
    const pos = b.line === 0 ? starts[b.block] : starts[b.block] + 1 + b.offset;
    const indent = b.line === 0 ? 0 : laid[b.block].indent;
    return Decoration.widget(pos, () => marker(b.page, indent), {
      side: -1,
      key: `page-${b.page}-${indent}`,
      ignoreSelection: true,
    });
  });
  return DecorationSet.create(doc, decorations);
}

export const ScreenplayPages = Extension.create<ScreenplayPagesOptions>({
  name: "screenplayPages",

  addOptions() {
    return { start: () => SCRIPT_START };
  },

  addProseMirrorPlugins() {
    const { start } = this.options;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => markersFor(state.doc, start()),
          apply(tr, value, _old, state) {
            return tr.docChanged || tr.getMeta(key) ? markersFor(state.doc, start()) : value;
          },
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});

/** Draw the markers again, for when the page this sequence starts on has moved. */
export function refreshPageMarkers(editor: Editor) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, true));
}
