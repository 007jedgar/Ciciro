import { elementTagAtCaret, predictElementTags } from "../lib/screenplay-live";

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
});
