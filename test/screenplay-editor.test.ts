// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { BlockId } from "@/lib/tiptap-block-id";
import { Screenplay, currentElement, currentTag, screenplayStarterKit, setElement } from "@/lib/tiptap-screenplay";
import { ScreenplayPages, refreshPageMarkers } from "@/lib/tiptap-screenplay-pages";
import { elementForShortcutDigit, type PageCursor } from "@/lib/screenplay";

let editor: Editor | null = null;

function make(content: string): Editor {
  editor = new Editor({ extensions: [...screenplayStarterKit(), BlockId, Screenplay], content });
  return editor;
}

function press(ed: Editor, key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  return ed.view.someProp("handleKeyDown", (f) => f(ed.view, event)) === true;
}

/** Type one character the way the browser does, giving input rules their chance. */
function type(ed: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = ed.state.selection;
    const handled = ed.view.someProp("handleTextInput", (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)));
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
  }
}

function paste(ed: Editor, text: string, html = "") {
  const event = {
    clipboardData: { getData: (type: string) => (type === "text/html" ? html : type === "text/plain" ? text : "") },
    preventDefault() {},
  } as unknown as ClipboardEvent;
  return ed.view.someProp("handlePaste", (f) => f(ed.view, event, ed.state.doc.slice(0, 0))) === true;
}

function lines(ed: Editor): [string | null, string][] {
  const out: [string | null, string][] = [];
  ed.state.doc.forEach((node) => out.push([node.attrs.screenplay ?? null, node.textContent]));
  return out;
}

/** Alt+Shift+digit as a US keyboard sends it: the shifted character, with the digit's key code. */
function pressChoose(ed: Editor, digit: number) {
  const shifted = ")!@#$%^&*(".charAt(digit);
  const event = new KeyboardEvent("keydown", {
    key: shifted,
    keyCode: 48 + digit,
    shiftKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
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

  describe("no markdown while typing (P1)", () => {
    it.each(["# ", "## ", "- ", "* ", "1. ", "> ", "```", "---"])("%j stays text in a script", (typed) => {
      const ed = make("<p></p>");
      ed.commands.focus("end");
      type(ed, typed);
      expect(ed.state.doc.childCount).toBe(1);
      expect(ed.state.doc.firstChild?.type.name).toBe("paragraph");
      expect(ed.getHTML()).not.toMatch(/<(h\d|ul|ol|blockquote|pre|hr)\b/);
    });

    it("still reads headings and quotes that are already in a script", () => {
      const ed = make("<h2>Act one</h2><blockquote><p>Quoted</p></blockquote>");
      expect(ed.getHTML()).toMatch(/<h2\b/);
      expect(ed.getHTML()).toMatch(/<blockquote\b/);
    });
  });

  describe("Tab across a selection (P4)", () => {
    it("cycles every selected line and keeps focus on the page", () => {
      const ed = make("<p>One</p><p>Two</p><p>Three</p>");
      ed.commands.selectAll();
      expect(press(ed, "Tab")).toBe(true);
      expect(elements(ed)).toEqual(["character", "character", "character"]);
      expect(press(ed, "Tab", true)).toBe(true);
      expect(elements(ed)).toEqual([null, null, null]);
    });

    it("steps from the first selected line", () => {
      const ed = make('<p data-sp="dialogue">One</p><p>Two</p>');
      ed.commands.selectAll();
      press(ed, "Tab");
      expect(elements(ed)).toEqual(["parenthetical", "parenthetical"]);
    });

    it("is swallowed even when there is nothing to cycle", () => {
      const ed = make("<p>One</p>");
      ed.commands.setNodeSelection(0);
      expect(press(ed, "Tab")).toBe(true);
    });
  });

  describe("Enter (P2, P3)", () => {
    it("does not leave an empty scene heading behind", () => {
      const ed = make('<p data-sp="scene-heading"></p>');
      ed.commands.focus("end");
      press(ed, "Enter");
      expect(lines(ed)).toEqual([[null, ""]]);
    });

    it("keeps both halves dialogue when it splits speech", () => {
      const ed = make('<p data-sp="dialogue">Where is he going?</p>');
      ed.commands.focus("start");
      ed.commands.setTextSelection(1 + "Where is ".length);
      press(ed, "Enter");
      expect(lines(ed)).toEqual([
        ["dialogue", "Where is "],
        ["dialogue", "he going?"],
      ]);
    });

    it("replaces a whole selected line with the break instead of dropping it to action", () => {
      const ed = make('<p data-sp="character">MARA</p><p data-sp="dialogue">Where is he?</p>');
      ed.commands.setTextSelection({ from: 7, to: 7 + "Where is he?".length });
      press(ed, "Enter");
      expect(lines(ed)).toEqual([
        ["character", "MARA"],
        ["dialogue", ""],
        [null, ""],
      ]);
    });

    it("still ends speech with an action at the end of the line", () => {
      const ed = make('<p data-sp="dialogue">Go.</p>');
      ed.commands.focus("end");
      press(ed, "Enter");
      expect(elements(ed)).toEqual(["dialogue", null]);
    });
  });

  describe("paste (P5)", () => {
    const script = "INT. LAB - DAY\n\nMARA\nWhere is he?\n\nCUT TO:";

    it("sorts pasted lines into elements", () => {
      const ed = make("<p></p>");
      ed.commands.focus("end");
      expect(paste(ed, script)).toBe(true);
      expect(lines(ed)).toEqual([
        ["scene-heading", "INT. LAB - DAY"],
        ["character", "MARA"],
        ["dialogue", "Where is he?"],
        ["transition", "CUT TO:"],
      ]);
    });

    it("places the lines after the line the caret ends", () => {
      const ed = make("<p>He waits.</p>");
      ed.commands.focus("end");
      paste(ed, script);
      expect(lines(ed)[0]).toEqual([null, "He waits."]);
      expect(lines(ed)[1]).toEqual(["scene-heading", "INT. LAB - DAY"]);
    });

    it("splits the line when pasting into the middle of it", () => {
      const ed = make("<p>He waits.</p>");
      ed.commands.setTextSelection(1 + 2);
      paste(ed, "MARA\nHi.");
      expect(lines(ed)).toEqual([
        [null, "He"],
        ["character", "MARA"],
        ["dialogue", "Hi."],
        [null, " waits."],
      ]);
    });

    it("reads on from the cue above an empty line", () => {
      const ed = make('<p data-sp="character">MARA</p><p></p>');
      ed.commands.focus("end");
      paste(ed, "(low)\nHello.\nAre you there?");
      expect(lines(ed)).toEqual([
        ["character", "MARA"],
        ["parenthetical", "low"],
        ["dialogue", "Hello."],
        ["dialogue", "Are you there?"],
      ]);
    });

    it("reads on from the line above when pasting at the start of a line", () => {
      const ed = make('<p>He waits.</p><p data-sp="character">JONAH</p>');
      ed.commands.setTextSelection(1 + "He waits.".length + 2);
      paste(ed, "She walks in.\nHe sits.");
      expect(lines(ed)).toEqual([
        [null, "He waits."],
        [null, "She walks in."],
        [null, "He sits."],
        ["character", "JONAH"],
      ]);
    });

    it("reads on from the line above a whole line it replaces", () => {
      const ed = make('<p>He waits.</p><p data-sp="character">MARA</p>');
      ed.commands.setTextSelection({ from: 1 + "He waits.".length + 2, to: 1 + "He waits.".length + 2 + "MARA".length });
      paste(ed, "She walks in.\nHe sits.");
      expect(lines(ed)).toEqual([
        [null, "He waits."],
        [null, "She walks in."],
        [null, "He sits."],
      ]);
    });

    it("leaves a single line, and pasted scripts that carry elements, to the editor", () => {
      const ed = make("<p></p>");
      expect(paste(ed, "just a line")).toBe(false);
      expect(paste(ed, script, '<p data-sp="character">MARA</p>')).toBe(false);
    });
  });

  it("marks cues, scene headings and transitions as not for the spell checker", () => {
    const ed = make(
      '<p data-sp="scene-heading">INT. LAB - DAY</p><p data-sp="character">MARA</p><p data-sp="dialogue">Hello.</p><p data-sp="transition">CUT TO:</p><p>She waits.</p>'
    );
    const flags = Array.from(ed.view.dom.children).map((el) => el.getAttribute("spellcheck"));
    expect(flags).toEqual(["false", "false", null, "false", null]);
    expect(ed.getHTML()).not.toContain("spellcheck");
  });
});

describe("screenplay elements added for the page engine", () => {
  it("Tab reaches Shot and Enter after a shot is action", () => {
    const ed = make('<p data-sp="transition">CUT TO:</p>');
    ed.commands.focus("end");
    press(ed, "Tab");
    expect(currentElement(ed)).toBe("shot");
    expect(ed.getHTML()).toContain('data-sp="shot"');
    ed.commands.insertContent("ANGLE ON THE DOOR");
    press(ed, "Enter");
    expect(elements(ed)).toEqual(["shot", null]);
  });

  it("an empty shot falls back to action on Enter, like a transition", () => {
    const ed = make('<p data-sp="shot"></p>');
    ed.commands.focus("end");
    press(ed, "Enter");
    expect(elements(ed)).toEqual([null]);
  });

  it("Alt+Shift+digit chooses an element outright, never Cmd/Ctrl+digit", () => {
    const ed = make("<p>Mara</p>");
    ed.commands.focus("end");
    for (const digit of [1, 2, 3, 4, 5, 6, 7]) {
      expect(pressChoose(ed, digit)).toBe(true);
      expect(currentElement(ed)).toBe(elementForShortcutDigit(digit));
    }
    expect(currentElement(ed)).toBe("transition");
    expect(pressChoose(ed, 6)).toBe(true);
    expect(currentElement(ed)).toBe("shot");
    const ctrl = new KeyboardEvent("keydown", { key: "3", ctrlKey: true, bubbles: true, cancelable: true });
    expect(ed.view.someProp("handleKeyDown", (f) => f(ed.view, ctrl)) === true).toBe(false);
    expect(currentElement(ed)).toBe("shot");
  });

  it("keeps an element a newer client wrote, through a round trip and an edit", () => {
    const ed = make('<p data-sp="centered">THE END</p><p data-sp="dialogue">Hi.</p>');
    expect(elements(ed)).toEqual(["centered", "dialogue"]);
    expect(ed.getHTML()).toContain('data-sp="centered"');
    ed.commands.focus(1);
    expect(currentTag(ed)).toBe("centered");
    expect(currentElement(ed)).toBe("action");
    ed.commands.insertContent("!");
    expect(ed.getHTML()).toContain('data-sp="centered"');
    // Enter keeps the first half and starts the next line as the engine says.
    ed.commands.focus(1);
    press(ed, "Enter");
    expect(elements(ed)[0]).toBe("centered");
  });

  it("does not let a hostile tag out of its attribute", () => {
    const ed = make('<p data-sp="x&quot; onclick=&quot;y">Hi.</p>');
    expect(ed.getHTML()).not.toContain("onclick");
    expect(elements(ed)).toEqual([null]);
  });
});

describe("soft page markers", () => {
  function paged(html: string, start: () => PageCursor = () => ({ page: 1, line: 0 })): Editor {
    editor = new Editor({
      extensions: [...screenplayStarterKit(), BlockId, Screenplay, ScreenplayPages.configure({ start })],
      content: html,
    });
    return editor;
  }
  const markers = (ed: Editor) =>
    [...ed.view.dom.querySelectorAll<HTMLElement>(".sp-page-break")].map((el) => el.textContent);

  const filler = (n: number) => Array.from({ length: n }, (_, i) => `<p>Line ${i}.</p>`).join("");

  it("draws none for a script that fits a page", () => {
    expect(markers(paged(filler(10)))).toEqual([]);
  });

  it("draws a rule and the next page's number where the engine says a page ends", () => {
    const ed = paged(filler(60));
    expect(markers(ed)).toEqual(["2.", "3."]);
    // The first rule sits between blocks: just before block 27, whose position is the sum of the 27 before it.
    const first = ed.view.dom.querySelector(".sp-page-break");
    expect(first?.nextElementSibling?.textContent).toBe("Line 27.");
  });

  it("puts a marker inside a long paragraph at the line where the page turns", () => {
    const long = `<p>${Array.from({ length: 120 }, () => "word").join(" ")}</p>`;
    const ed = paged(`${filler(24)}${long}`);
    const inside = ed.view.dom.querySelector("p:last-of-type .sp-page-break");
    expect(inside).not.toBeNull();
  });

  it("follows the page a sequence starts on, and can be redrawn when it moves", () => {
    let start: PageCursor = { page: 1, line: 0 };
    const ed = paged(filler(10), () => start);
    expect(markers(ed)).toEqual([]);
    start = { page: 5, line: 40 };
    refreshPageMarkers(ed);
    expect(markers(ed)).toEqual(["6."]);
  });

  it("is never part of the saved HTML", () => {
    const ed = paged(filler(60));
    expect(ed.getHTML()).not.toContain("sp-page-break");
  });
});
