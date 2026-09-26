import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import {
  SCREENPLAY_ATTR,
  cycleElement,
  isScreenplayElement,
  nextElementOnEnter,
  normalizeElement,
  type ScreenplayElement,
} from "@/lib/manuscript-kind";

/** The screenplay element of the paragraph holding the caret, or null outside one. */
export function currentElement(editor: Editor): ScreenplayElement | null {
  const { $from } = editor.state.selection;
  const node = $from.parent;
  if (node.type.name !== "paragraph") return null;
  return normalizeElement(node.attrs.screenplay);
}

export function setElement(editor: Editor, element: ScreenplayElement): boolean {
  if (currentElement(editor) === null) return false;
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
    return {
      Tab: ({ editor }) => {
        const current = currentElement(editor);
        return current === null ? false : setElement(editor, cycleElement(current, 1));
      },
      "Shift-Tab": ({ editor }) => {
        const current = currentElement(editor);
        return current === null ? false : setElement(editor, cycleElement(current, -1));
      },
      Enter: ({ editor }) => {
        const current = currentElement(editor);
        if (current === null) return false;
        const { selection } = editor.state;
        if (!selection.empty) return false;
        // Enter on an empty cue, line or transition drops back to action
        // instead of stacking empty elements.
        if (
          selection.$from.parent.content.size === 0 &&
          current !== "action" &&
          current !== "scene-heading"
        ) {
          return setElement(editor, "action");
        }
        const next = nextElementOnEnter(current);
        return editor
          .chain()
          .splitBlock()
          .updateAttributes("paragraph", { screenplay: next === "action" ? null : next })
          .run();
      },
    };
  },
});
