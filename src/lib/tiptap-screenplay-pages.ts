import { Extension, type Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import {
  ELEMENT_METRICS,
  MORE_TEXT,
  SCRIPT_START,
  contdCue,
  isNumberedScene,
  layout,
  paginate,
  type PageCursor,
  type ScriptBlock,
} from "@/lib/screenplay";

/**
 * What the page engine (src/lib/screenplay.ts) says about the script, drawn on
 * top of it as decorations, so none of it is ever saved:
 *
 * - soft page breaks: a dashed rule and the next page's number, where a page
 *   begins; it takes no height, so it never moves a line;
 * - `(MORE)` at the foot of a page a speech runs past, and the cue again with
 *   `(CONT'D)` at the top of the next, set in the same columns they print in;
 * - dual dialogue: the two speeches of a pair get the classes that set them side
 *   by side (floats, in globals.css);
 * - scene numbers, on the heading, which the CSS puts in the margins.
 *
 * The same layout sets the page count and the PDF, so the markers, the count and
 * the printout agree.
 */

const key = new PluginKey<DecorationSet>("screenplayPages");

/** What shapes the pages besides the words; see `PageOptions` in the engine. */
export type ScreenplayPageSettings = {
  more: boolean;
  contd: boolean;
  sceneNumbers: boolean;
  /** Numbered scenes in the sequences before this one, so numbers run on across them. */
  scenesBefore: number;
};

export type ScreenplayPagesOptions = {
  /** Where this sequence starts on the page; sequences run on from one another. */
  start: () => PageCursor;
  settings: () => ScreenplayPageSettings;
};

export const DEFAULT_PAGE_SETTINGS: ScreenplayPageSettings = {
  more: true,
  contd: true,
  sceneNumbers: false,
  scenesBefore: 0,
};

/** A top-level node as the engine reads it. */
function scriptBlock(node: PmNode): ScriptBlock {
  const paragraph = node.type.name === "paragraph";
  return {
    element: paragraph ? String(node.attrs.screenplay ?? "action") : "action",
    // A hard break counts as one character and one position, like the "\n" it reads as.
    text: node.textBetween(0, node.content.size, "\n", "\n"),
    ...(paragraph && node.attrs.screenplayDual ? { dual: true } : {}),
  };
}

/** A line the printed page carries but the text does not, set `column` columns in from the page's margin. */
function note(className: string, text: string, indent: number, column: number): HTMLElement {
  const line = document.createElement("div");
  line.className = className;
  line.contentEditable = "false";
  line.setAttribute("aria-hidden", "true");
  // Back to the margin from inside an indented block, then out to the column.
  line.style.marginLeft = `${column - indent}ch`;
  line.textContent = text;
  return line;
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

function markersFor(doc: PmNode, start: PageCursor, settings: ScreenplayPageSettings): DecorationSet {
  const blocks: ScriptBlock[] = [];
  const starts: number[] = [];
  doc.forEach((node, offset) => {
    blocks.push(scriptBlock(node));
    starts.push(offset);
  });
  if (blocks.length === 0) return DecorationSet.empty;
  const laid = layout(blocks);
  const { breaks } = paginate(laid, { start, more: settings.more, contd: settings.contd });
  const column = ELEMENT_METRICS.character.indent;
  const decorations: Decoration[] = [];
  const broke = new Set<number>();

  for (const b of breaks) {
    // Just before the block, or inside it at the character where the page's first line begins.
    const pos = b.line === 0 ? starts[b.block] : starts[b.block] + 1 + b.offset;
    const indent = b.line === 0 ? 0 : laid[b.block].indent;
    if (b.line === 0) broke.add(b.block);
    const id = `${b.page}-${indent}`;
    if (b.more) {
      decorations.push(
        Decoration.widget(pos, () => note("sp-more", MORE_TEXT, indent, column), {
          side: -3,
          key: `more-${id}`,
          ignoreSelection: true,
        })
      );
    }
    decorations.push(
      Decoration.widget(pos, () => marker(b.page, indent), { side: -2, key: `page-${id}`, ignoreSelection: true })
    );
    if (b.contd && b.speech !== null) {
      const text = contdCue(blocks[b.speech].text);
      decorations.push(
        Decoration.widget(pos, () => note("sp-contd", text, indent, column), {
          side: -1,
          key: `contd-${id}-${text}`,
          ignoreSelection: true,
        })
      );
    }
  }

  // Dual dialogue: both columns float, and the block after the pair clears them.
  laid.forEach((b, i) => {
    if (!b.dual) return;
    const prev = laid[i - 1]?.dual;
    const next = laid[i + 1]?.dual;
    const first = !prev || prev.pair !== b.dual.pair || prev.side !== b.dual.side;
    const last = !next || next.pair !== b.dual.pair || next.side !== b.dual.side;
    const classes = ["sp-dual", `sp-dual-${b.dual.side}`];
    if (first) classes.push("sp-dual-first");
    if (last) classes.push("sp-dual-last");
    // A pair that opens a page, or the script, has no blank line above it.
    const pairStart = firstOfPair(laid, i);
    if (first && (pairStart === 0 || broke.has(pairStart))) classes.push("sp-dual-flush");
    decorations.push(Decoration.node(starts[i], starts[i] + doc.child(i).nodeSize, { class: classes.join(" ") }));
  });
  laid.forEach((b, i) => {
    if (i > 0 && laid[i - 1].dual && !b.dual) {
      decorations.push(Decoration.node(starts[i], starts[i] + doc.child(i).nodeSize, { class: "sp-dual-after" }));
    }
  });

  if (settings.sceneNumbers) {
    let count = settings.scenesBefore;
    laid.forEach((b, i) => {
      if (!isNumberedScene(b.element, blocks[i].text)) return;
      count++;
      decorations.push(
        Decoration.node(starts[i], starts[i] + doc.child(i).nodeSize, { "data-scene-number": String(count) })
      );
    });
  }
  return DecorationSet.create(doc, decorations);
}

/** The block index where the pair that block `i` belongs to begins. */
function firstOfPair(laid: ReturnType<typeof layout>, i: number): number {
  const pair = laid[i].dual?.pair;
  let at = i;
  while (at > 0 && laid[at - 1].dual?.pair === pair) at--;
  return at;
}

export const ScreenplayPages = Extension.create<ScreenplayPagesOptions>({
  name: "screenplayPages",

  addOptions() {
    return { start: () => SCRIPT_START, settings: () => DEFAULT_PAGE_SETTINGS };
  },

  addProseMirrorPlugins() {
    const { start, settings } = this.options;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_config, state) => markersFor(state.doc, start(), settings()),
          apply(tr, value, _old, state) {
            return tr.docChanged || tr.getMeta(key) ? markersFor(state.doc, start(), settings()) : value;
          },
        },
        props: {
          decorations: (state) => key.getState(state),
        },
      }),
    ];
  },
});

/** Draw the markers again, for when the page this sequence starts on or a setting has moved. */
export function refreshPageMarkers(editor: Editor) {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, true));
}
