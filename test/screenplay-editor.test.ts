// @vitest-environment jsdom

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { BlockId } from "@/lib/tiptap-block-id";
import {
  Screenplay,
  acceptSuggestion,
  currentElement,
  currentSuggestions,
  currentTag,
  dualState,
  moveScene,
  screenplayStarterKit,
  setElement,
  toggleCueExtension,
  toggleDual,
  type ScriptContext,
  type SuggestInfo,
} from "@/lib/tiptap-screenplay";
import { ScreenplayPages, refreshPageMarkers, type ScreenplayPageSettings } from "@/lib/tiptap-screenplay-pages";
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
    const ed = make("<p></p>");
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

    it("reads text laid out as Fountain: forced markers, emphasis, dialogue under a cue", () => {
      const ed = make("<p></p>");
      const script = "INT. LAB - DAY\n\n!BOOM.\n\nMARA\n(softly)\nHello *there*.\n\n>FADE OUT.\n\n# Act two\n\nTitle: not a title page";
      expect(paste(ed, script)).toBe(true);
      expect(lines(ed)).toEqual([
        ["scene-heading", "INT. LAB - DAY"],
        [null, "BOOM."],
        ["character", "MARA"],
        ["parenthetical", "softly"],
        ["dialogue", "Hello there."],
        ["transition", "FADE OUT."],
        [null, "Title: not a title page"],
      ]);
      expect(ed.getHTML()).toContain("Hello <em>there</em>.");
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
    const ed = make('<p data-sp="lyric">THE END</p><p data-sp="dialogue">Hi.</p>');
    expect(elements(ed)).toEqual(["lyric", "dialogue"]);
    expect(ed.getHTML()).toContain('data-sp="lyric"');
    ed.commands.focus(1);
    expect(currentTag(ed)).toBe("lyric");
    expect(currentElement(ed)).toBe("action");
    ed.commands.insertContent("!");
    expect(ed.getHTML()).toContain('data-sp="lyric"');
    // Enter keeps the first half and starts the next line as the engine says.
    ed.commands.focus(1);
    press(ed, "Enter");
    expect(elements(ed)[0]).toBe("lyric");
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

describe("professional output in the editor", () => {
  const speech = (cue: string, text: string, attrs = "") => `<p data-sp="character"${attrs}>${cue}</p><p data-sp="dialogue">${text}</p>`;
  const wordsOf = (n: number) =>
    Array.from({ length: n }, (_, i) => `line${String(i).padStart(2, "0")}`.padEnd(35, "a")).join(" ");
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `<p>Filler ${i}.</p>`).join("");
  function paged(html: string, settings: Partial<ScreenplayPageSettings> = {}): Editor {
    const merged = { more: true, contd: true, sceneNumbers: false, scenesBefore: 0, ...settings };
    editor = new Editor({
      extensions: [
        ...screenplayStarterKit(),
        BlockId,
        Screenplay,
        ScreenplayPages.configure({ start: () => ({ page: 1, line: 0 }), settings: () => merged }),
      ],
      content: html,
    });
    return editor;
  }
  const notes = (ed: Editor, cls: string) =>
    [...ed.view.dom.querySelectorAll<HTMLElement>(`.${cls}`)].map((el) => el.textContent);

  it("keeps the dual flag through the HTML, on a cue only", () => {
    const html = `${speech("MARA", "Hi.")}${speech("JONAH", "Hello.", ' data-sp-dual="1"')}<p data-sp="dialogue" data-sp-dual="1">x</p>`;
    const ed = make(html);
    expect(ed.getHTML()).toMatch(/<p data-sp="character" data-sp-dual="1"[^>]*>JONAH<\/p>/);
    // A flag on anything but a cue is dropped, not carried.
    expect(ed.getHTML().match(/data-sp-dual/g)).toHaveLength(1);
  });

  it("seats a speech beside the one above it, and takes it back out", () => {
    const ed = make(`${speech("MARA", "Hi.")}${speech("JONAH", "Hello.")}`);
    ed.commands.focus(1);
    expect(dualState(ed)).toEqual({ available: false, on: false });
    expect(toggleDual(ed)).toBe(false);
    ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize + ed.state.doc.child(1).nodeSize + 3);
    expect(dualState(ed)).toEqual({ available: true, on: false });
    expect(toggleDual(ed)).toBe(true);
    expect(ed.getHTML()).toContain('data-sp-dual="1"');
    expect(dualState(ed)).toEqual({ available: true, on: true });
    expect(toggleDual(ed)).toBe(true);
    expect(ed.getHTML()).not.toContain("data-sp-dual");
  });

  it("does not offer dual dialogue for a speech with no speech right above it", () => {
    const ed = make(`${speech("MARA", "Hi.")}<p>A beat.</p>${speech("JONAH", "Hello.")}`);
    ed.commands.setTextSelection(ed.state.doc.content.size - 3);
    expect(dualState(ed).available).toBe(false);
  });

  it("clears the flag when the cue becomes something else, and does not bring it back", () => {
    const ed = make(`${speech("MARA", "Hi.")}${speech("JONAH", "Hello.", ' data-sp-dual="1"')}`);
    const at = ed.state.doc.child(0).nodeSize + ed.state.doc.child(1).nodeSize + 2;
    ed.commands.setTextSelection(at);
    setElement(ed, "action");
    expect(ed.getHTML()).not.toContain("data-sp-dual");
    setElement(ed, "character");
    expect(ed.getHTML()).not.toContain("data-sp-dual");
  });

  it("gives both speeches of a pair their column, and the block after it the clearing class", () => {
    const ed = paged(`<p>Opening.</p>${speech("MARA", "Hi.")}${speech("JONAH", "Hello.", ' data-sp-dual="1"')}<p>After.</p>`);
    const cls = [...ed.view.dom.querySelectorAll("p")].map((p) => p.className);
    expect(cls[0]).toBe("");
    expect(cls[1]).toContain("sp-dual-left sp-dual-first");
    expect(cls[2]).toContain("sp-dual-left sp-dual-last");
    expect(cls[3]).toContain("sp-dual-right sp-dual-first");
    expect(cls[4]).toContain("sp-dual-right sp-dual-last");
    expect(cls[5]).toBe("sp-dual-after");
    expect(ed.getHTML()).not.toContain("class=");
  });

  it("closes a page with (MORE) and opens the next with the cue and (CONT'D)", () => {
    const ed = paged(`${filler(20)}${speech("MARA", wordsOf(20))}`);
    expect(notes(ed, "sp-more")).toEqual(["(MORE)"]);
    expect(notes(ed, "sp-contd")).toEqual(["MARA (CONT'D)"]);
    const more = ed.view.dom.querySelector(".sp-more")!;
    expect(more.nextElementSibling?.className).toContain("sp-page-break");
    expect(more.nextElementSibling?.nextElementSibling?.className).toContain("sp-contd");
    // Set in the cue's column from inside the dialogue's own indent.
    expect((more as HTMLElement).style.marginLeft).toBe("12ch");
    expect(ed.getHTML()).not.toContain("(MORE)");
    expect(ed.getHTML()).not.toContain("CONT");
  });

  it("draws neither when the switches are off", () => {
    const ed = paged(`${filler(20)}${speech("MARA", wordsOf(20))}`, { more: false, contd: false });
    expect(notes(ed, "sp-more")).toEqual([]);
    expect(notes(ed, "sp-contd")).toEqual([]);
    expect(ed.view.dom.querySelectorAll(".sp-page-break").length).toBe(1);
  });

  it("numbers scene headings, counting on from the sequences before", () => {
    const ed = paged(
      '<p data-sp="scene-heading">int. a - day</p><p data-sp="scene-heading"></p><p data-sp="scene-heading">ext. b - day</p>',
      { sceneNumbers: true, scenesBefore: 4 }
    );
    expect([...ed.view.dom.querySelectorAll("[data-scene-number]")].map((el) => el.getAttribute("data-scene-number"))).toEqual(["5", "6"]);
    expect(ed.getHTML()).not.toContain("data-scene-number");
    expect(paged('<p data-sp="scene-heading">int. a - day</p>').view.dom.querySelector("[data-scene-number]")).toBeNull();
  });

  it("chooses Centered with Alt+Shift+8, and Enter after it is action", () => {
    const ed = make("<p>THE END</p>");
    ed.commands.focus(1);
    expect(pressChoose(ed, 8)).toBe(true);
    expect(elements(ed)).toEqual(["centered"]);
    ed.commands.focus("end");
    press(ed, "Enter");
    expect(elements(ed)).toEqual(["centered", null]);
  });

  it("pastes Fountain with a dual pair and centered text as elements", () => {
    const ed = make("<p></p>");
    ed.commands.focus(1);
    paste(ed, "MARA\nHi.\n\nJONAH ^\nHello.\n\n> THE END <");
    expect(lines(ed).map(([el]) => el)).toEqual(["character", "dialogue", "character", "dialogue", "centered"]);
    expect(ed.getHTML()).toContain('data-sp-dual="1"');
  });
});

describe("writing speed", () => {
  let context: ScriptContext | null = null;
  let shown: (SuggestInfo | null)[] = [];

  function write(content: string, known: ScriptContext | null = null): Editor {
    context = known;
    shown = [];
    editor = new Editor({
      extensions: [
        ...screenplayStarterKit(),
        BlockId,
        Screenplay.configure({ context: () => context, onSuggest: (info) => shown.push(info) }),
      ],
      content,
    });
    editor.commands.focus("end");
    return editor;
  }

  const labels = (ed: Editor) => currentSuggestions(ed)?.items.map((i) => i.label) ?? [];
  const text = (ed: Editor) => lines(ed).map(([, t]) => t);

  describe("capitals as they are typed", () => {
    it("makes what is typed into a heading, a cue, a transition or a shot capitals", () => {
      for (const el of ["scene-heading", "character", "transition", "shot"]) {
        const ed = write(`<p data-sp="${el}"></p>`);
        type(ed, "int. lab - día");
        expect(text(ed)).toEqual(["INT. LAB - DÍA"]);
        ed.destroy();
      }
    });

    it("leaves action, dialogue and parentheticals as typed", () => {
      for (const el of ["", ' data-sp="dialogue"', ' data-sp="parenthetical"']) {
        const ed = write(`<p${el}></p>`);
        type(ed, "Hello there");
        expect(text(ed)).toEqual(["Hello there"]);
        ed.destroy();
      }
    });

    it("leaves text that is already there as it was, and capitals only what is added to it", () => {
      const ed = write('<p data-sp="character">mara</p>');
      type(ed, "h");
      expect(text(ed)).toEqual(["maraH"]);
    });

    it("does not touch a line whose element this build does not know", () => {
      const ed = write('<p data-sp="centered"></p>');
      type(ed, "the end");
      expect(text(ed)).toEqual(["the end"]);
      expect(elements(ed)).toEqual(["centered"]);
    });

    it("keeps the element when Tab walks a line through the capitals elements", () => {
      const ed = write("<p></p>");
      type(ed, "Mara runs");
      press(ed, "Tab");
      press(ed, "Tab", true);
      expect(text(ed)).toEqual(["Mara runs"]);
    });
  });

  describe("Tab through a heading", () => {
    it("goes from INT. to the location to the time of day to the next element", () => {
      const ed = write('<p data-sp="scene-heading"></p>');
      type(ed, "int.");
      expect(press(ed, "Tab")).toBe(true);
      expect(text(ed)).toEqual(["INT. "]);
      type(ed, "lab");
      press(ed, "Tab");
      expect(text(ed)).toEqual(["INT. LAB - "]);
      type(ed, "night");
      expect(text(ed)).toEqual(["INT. LAB - NIGHT"]);
      press(ed, "Tab");
      expect(lines(ed)).toEqual([
        ["scene-heading", "INT. LAB - NIGHT"],
        [null, ""],
      ]);
    });

    it("adds only the dash when the location already ends in a space", () => {
      const ed = write('<p data-sp="scene-heading">INT. LAB </p>');
      press(ed, "Tab");
      expect(text(ed)).toEqual(["INT. LAB - "]);
    });

    it("gives a prefix typed without its dot the dot", () => {
      const ed = write('<p data-sp="scene-heading"></p>');
      type(ed, "int");
      expect(labels(ed)).toEqual(["INT.", "INT./EXT."]);
      press(ed, "Tab");
      expect(text(ed)).toEqual(["INT. "]);
      ed.destroy();
      const dismissed = write('<p data-sp="scene-heading"></p>');
      type(dismissed, "ext");
      press(dismissed, "Escape");
      press(dismissed, "Tab");
      expect(text(dismissed)).toEqual(["EXT. "]);
      dismissed.destroy();
      const located = write('<p data-sp="scene-heading">INT LAB</p>');
      press(located, "Escape");
      press(located, "Tab");
      expect(text(located)).toEqual(["INT. LAB - "]);
    });

    it("only walks when the caret is at the end of the line", () => {
      const ed = write('<p data-sp="scene-heading">INT.</p>');
      ed.commands.setTextSelection(3);
      press(ed, "Tab");
      expect(text(ed)).toEqual(["INT."]);
      expect(elements(ed)).toEqual([null]);
    });
  });

  describe("Tab from a cue", () => {
    it("starts a parenthetical under a cue with a name", () => {
      const ed = write('<p data-sp="character">MARA</p>');
      press(ed, "Tab");
      expect(lines(ed)).toEqual([
        ["character", "MARA"],
        ["parenthetical", ""],
      ]);
    });

    it("still walks the ring from an empty cue", () => {
      const ed = write('<p data-sp="character"></p>');
      press(ed, "Tab");
      expect(elements(ed)).toEqual(["dialogue"]);
    });
  });

  describe("the popup", () => {
    const known: ScriptContext = { sequences: [[{ element: "scene-heading", text: "INT. LAB - NIGHT" }]], names: ["Mara", "Marcus", "Priya"] };

    it("offers names from the story bible before they are used, once a letter is typed", () => {
      const ed = write('<p data-sp="character"></p>', known);
      expect(labels(ed)).toEqual([]);
      type(ed, "p");
      expect(labels(ed)).toEqual(["PRIYA"]);
      expect(shown.at(-1)?.items.map((i) => i.label)).toBeUndefined();
    });

    it("offers names the script already uses, most used first", () => {
      const ed = write(
        '<p data-sp="character">MARA</p><p data-sp="dialogue">Hi.</p><p data-sp="character">JONAH</p><p data-sp="dialogue">Hey.</p><p data-sp="character">MARA</p><p data-sp="dialogue">Yes.</p><p data-sp="character"></p>'
      );
      type(ed, "m");
      expect(labels(ed)).toEqual(["MARA"]);
      type(ed, "ara");
      expect(labels(ed)).toEqual([]);
    });

    it("takes the first choice on Tab", () => {
      const ed = write('<p data-sp="character"></p>', known);
      type(ed, "pr");
      expect(press(ed, "Tab")).toBe(true);
      expect(text(ed)).toEqual(["PRIYA"]);
      expect(labels(ed)).toEqual([]);
      press(ed, "Tab");
      expect(lines(ed)).toEqual([
        ["character", "PRIYA"],
        ["parenthetical", ""],
      ]);
    });

    it("walks the places and the times of day on a heading", () => {
      const ed = write('<p data-sp="scene-heading"></p>', known);
      type(ed, "int. ");
      expect(labels(ed)).toEqual(["LAB"]);
      press(ed, "Tab");
      expect(text(ed)).toEqual(["INT. LAB - "]);
      expect(labels(ed)[0]).toBe("NIGHT");
      press(ed, "Tab");
      expect(text(ed)).toEqual(["INT. LAB - NIGHT"]);
      expect(labels(ed)).toEqual([]);
    });

    it("moves the highlight with the arrow keys and takes it on Enter", () => {
      const ed = write('<p data-sp="character"></p>', known);
      type(ed, "m");
      expect(labels(ed)).toEqual(["MARA", "MARCUS"]);
      expect(press(ed, "ArrowDown")).toBe(true);
      expect(currentSuggestions(ed)?.selected).toBe(1);
      expect(press(ed, "Enter")).toBe(true);
      expect(lines(ed)).toEqual([["character", "MARCUS"]]);
      expect(labels(ed)).toEqual([]);
    });

    it("does not take a choice on Enter that was never walked to", () => {
      const ed = write('<p data-sp="character"></p>', known);
      type(ed, "m");
      press(ed, "Enter");
      expect(lines(ed)).toEqual([
        ["character", "M"],
        ["dialogue", ""],
      ]);
    });

    it("wraps the highlight around and goes back up", () => {
      const ed = write('<p data-sp="character"></p>', known);
      type(ed, "m");
      press(ed, "ArrowUp");
      expect(currentSuggestions(ed)?.selected).toBe(1);
      press(ed, "ArrowDown");
      expect(currentSuggestions(ed)?.selected).toBe(0);
    });

    it("offers nothing on a plain line, so the arrow keys are the editor's", () => {
      const ed = write("<p>Plain</p>", known);
      expect(currentSuggestions(ed)).toBeNull();
    });

    it("closes on Escape until the line changes", () => {
      const ed = write('<p data-sp="character"></p>', known);
      type(ed, "m");
      expect(press(ed, "Escape")).toBe(true);
      expect(labels(ed)).toEqual([]);
      type(ed, "a");
      expect(labels(ed)).toEqual(["MARA", "MARCUS"]);
    });

    it("is not offered on action or dialogue", () => {
      const ed = write("<p></p>", known);
      type(ed, "m");
      expect(labels(ed)).toEqual([]);
    });

    it("lets Tab move on when the line already says what the choice would", () => {
      const ed = write('<p data-sp="character">MARA</p>', {
        sequences: [[{ element: "character", text: "MARA" }]],
        names: [],
      });
      expect(labels(ed)).toEqual([]);
      expect(acceptSuggestion(ed)).toBe(false);
      press(ed, "Tab");
      expect(elements(ed)).toEqual(["character", "parenthetical"]);
    });

    it("reports the choices to the page and closes it when they go", () => {
      const ed = write('<p data-sp="character"></p>', known);
      ed.view.hasFocus = () => true;
      type(ed, "pr");
      expect(shown.at(-1)?.items.map((i) => i.label)).toEqual(["PRIYA"]);
      expect(shown.at(-1)?.selected).toBe(0);
      type(ed, "iya");
      expect(shown.at(-1)).toBeNull();
    });
  });

  describe("CONT'D", () => {
    const speech =
      '<p data-sp="scene-heading">INT. LAB - NIGHT</p><p data-sp="character">MARA</p><p data-sp="dialogue">Hello.</p><p>She turns away.</p>';

    it("is added to a cue for the same speaker after an action line", () => {
      const ed = write(`${speech}<p data-sp="character">MARA</p>`);
      press(ed, "Enter");
      expect(lines(ed).slice(-2)).toEqual([
        ["character", "MARA (CONT'D)"],
        ["dialogue", ""],
      ]);
    });

    it("is not added for someone else, or twice", () => {
      const other = write(`${speech}<p data-sp="character">JONAH</p>`);
      press(other, "Enter");
      expect(text(other).slice(-2)).toEqual(["JONAH", ""]);
      other.destroy();
      const twice = write(`${speech}<p data-sp="character">MARA (CONT'D)</p>`);
      press(twice, "Enter");
      expect(text(twice).slice(-2)).toEqual(["MARA (CONT'D)", ""]);
    });

    it("is offered by the popup too", () => {
      const ed = write(`${speech}<p data-sp="character"></p>`);
      type(ed, "m");
      expect(labels(ed)).toEqual(["MARA (CONT'D)", "MARA"]);
    });

    it("is neither added nor offered in a language the extensions do not cover", () => {
      const unsupported: ScriptContext = { sequences: [], names: [], extensions: false };
      const ed = write(`${speech}<p data-sp="character">MARA</p>`, unsupported);
      press(ed, "Enter");
      expect(text(ed).slice(-2)).toEqual(["MARA", ""]);
      ed.destroy();
      const popup = write(`${speech}<p data-sp="character"></p>`, unsupported);
      type(popup, "m");
      expect(labels(popup)).toEqual(["MARA"]);
    });
  });

  describe("extensions on a cue", () => {
    it("toggles V.O., O.S. and CONT'D and keeps the caret at the end", () => {
      const ed = write('<p data-sp="character">MARA</p>');
      expect(toggleCueExtension(ed, "V.O.")).toBe(true);
      expect(text(ed)).toEqual(["MARA (V.O.)"]);
      expect(toggleCueExtension(ed, "CONT'D")).toBe(true);
      expect(text(ed)).toEqual(["MARA (V.O.) (CONT'D)"]);
      expect(toggleCueExtension(ed, "O.S.")).toBe(true);
      expect(text(ed)).toEqual(["MARA (O.S.) (CONT'D)"]);
      expect(toggleCueExtension(ed, "O.S.")).toBe(true);
      expect(text(ed)).toEqual(["MARA (CONT'D)"]);
      type(ed, "!");
      expect(text(ed)).toEqual(["MARA (CONT'D)!"]);
    });

    it("does nothing off a cue, or on a cue with no name", () => {
      expect(toggleCueExtension(write("<p>Plain</p>"), "V.O.")).toBe(false);
      expect(toggleCueExtension(write('<p data-sp="character"></p>'), "V.O.")).toBe(false);
    });
  });

  describe("scenes", () => {
    const script =
      '<p data-sp="scene-heading">INT. A - DAY</p><p>One.</p><p data-sp="scene-heading">INT. B - DAY</p><p>Two.</p><p data-sp="scene-heading">INT. C - DAY</p><p>Three.</p>';

    it("moves a scene to where another is, with its blocks, and keeps the caret in it", () => {
      const ed = write(script);
      ed.commands.setTextSelection(ed.state.doc.content.size - 3);
      expect(moveScene(ed, 2, 1)).toBe(true);
      expect(text(ed)).toEqual(["INT. A - DAY", "One.", "INT. C - DAY", "Three.", "INT. B - DAY", "Two."]);
      expect(ed.state.selection.$from.parent.textContent).toBe("Three.");
    });

    it("moves a scene up", () => {
      const ed = write(script);
      expect(moveScene(ed, 0, 1)).toBe(true);
      expect(text(ed)).toEqual(["INT. B - DAY", "Two.", "INT. A - DAY", "One.", "INT. C - DAY", "Three."]);
    });

    it("keeps every block's id, and the elements", () => {
      const ed = write(script);
      const ids = () => {
        const out: string[] = [];
        ed.state.doc.forEach((n) => out.push(n.attrs.blockId ?? n.attrs.id ?? ""));
        return out;
      };
      const before = ids().sort();
      moveScene(ed, 0, 2);
      expect(ids().sort()).toEqual(before);
      expect(elements(ed)).toEqual(["scene-heading", null, "scene-heading", null, "scene-heading", null]);
    });

    it("refuses a move to where it already is", () => {
      const ed = write(script);
      expect(moveScene(ed, 1, 1)).toBe(false);
      expect(text(ed)[0]).toBe("INT. A - DAY");
    });
  });
});
