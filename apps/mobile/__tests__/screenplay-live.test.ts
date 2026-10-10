import { appendEmptyBlockOps, applyOpsToDoc, setBlockElementOps } from "../lib/block-editor";
import { blockAtPlainOffset, opsFromEnrichedHtml, restampCiciroHtml } from "../lib/enriched-html";
import { docToHtml, htmlToDoc } from "../lib/manuscript";
import { elementTagOfHtml } from "../lib/screenplay";
import { caretBeyondChapter, elementTagAtCaret, elementTargetId, predictElementTags } from "../lib/screenplay-live";

const block = (tag: string, text: string, id = text) =>
  `<p data-block-id="${id}"${tag === "action" ? "" : ` data-sp="${tag}"`}>${text}</p>`;

describe("the element under the caret before the editor flushes", () => {
  const script = [
    block("scene-heading", "INT. LAB - DAY"),
    block("action", "Mara waits."),
    block("character", "MARA"),
    block("dialogue", "Hello."),
  ].join("");

  const committed = [
    { text: "INT. LAB - DAY", tag: "scene-heading" },
    { text: "Mara waits.", tag: "action" },
    { text: "MARA", tag: "character" },
    { text: "Hello.", tag: "dialogue" },
  ];

  it("keeps every tag while only words change", () => {
    expect(predictElementTags(committed, ["INT. LAB - DAY", "Mara waits…", "MARA", "Hello."])).toEqual([
      "scene-heading",
      "action",
      "character",
      "dialogue",
    ]);
  });

  it("gives a line started with Return the element that follows the one above", () => {
    // Return at the end of the cue.
    expect(predictElementTags(committed, ["INT. LAB - DAY", "Mara waits.", "MARA", "", "Hello."])).toEqual([
      "scene-heading",
      "action",
      "character",
      "dialogue",
      "dialogue",
    ]);
    // Return at the end of the heading.
    expect(predictElementTags(committed, ["INT. LAB - DAY", "", "Mara waits.", "MARA", "Hello."])).toEqual([
      "scene-heading",
      "action",
      "action",
      "character",
      "dialogue",
    ]);
    // Return at the end of the dialogue: action follows.
    expect(predictElementTags(committed, [...committed.map((c) => c.text), ""])).toEqual([
      "scene-heading",
      "action",
      "character",
      "dialogue",
      "action",
    ]);
  });

  it("keeps the left half's element when Return splits a line, and chains several new lines", () => {
    expect(predictElementTags(committed, ["INT. LAB - DAY", "Mara", "waits.", "MARA", "Hello."])).toEqual([
      "scene-heading",
      "action",
      "action",
      "character",
      "dialogue",
    ]);
    // Two Returns in a row after a cue: dialogue, then action.
    expect(predictElementTags(committed, ["INT. LAB - DAY", "Mara waits.", "MARA", "", "", "Hello."])).toEqual([
      "scene-heading",
      "action",
      "character",
      "dialogue",
      "action",
      "dialogue",
    ]);
  });

  it("starts a line added above the first with nothing above it as action, and keeps the first tag on a merge", () => {
    expect(predictElementTags(committed, ["", ...committed.map((c) => c.text)])[0]).toBe("action");
    // Backspace joins MARA and Hello. into one line: it keeps the upper line's element.
    expect(predictElementTags(committed, ["INT. LAB - DAY", "Mara waits.", "MARAHello."])).toEqual([
      "scene-heading",
      "action",
      "character",
    ]);
  });

  it("carries a tag a newer client wrote through a prediction untouched", () => {
    const tags = predictElementTags(
      [
        { text: "THE END", tag: "centered" },
        { text: "Fade.", tag: "action" },
      ],
      ["THE END", "Fade.", ""]
    );
    expect(tags).toEqual(["centered", "action", "action"]);
  });

  it("finds the element at the caret from the live text the moment Return is pressed", () => {
    const live = "INT. LAB - DAY\nMara waits.\nMARA\n\nHello.";
    // Caret on the new empty line, just after "MARA\n": offset is the length of the first three lines + 3 newlines.
    const caret = "INT. LAB - DAY\nMara waits.\nMARA\n".length;
    expect(elementTagAtCaret(script, live, caret)).toBe("dialogue");
    // Before the flush it is still the committed chapter, so the same caret reads the old line.
    expect(elementTagAtCaret(script, null, "INT. LAB - DAY\nMara waits.\nMARA".length)).toBe("character");
  });

  it("reads the committed line when nothing was added or removed", () => {
    const live = "INT. LAB - DAY\nMara waits.\nMARA\nHello there.";
    expect(elementTagAtCaret(script, live, live.length)).toBe("dialogue");
    expect(elementTagAtCaret(script, live, 3)).toBe("scene-heading");
    expect(elementTagAtCaret("", null, 0)).toBe("action");
  });

  it("puts a caret past the end of the text on the line that follows the last one", () => {
    const text = "INT. LAB - DAY\nMara waits.\nMARA\nHello.";
    // The editor opened with a blank line the chapter does not hold yet: action follows dialogue.
    expect(elementTagAtCaret(script, null, text.length + 1)).toBe("action");
    // Return was just pressed and the caret event beat the text event: the same answer, a beat early.
    expect(elementTagAtCaret(script, text, text.length + 1)).toBe("action");
    // And a blank line after a cue is its dialogue.
    const cue = "INT. LAB - DAY\nMara waits.\nMARA";
    expect(elementTagAtCaret(block("character", "MARA"), null, "MARA".length + 1)).toBe("dialogue");
    expect(elementTagAtCaret(script.replace(block("dialogue", "Hello."), ""), null, cue.length + 1)).toBe("dialogue");
    // The caret at the very end is still on the last line.
    expect(elementTagAtCaret(script, null, text.length)).toBe("dialogue");
  });
});

describe("elementTargetId", () => {
  const prev =
    '<p data-block-id="a" data-sp="character">jonah</p><p data-block-id="b" data-sp="dialogue">You picked up.</p>';

  // The native view after Return at the end of the dialogue: a trailing <br> is the empty new line.
  const afterReturn = "<html>\n<p>jonah</p>\n<p>You picked up.</p>\n<br>\n</html>";
  const text = "jonah\nYou picked up.\n";

  function flushed(html: string, enriched: string) {
    const ops = opsFromEnrichedHtml(html, enriched, 1, undefined, { screenplay: true });
    return docToHtml(applyOpsToDoc(htmlToDoc(html, 1).doc, ops));
  }

  it("targets the new empty line, not the line above, once the flush has added it", () => {
    const content = flushed(prev, afterReturn);
    // The caret block id from before the flush is the dialogue line.
    const stale = blockAtPlainOffset(prev, text.length)?.blockId ?? "";
    expect(stale).toBe("b");
    const target = elementTargetId(content, text.length, stale);
    expect(target).not.toBe("b");

    const doc = htmlToDoc(content, 1).doc;
    const tagged = docToHtml(applyOpsToDoc(doc, setBlockElementOps(doc, target, "character")));
    expect(elementTagOfHtml(htmlToDoc(tagged, 1).doc.blocks[1].html)).toBe("dialogue");
    expect(elementTagOfHtml(htmlToDoc(tagged, 1).doc.blocks[2].html)).toBe("character");

    // Typing the name afterwards keeps the element the author chose, not the one Return would give.
    const typed = flushed(tagged, "<html>\n<p>jonah</p>\n<p>You picked up.</p>\n<p>MARA</p>\n</html>");
    expect(htmlToDoc(typed, 1).doc.blocks.map((b) => elementTagOfHtml(b.html))).toEqual([
      "character",
      "dialogue",
      "character",
    ]);
  });

  it("still finds the block the caret is in when nothing was added", () => {
    expect(elementTargetId(prev, 3, "zzz")).toBe("a");
    expect(elementTargetId(prev, text.length - 1, "zzz")).toBe("b");
  });
});

describe("an element chosen on a blank line the chapter does not hold", () => {
  const prev =
    '<p data-block-id="a" data-sp="character">jonah</p><p data-block-id="b" data-sp="dialogue">You picked up.</p>';
  const end = "jonah\nYou picked up.".length;

  it("knows the caret is past the end of the chapter", () => {
    expect(caretBeyondChapter(prev, end)).toBe(false);
    expect(caretBeyondChapter(prev, end + 1)).toBe(true);
    expect(caretBeyondChapter("", 1)).toBe(true);
    expect(caretBeyondChapter("", 0)).toBe(false);
  });

  it("gets a block of its own, and keeps the chosen element once the name is typed", () => {
    const doc = htmlToDoc(prev, 1).doc;
    const added = applyOpsToDoc(doc, appendEmptyBlockOps(doc, "character"));
    expect(added.blocks.map((b) => [elementTagOfHtml(b.html), b.text])).toEqual([
      ["character", "jonah"],
      ["dialogue", "You picked up."],
      ["character", ""],
    ]);
    // The line above is untouched, and the caret now finds the new block.
    expect(blockAtPlainOffset(docToHtml(added), end + 1)?.blockId).toBe(added.blocks[2].id);

    // The author types the name: the flush sees one more paragraph, as before, and keeps the tag.
    const typed = opsFromEnrichedHtml(docToHtml(added), "<html>\n<p>jonah</p>\n<p>You picked up.</p>\n<p>ANNA</p>\n</html>", 1, undefined, {
      screenplay: true,
    });
    const final = applyOpsToDoc(added, typed);
    expect(final.blocks.map((b) => [elementTagOfHtml(b.html), b.text])).toEqual([
      ["character", "jonah"],
      ["dialogue", "You picked up."],
      ["character", "ANNA"],
    ]);
  });
});

describe("the prediction is the flush's own rule", () => {
  const html = [
    block("scene-heading", "INT. LAB - DAY"),
    block("action", "Mara waits."),
    block("character", "MARA"),
    block("dialogue", "Hello."),
    block("character", ""),
  ].join("");
  const committed = htmlToDoc(html, 1).doc.blocks.map((b) => ({ id: b.id, kind: b.kind, text: b.text, tag: elementTagOfHtml(b.html) }));

  // Each is what the editor can show against the chapter above, before a flush.
  const edits: Record<string, string[]> = {
    "words changed": ["INT. LAB - DAY", "Mara waits more.", "MARA", "Hello.", ""],
    "Return at the end": ["INT. LAB - DAY", "Mara waits.", "MARA", "Hello.", "", ""],
    "a name typed into the blank line, then Return": ["INT. LAB - DAY", "Mara waits.", "MARA", "Hello.", "EVE", ""],
    "Return in the middle of a line": ["INT. LAB - DAY", "Mara", " waits.", "MARA", "Hello.", ""],
    "a line deleted": ["INT. LAB - DAY", "MARA", "Hello.", ""],
    "a line added at the top": ["", "INT. LAB - DAY", "Mara waits.", "MARA", "Hello.", ""],
    "several lines pasted": ["INT. LAB - DAY", "Mara waits.", "MARA", "Hello.", "One", "Two", "Three", ""],
  };

  for (const [name, live] of Object.entries(edits)) {
    it(`gives each line the tag restamp does: ${name}`, () => {
      const stamped = restampCiciroHtml(html, live.map((text) => `<p>${text}</p>`).join(""), { screenplay: true });
      const flushed = htmlToDoc(stamped, 1).doc.blocks.map((b) => elementTagOfHtml(b.html));
      expect(predictElementTags(committed, live)).toEqual(flushed);
    });
  }
});

describe("the blank line the editor does not report", () => {
  const upTo = [
    block("scene-heading", "INT. LAB - DAY"),
    block("character", "MARA"),
    block("dialogue", "Hello."),
  ].join("");
  const lines = "INT. LAB - DAY\nMARA\nHello.";
  // The author chose Character for the blank line: the chapter holds an empty block that carries it.
  const chosen = upTo + block("character", "", "chosen");

  it("is the element that follows the last line, until the author chooses one", () => {
    expect(elementTagAtCaret(upTo, lines + "\n", lines.length + 1)).toBe("action");
    expect(elementTagAtCaret(chosen, lines + "\n", lines.length + 1)).toBe("character");
  });

  it("takes the chosen element for the line typed into it, and what follows it for the next blank", () => {
    const typed = lines + "\nEVE\n";
    // Caret on EVE: the chosen block's element. On the blank after it: the cue's dialogue.
    expect(elementTagAtCaret(chosen, typed, lines.length + 4)).toBe("character");
    expect(elementTagAtCaret(chosen, typed, typed.length)).toBe("dialogue");
    // Without a choice, a name typed after dialogue is action, and so is the blank after it.
    expect(elementTagAtCaret(upTo, typed, lines.length + 4)).toBe("action");
    expect(elementTagAtCaret(upTo, typed, typed.length)).toBe("action");
  });

  it("counts one trailing blank as the blank line and any more as lines of their own", () => {
    const two = lines + "\n\n";
    // Caret on the first blank (a line of its own), then on the one after it.
    expect(elementTagAtCaret(upTo, two, lines.length + 1)).toBe("action");
    expect(elementTagAtCaret(upTo, two, two.length)).toBe("action");
  });
});
