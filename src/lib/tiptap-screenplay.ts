import { Extension } from "@tiptap/core";
import type { Editor, Extensions } from "@tiptap/core";
import type { Mark, Node as PmNode, Schema } from "@tiptap/pm/model";
import Blockquote from "@tiptap/extension-blockquote";
import BulletList from "@tiptap/extension-bullet-list";
import CodeBlock from "@tiptap/extension-code-block";
import Heading from "@tiptap/extension-heading";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import OrderedList from "@tiptap/extension-ordered-list";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import {
  SCREENPLAY_ATTR,
  SCREENPLAY_DUAL_ATTR,
  SHORTCUT_ORDER,
  cycleElement,
  elementTag,
  nextElementOnEnter,
  normalizeElement,
  shortcutDigit,
  speechAt,
  type ScreenplayElement,
  type ScriptBlock,
  type StyledRun,
} from "@/lib/screenplay";
import { looksLikeFountain, scriptFromFountain } from "@/lib/fountain";
import { classifyScreenplayLines, isProofread } from "@/lib/manuscript-kind";

/**
 * StarterKit for a script. A line that starts `# `, `- `, `1. `, `> `, three
 * dashes or three backticks is dialogue or action in a screenplay, never
 * markdown, so the nodes keep their parsing (an imported script may hold a
 * heading) but lose the input rules that would create them while typing.
 */
export function screenplayStarterKit(): Extensions {
  const typed = [Heading, Blockquote, BulletList, OrderedList, HorizontalRule, CodeBlock];
  return [
    StarterKit.configure({
      heading: false,
      blockquote: false,
      bulletList: false,
      orderedList: false,
      horizontalRule: false,
      codeBlock: false,
    }),
    ...typed.map((node) =>
      node.extend({
        addInputRules() {
          return [];
        },
      })
    ),
  ];
}

/**
 * The element tag stored on the paragraph holding the caret, or null outside
 * one. Unlike `currentElement`, an element this build does not know comes back
 * as written.
 */
export function currentTag(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  const node = $from.parent;
  if (node.type.name !== "paragraph") return null;
  return elementTag(node.attrs.screenplay);
}

/** The screenplay element of the paragraph holding the caret, or null outside one. */
export function currentElement(editor: Editor): ScreenplayElement | null {
  const tag = currentTag(editor);
  return tag === null ? null : normalizeElement(tag);
}

/** The element of the first paragraph the selection touches, null if it touches none. */
export function selectionElement(editor: Editor): ScreenplayElement | null {
  const { from, to } = editor.state.selection;
  let found: ScreenplayElement | null = null;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (found !== null) return false;
    if (node.type.name === "paragraph") {
      found = normalizeElement(node.attrs.screenplay);
      return false;
    }
    return true;
  });
  return found;
}

/** Give every paragraph in the selection the element (one caret, one paragraph). */
export function setElement(editor: Editor, element: ScreenplayElement): boolean {
  if (selectionElement(editor) === null) return false;
  return editor
    .chain()
    .focus()
    .updateAttributes("paragraph", {
      screenplay: element === "action" ? null : element,
      // Only a cue opens the second speech of a dual pair.
      ...(element === "character" ? {} : { screenplayDual: false }),
    })
    .run();
}

/** The script's top-level blocks as the engine reads them (a hard break reads as "\n"). */
function scriptBlocksOf(doc: PmNode): { blocks: ScriptBlock[]; starts: number[] } {
  const blocks: ScriptBlock[] = [];
  const starts: number[] = [];
  doc.forEach((node, offset) => {
    const paragraph = node.type.name === "paragraph";
    blocks.push({
      element: paragraph ? String(node.attrs.screenplay ?? "action") : "action",
      text: node.textBetween(0, node.content.size, "\n", "\n"),
      ...(paragraph && node.attrs.screenplayDual ? { dual: true } : {}),
    });
    starts.push(offset);
  });
  return { blocks, starts };
}

export type DualState = {
  /** The caret is in a speech that can sit beside the one above it, or already does. */
  available: boolean;
  /** The speech under the caret sits beside the one above it. */
  on: boolean;
};

/** The speech the caret is in: its cue's position, and whether it can pair with the speech above. */
function speechAtCaret(editor: Editor): { start: number; pairable: boolean; on: boolean } | null {
  const { $from } = editor.state.selection;
  if ($from.depth < 1) return null;
  const { blocks, starts } = scriptBlocksOf(editor.state.doc);
  const speech = speechAt(blocks, $from.index(0));
  return speech ? { start: starts[speech.cue], pairable: speech.pairable, on: speech.on } : null;
}

/** Whether dual dialogue can be switched on or off for the speech under the caret. */
export function dualState(editor: Editor): DualState {
  const speech = speechAtCaret(editor);
  return { available: speech !== null && (speech.pairable || speech.on), on: speech?.on ?? false };
}

/**
 * Seat the speech under the caret beside the one right above it, or take it
 * back out. Nothing happens when the caret is not in a speech, or there is no
 * speech right above it to pair with.
 */
export function toggleDual(editor: Editor): boolean {
  const speech = speechAtCaret(editor);
  if (!speech || (!speech.pairable && !speech.on)) return false;
  const node = editor.state.doc.nodeAt(speech.start);
  if (!node) return false;
  const tr = editor.state.tr.setNodeMarkup(speech.start, undefined, {
    ...node.attrs,
    screenplayDual: !speech.on,
  });
  editor.view.dispatch(tr);
  return true;
}

/** A paragraph of the given element holding styled runs: bold and italic as marks, a line break as a hard break. */
function scriptParagraph(schema: Schema, element: string, runs: readonly StyledRun[], dual = false) {
  const content = runs.flatMap((run) => {
    const marks: Mark[] = [];
    if (run.bold && schema.marks.bold) marks.push(schema.marks.bold.create());
    if (run.italic && schema.marks.italic) marks.push(schema.marks.italic.create());
    return run.text.split("\n").flatMap((piece, i) => [
      ...(i > 0 && schema.nodes.hardBreak ? [schema.nodes.hardBreak.create()] : []),
      ...(piece ? [schema.text(piece, marks)] : []),
    ]);
  });
  return schema.nodes.paragraph.create(
    { screenplay: element === "action" ? null : element, screenplayDual: dual && element === "character" },
    content
  );
}

/**
 * Screenplay elements as an attribute on paragraphs (`data-sp`), so a script is
 * still ordinary block HTML that syncs, diffs and exports like any chapter.
 * Tab and Shift-Tab cycle the element; Enter starts the next one; Alt+Shift
 * with 1 to 8 picks one outright (never Cmd/Ctrl+digit, which browsers keep for
 * switching tabs), and Alt+Shift+D seats a speech beside the one above it (dual
 * dialogue).
 *
 * The attribute holds whatever tag was stored, so an element a newer client
 * wrote (and this build cannot lay out) survives being opened and edited here.
 */
export const Screenplay = Extension.create({
  name: "screenplay",
  priority: 200,

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          screenplay: {
            default: null,
            // A new line is decided by Enter, never inherited from the split.
            keepOnSplit: false,
            parseHTML: (element) => {
              const tag = elementTag(element.getAttribute(SCREENPLAY_ATTR));
              return tag === "action" ? null : tag;
            },
            renderHTML: (attributes) => {
              const tag = elementTag(attributes.screenplay);
              return tag === "action" ? {} : { [SCREENPLAY_ATTR]: tag };
            },
          },
          // A cue that opens the second speech of a dual-dialogue pair: that speech sits beside the one above.
          screenplayDual: {
            default: false,
            keepOnSplit: false,
            parseHTML: (element) => {
              const value = element.getAttribute(SCREENPLAY_DUAL_ATTR)?.trim();
              return (value === "1" || value === "true") && elementTag(element.getAttribute(SCREENPLAY_ATTR)) === "character";
            },
            renderHTML: (attributes) =>
              attributes.screenplayDual && elementTag(attributes.screenplay) === "character"
                ? { [SCREENPLAY_DUAL_ATTR]: "1" }
                : {},
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    const choose = (element: ScreenplayElement) => (editor: Editor) =>
      currentElement(editor) === null ? false : setElement(editor, element);
    const picks = Object.fromEntries(
      SHORTCUT_ORDER.map((element) => [
        `Alt-Shift-${shortcutDigit(element)}`,
        ({ editor }: { editor: Editor }) => choose(element)(editor),
      ])
    );
    // Tab always belongs to the script: even with nothing to cycle it must not
    // hand focus to the next control on the page.
    const cycle = (editor: Editor, direction: 1 | -1) => {
      const first = selectionElement(editor);
      if (first !== null) setElement(editor, cycleElement(first, direction));
      return true;
    };
    return {
      ...picks,
      "Alt-Shift-d": ({ editor }) => toggleDual(editor),
      Tab: ({ editor }) => cycle(editor, 1),
      "Shift-Tab": ({ editor }) => cycle(editor, -1),
      Enter: ({ editor }) => {
        const current = currentElement(editor);
        if (current === null) return false;
        const selected = !editor.state.selection.empty;
        if (selected) {
          // A selection inside one line is replaced by the break, as anywhere.
          if (!editor.state.selection.$from.sameParent(editor.state.selection.$to)) return false;
          editor.commands.deleteSelection();
        }
        const { $from } = editor.state.selection;
        // Enter on an empty line drops back to action instead of stacking
        // empty elements, a scene heading included.
        if (!selected && $from.parent.content.size === 0 && current !== "action") {
          return setElement(editor, "action");
        }
        // Splitting speech in the middle leaves speech on both sides.
        const midSpeech = current === "dialogue" && $from.parentOffset < $from.parent.content.size;
        const next = midSpeech ? "dialogue" : nextElementOnEnter(current);
        return editor
          .chain()
          .splitBlock()
          .updateAttributes("paragraph", { screenplay: next === "action" ? null : next })
          .run();
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("screenplayPaste"),
        props: {
          // Pasted lines become elements. Text laid out as a script (Fountain,
          // paragraphs split by blank lines) is read as one, forced markers and
          // all; plain lines are sorted the way the assistant's are. A paste
          // that already carries elements (copied from a script) or is a
          // single line is left to the editor.
          handlePaste: (view, event) => {
            const data = event.clipboardData;
            if (!data || data.getData("text/html").includes(SCREENPLAY_ATTR)) return false;
            const text = data.getData("text/plain");
            if (!/\r?\n/.test(text.trim())) return false;
            const { state } = view;
            const { $from, $to } = state.selection;
            if (!$from.sameParent($to) || $from.parent.type.name !== "paragraph") return false;
            const tr = state.tr;
            if (!state.selection.empty) tr.deleteSelection();
            const at = tr.selection.$from;
            const index = at.index(0);
            const before = at.parent.content.size === 0 || at.parentOffset === 0;
            const above = before ? (index > 0 ? tr.doc.child(index - 1) : null) : at.parent;
            const lines = looksLikeFountain(text)
              ? scriptFromFountain(text, { titlePage: false }).sequences.flatMap((s) => s.blocks)
              : classifyScreenplayLines(text, above ? normalizeElement(above.attrs.screenplay) : undefined).map(
                  ({ element, text: line }) => ({ element, runs: [{ text: line }] })
                );
            if (lines.length === 0) return false;
            const nodes = lines.map((line) =>
              scriptParagraph(state.schema, line.element, line.runs, "dual" in line && line.dual === true)
            );
            const size = nodes.reduce((total, node) => total + node.nodeSize, 0);
            let start: number;
            if (at.parent.content.size === 0) {
              start = at.before();
              tr.replaceWith(start, at.after(), nodes);
            } else if (at.parentOffset === 0) {
              start = at.before();
              tr.insert(start, nodes);
            } else if (at.parentOffset === at.parent.content.size) {
              start = at.after();
              tr.insert(start, nodes);
            } else {
              // Mid-line: the line splits and the pasted lines go between the halves.
              tr.split(at.pos);
              start = at.pos + 1;
              tr.insert(start, nodes);
            }
            tr.setSelection(TextSelection.near(tr.doc.resolve(start + size - 1), -1));
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
      new Plugin({
        key: new PluginKey("screenplayProofread"),
        props: {
          // Names, slugs and transitions are not prose: the spell checker
          // skips them. A decoration keeps the attribute out of the saved HTML.
          decorations: (state) => {
            const marks: Decoration[] = [];
            state.doc.forEach((node, offset) => {
              if (node.type.name === "paragraph" && !isProofread(normalizeElement(node.attrs.screenplay))) {
                marks.push(Decoration.node(offset, offset + node.nodeSize, { spellcheck: "false" }));
              }
            });
            return DecorationSet.create(state.doc, marks);
          },
        },
      }),
    ];
  },
});
