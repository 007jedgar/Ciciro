import { Extension } from "@tiptap/core";
import type { Editor, Extensions } from "@tiptap/core";
import type { Mark, Node as PmNode, Schema } from "@tiptap/pm/model";
import Blockquote from "@tiptap/extension-blockquote";
import BulletList from "@tiptap/extension-bullet-list";
import CodeBlock from "@tiptap/extension-code-block";
import Heading from "@tiptap/extension-heading";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import OrderedList from "@tiptap/extension-ordered-list";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import StarterKit from "@tiptap/starter-kit";
import {
  SCREENPLAY_ATTR,
  SCREENPLAY_DUAL_ATTR,
  SHORTCUT_ORDER,
  applyCompletion,
  buildScriptIndex,
  capsText,
  completionsFor,
  continuesSpeech,
  cycleElement,
  elementTag,
  hasExtension,
  moveSceneOrder,
  nextElementOnEnter,
  normalizeElement,
  parseCue,
  setsCaps,
  shortcutDigit,
  smartTab,
  speechAt,
  toggleExtension,
  type Completion,
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

/** The script's blocks as the engine reads them: each top level node's element tag, text and dual flag. */
export function scriptBlocksOfDoc(doc: PmNode): ScriptBlock[] {
  return scriptBlocksOf(doc).blocks;
}

/** What the index is built from besides the sequence being written: the other sequences and the story bible's names. */
export type ScriptContext = {
  sequences: readonly (readonly ScriptBlock[])[];
  names: readonly string[];
  language?: string | null;
};

/** The popup's content and where to put it, handed to the page whenever it changes; null when it closes. */
export type SuggestInfo = {
  items: Completion[];
  selected: number;
  /** The caret in viewport coordinates. */
  coords: { left: number; top: number; bottom: number };
};

type Line = { start: number; text: string; element: ScreenplayElement; index: number };

/** The top level paragraph holding the caret when the caret is at the end of it and nothing is selected. */
function lineAtEnd(state: EditorState): Line | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if ($from.depth !== 1 || $from.parent.type.name !== "paragraph") return null;
  if ($from.parentOffset !== $from.parent.content.size) return null;
  return {
    start: $from.start(),
    text: $from.parent.textBetween(0, $from.parent.content.size, "", "\n"),
    element: normalizeElement($from.parent.attrs.screenplay),
    index: $from.index(0),
  };
}

type SuggestState = {
  items: Completion[];
  selected: number;
  /** The writer has moved the highlight: Enter takes it. */
  touched: boolean;
  /** The line (start and text) Escape was pressed on: closed until it changes. */
  dismissed: string | null;
  line: Line | null;
};

const suggestKey = new PluginKey<SuggestState>("screenplaySuggest");
const NO_SUGGESTIONS: SuggestState = { items: [], selected: 0, touched: false, dismissed: null, line: null };

function lineKey(line: Line): string {
  return `${line.start}:${line.text}`;
}

function suggestionsFor(state: EditorState, context: ScriptContext | null): { items: Completion[]; line: Line | null } {
  const line = lineAtEnd(state);
  if (!line || (line.element !== "character" && line.element !== "scene-heading")) return { items: [], line };
  const blocks = scriptBlocksOfDoc(state.doc);
  const mine = blocks.filter((_, i) => i !== line.index);
  const index = buildScriptIndex([...(context?.sequences ?? []), mine], { names: context?.names });
  const items = completionsFor(line.element, line.text, index, {
    language: context?.language,
    continues: (name) => continuesSpeech(blocks, line.index, name),
  });
  // A line that already says every choice has nothing left to offer.
  if (items.every((item) => applyCompletion(line.text, item) === line.text)) return { items: [], line };
  return { items, line };
}

/** The choices open under the caret, if any. */
function openSuggestions(state: EditorState): SuggestState | null {
  const value = suggestKey.getState(state);
  if (!value || value.items.length === 0 || !value.line) return null;
  if (value.dismissed === lineKey(value.line)) return null;
  return value;
}

/** The choices open under the caret, with the one highlighted; null when there are none. */
export function currentSuggestions(editor: Editor): { items: Completion[]; selected: number } | null {
  const open = openSuggestions(editor.state);
  return open ? { items: open.items, selected: open.selected } : null;
}

/** Type the choice over the line. False when it would change nothing (the line already says it). */
export function acceptSuggestion(editor: Editor, at?: number): boolean {
  const open = openSuggestions(editor.state);
  if (!open || !open.line) return false;
  const item = open.items[at ?? open.selected];
  if (!item || applyCompletion(open.line.text, item) === open.line.text) return false;
  const { start, text } = open.line;
  const tr = editor.state.tr.insertText(item.insert, start + item.from, start + text.length);
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** The text of the cue under the caret, or null when the caret is not in one. */
export function currentCueText(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  if ($from.depth !== 1 || $from.parent.type.name !== "paragraph") return null;
  if (normalizeElement($from.parent.attrs.screenplay) !== "character") return null;
  return $from.parent.textBetween(0, $from.parent.content.size, "", "\n");
}

/** Switch an extension (V.O., O.S., CONT'D) on the cue under the caret, leaving the caret at the end of it. */
export function toggleCueExtension(editor: Editor, extension: string): boolean {
  const { $from } = editor.state.selection;
  const text = currentCueText(editor);
  if (text === null || parseCue(text).name === "") return false;
  const next = toggleExtension(text, extension);
  if (next === text) return false;
  let same = 0;
  while (same < text.length && same < next.length && text[same] === next[same]) same++;
  const start = $from.start();
  const tr = editor.state.tr.insertText(next.slice(same), start + same, start + text.length);
  tr.setSelection(TextSelection.create(tr.doc, start + next.length));
  editor.view.dispatch(tr);
  return true;
}

export { hasExtension };

/** The scenes of the page: the block indexes the engine reads, for the navigator. */
export function sceneBlocks(editor: Editor): ScriptBlock[] {
  return scriptBlocksOfDoc(editor.state.doc);
}

/**
 * Move scene `from` to where scene `to` is (indexes into `scenes(blocks)`), as
 * one change that leaves every block, with its id, as it was. The caret goes
 * with the scene it was in.
 */
export function moveScene(editor: Editor, from: number, to: number): boolean {
  const { doc, selection } = editor.state;
  const blocks = scriptBlocksOfDoc(doc);
  const order = moveSceneOrder(blocks, from, to);
  if (!order) return false;
  let first = 0;
  while (order[first] === first) first++;
  let last = order.length - 1;
  while (order[last] === last) last--;
  const nodes: PmNode[] = [];
  doc.forEach((node) => nodes.push(node));
  let start = 0;
  for (let i = 0; i < first; i++) start += nodes[i].nodeSize;
  let end = start;
  for (let i = first; i <= last; i++) end += nodes[i].nodeSize;
  const moved = order.slice(first, last + 1).map((i) => nodes[i]);
  // Where the caret's block lands, and how far into it the caret was.
  const inBlock = selection.$from.depth >= 1;
  const at = inBlock ? selection.$from.index(0) : -1;
  const into = inBlock ? selection.from - (selection.$from.start(1) - 1) : 0;
  const tr = editor.state.tr.replaceWith(start, end, moved);
  const landed = order.indexOf(at);
  if (landed !== -1) {
    let pos = 0;
    for (let i = 0; i < landed; i++) pos += tr.doc.child(i).nodeSize;
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.doc.content.size, pos + into)), -1));
  }
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

export type ScreenplayOptions = {
  /** The rest of the script and the story bible, for the names and places offered. */
  context: () => ScriptContext | null;
  /** The choices under the caret changed (or closed, with null). */
  onSuggest: (info: SuggestInfo | null) => void;
};

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
export const Screenplay = Extension.create<ScreenplayOptions>({
  name: "screenplay",
  priority: 200,

  addOptions() {
    return { context: () => null, onSuggest: () => {} };
  },

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
    // Tab means more than the next element in two places: it takes the choice
    // the popup is showing, and it walks a scene heading or leaves a cue for its
    // parenthetical (see `smartTab`). Anywhere else it is the ring.
    const tab = (editor: Editor) => {
      if (acceptSuggestion(editor)) return true;
      const line = lineAtEnd(editor.state);
      const flow = line ? smartTab(line.element, line.text) : null;
      if (!flow) return cycle(editor, 1);
      if (flow.kind === "insert") {
        editor.view.dispatch(editor.state.tr.insertText(flow.text));
        return true;
      }
      return editor
        .chain()
        .splitBlock()
        .updateAttributes("paragraph", { screenplay: flow.element === "action" ? null : flow.element })
        .run();
    };
    return {
      ...picks,
      "Alt-Shift-d": ({ editor }) => toggleDual(editor),
      Tab: ({ editor }) => tab(editor),
      "Shift-Tab": ({ editor }) => cycle(editor, -1),
      Enter: ({ editor }) => {
        const current = currentElement(editor);
        if (current === null) return false;
        // The choice the writer walked to with the arrow keys is taken; one they did not is not.
        if (suggestKey.getState(editor.state)?.touched && acceptSuggestion(editor)) return true;
        // A cue for the character who was speaking before the action in between picks the speech up.
        if (current === "character") {
          const line = lineAtEnd(editor.state);
          if (line && line.text.trim() !== "" && !hasExtension(line.text, "CONT'D")) {
            const blocks = scriptBlocksOfDoc(editor.state.doc);
            if (continuesSpeech(blocks, line.index, parseCue(line.text).name)) {
              editor.view.dispatch(editor.state.tr.insertText(/\s$/.test(line.text) ? "(CONT'D)" : " (CONT'D)"));
            }
          }
        }
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
    const options = this.options;
    // Hand the page the choices under the caret, but only when they changed.
    let shown = "";
    const hide = () => {
      if (shown !== "") options.onSuggest(null);
      shown = "";
    };
    const report = (view: EditorView) => {
      const open = view.hasFocus() ? openSuggestions(view.state) : null;
      if (!open || !open.line) return hide();
      const signature = `${lineKey(open.line)}|${open.selected}|${open.items.map((i) => i.label).join("\u0000")}`;
      if (signature === shown) return;
      shown = signature;
      let coords = { left: 0, top: 0, bottom: 0 };
      try {
        const at = view.coordsAtPos(view.state.selection.from);
        coords = { left: at.left, top: at.top, bottom: at.bottom };
      } catch {
        /* no layout (a test) */
      }
      options.onSuggest({ items: open.items, selected: open.selected, coords });
    };
    return [
      new Plugin({
        key: new PluginKey("screenplayCaps"),
        props: {
          // What is typed into a heading, a cue, a transition or a shot is made
          // capitals as it goes, as Final Draft does. Text already there is left
          // as written (the page, the PDF and the assistant set it in capitals).
          handleTextInput: (view, from, to, text) => {
            const { parent } = view.state.doc.resolve(from);
            if (parent.type.name !== "paragraph" || !setsCaps(parent.attrs.screenplay)) return false;
            const typed = capsText("character", text);
            if (typed === text) return false;
            view.dispatch(view.state.tr.insertText(typed, from, to));
            return true;
          },
        },
      }),
      new Plugin<SuggestState>({
        key: suggestKey,
        state: {
          init: () => NO_SUGGESTIONS,
          apply: (tr, prev, _before, after) => {
            const { items, line } = suggestionsFor(after, options.context());
            const meta = tr.getMeta(suggestKey) as { move?: number; dismiss?: boolean } | undefined;
            const same =
              items.length === prev.items.length && items.every((item, i) => item.label === prev.items[i].label);
            let { selected, touched } = same ? prev : { selected: 0, touched: false };
            let dismissed = prev.dismissed;
            if (line && dismissed !== null && dismissed !== lineKey(line)) dismissed = null;
            if (!line) dismissed = null;
            if (meta?.move && items.length > 0) {
              selected = (selected + meta.move + items.length) % items.length;
              touched = true;
            }
            if (meta?.dismiss && line) dismissed = lineKey(line);
            return { items, selected, touched, dismissed, line };
          },
        },
        props: {
          handleDOMEvents: {
            blur: () => {
              hide();
              return false;
            },
            focus: (view) => {
              setTimeout(() => report(view), 0);
              return false;
            },
          },
          handleKeyDown: (view, event) => {
            if (!openSuggestions(view.state)) return false;
            const move = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
            if (move !== 0 && !event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
              view.dispatch(view.state.tr.setMeta(suggestKey, { move }));
              return true;
            }
            if (event.key === "Escape") {
              view.dispatch(view.state.tr.setMeta(suggestKey, { dismiss: true }));
              // Closing the choices is this Escape's whole job: not focus mode's too.
              event.stopPropagation();
              return true;
            }
            return false;
          },
        },
        view: () => ({
          update: (view) => report(view),
          destroy: () => hide(),
        }),
      }),
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
