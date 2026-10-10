import { Extension } from "@tiptap/core";
import type { Editor, Extensions } from "@tiptap/core";
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
  classifyScreenplayLines,
  cycleElement,
  isProofread,
  isScreenplayElement,
  nextElementOnEnter,
  normalizeElement,
  type ScreenplayElement,
} from "@/lib/manuscript-kind";

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

/** The screenplay element of the paragraph holding the caret, or null outside one. */
export function currentElement(editor: Editor): ScreenplayElement | null {
  const { $from } = editor.state.selection;
  const node = $from.parent;
  if (node.type.name !== "paragraph") return null;
  return normalizeElement(node.attrs.screenplay);
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
    .updateAttributes("paragraph", { screenplay: element === "action" ? null : element })
    .run();
}

/**
 * Screenplay elements as an attribute on paragraphs (`data-sp`), so a script is
 * still ordinary block HTML that syncs, diffs and exports like any chapter.
 * Tab and Shift-Tab cycle the element; Enter starts the next one.
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
              const value = element.getAttribute(SCREENPLAY_ATTR);
              return isScreenplayElement(value) && value !== "action" ? value : null;
            },
            renderHTML: (attributes) =>
              isScreenplayElement(attributes.screenplay) && attributes.screenplay !== "action"
                ? { [SCREENPLAY_ATTR]: attributes.screenplay }
                : {},
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    // Tab always belongs to the script: even with nothing to cycle it must not
    // hand focus to the next control on the page.
    const cycle = (editor: Editor, direction: 1 | -1) => {
      const first = selectionElement(editor);
      if (first !== null) setElement(editor, cycleElement(first, direction));
      return true;
    };
    return {
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
          // Pasted lines become elements, the way the assistant's do. A paste
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
            const lines = classifyScreenplayLines(
              text,
              above ? normalizeElement(above.attrs.screenplay) : undefined
            );
            if (lines.length === 0) return false;
            const { paragraph: type } = state.schema.nodes;
            const nodes = lines.map(({ element, text: line }) =>
              type.create({ screenplay: element === "action" ? null : element }, state.schema.text(line))
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
