// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import { BlockId } from "@/lib/tiptap-block-id";
import { Screenplay, currentElement, setElement } from "@/lib/tiptap-screenplay";

let editor: Editor | null = null;

function make(content: string): Editor {
  editor = new Editor({ extensions: [StarterKit, BlockId, Screenplay], content });
  return editor;
}

function press(ed: Editor, key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  return ed.view.someProp("handleKeyDown", (f) => f(ed.view, event)) === true;
}

function elements(ed: Editor): (string | null)[] {
  const out: (string | null)[] = [];
  ed.state.doc.forEach((node) => out.push(node.attrs.screenplay ?? null));
  return out;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("screenplay editor", () => {
  it("round-trips the element through data-sp", () => {
    const ed = make('<p data-sp="scene-heading">INT. LAB - DAY</p><p>She waits.</p><p data-sp="dialogue">Hello.</p>');
    expect(elements(ed)).toEqual(["scene-heading", null, "dialogue"]);
    const html = ed.getHTML();
    expect(html).toContain('data-sp="scene-heading"');
    expect(html).toContain('data-sp="dialogue"');
    expect(html).not.toContain('data-sp="action"');
  });

  it("Tab cycles the element and Shift-Tab goes back", () => {
    const ed = make("<p>Mara</p>");
    ed.commands.focus("end");
    expect(currentElement(ed)).toBe("action");
    expect(press(ed, "Tab")).toBe(true);
    expect(currentElement(ed)).toBe("character");
    press(ed, "Tab");
    expect(currentElement(ed)).toBe("dialogue");
    press(ed, "Tab", true);
    press(ed, "Tab", true);
    expect(currentElement(ed)).toBe("action");
    expect(ed.getHTML()).not.toContain("data-sp");
  });

  it("Enter starts the next element: cue, then dialogue, then action", () => {
    const ed = make('<p data-sp="character">MARA</p>');
    ed.commands.focus("end");
    press(ed, "Enter");
    expect(elements(ed)).toEqual(["character", "dialogue"]);
    ed.commands.insertContent("Where is he?");
    press(ed, "Enter");
    expect(elements(ed)).toEqual(["character", "dialogue", null]);
  });

  it("Enter after a scene heading is action, and an empty cue falls back to action", () => {
    const ed = make('<p data-sp="scene-heading">INT. LAB - DAY</p>');
    ed.commands.focus("end");
    press(ed, "Enter");
    expect(elements(ed)).toEqual(["scene-heading", null]);
    setElement(ed, "character");
    expect(currentElement(ed)).toBe("character");
    press(ed, "Enter");
    expect(elements(ed)).toEqual(["scene-heading", null]);
  });

  it("does not repeat the previous element on a split", () => {
    const ed = make('<p data-sp="transition">CUT TO:</p>');
    ed.commands.focus("end");
    press(ed, "Enter");
    expect(elements(ed)).toEqual(["transition", "scene-heading"]);
  });
});
