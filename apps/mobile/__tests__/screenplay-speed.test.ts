import { chipsForLine, lineAtOffset } from "../lib/screenplay-speed";

describe("lineAtOffset", () => {
  const text = "INT. LAB - DAY\nMARA\nHello.";

  it("finds the line holding the caret, and whether it is at the end", () => {
    expect(lineAtOffset(text, 0)).toEqual({ start: 0, text: "INT. LAB - DAY", index: 0, atEnd: false });
    expect(lineAtOffset(text, 14)).toEqual({ start: 0, text: "INT. LAB - DAY", index: 0, atEnd: true });
    expect(lineAtOffset(text, 15)).toEqual({ start: 15, text: "MARA", index: 1, atEnd: false });
    expect(lineAtOffset(text, 19)).toEqual({ start: 15, text: "MARA", index: 1, atEnd: true });
    expect(lineAtOffset(text, 99).index).toBe(2);
  });

  it("reads an empty line", () => {
    expect(lineAtOffset("A\n", 2)).toEqual({ start: 2, text: "", index: 1, atEnd: true });
  });
});

describe("chipsForLine", () => {
  const html =
    '<p data-sp="scene-heading">INT. LAB - NIGHT</p><p data-sp="character">MARA</p><p data-sp="dialogue">Hi.</p>' +
    '<p>She goes.</p><p data-sp="character">MA</p>';
  const context = { others: ['<p data-sp="scene-heading">INT. LAB - NIGHT</p><p data-sp="character">MARCUS</p>'], html, names: ["Priya"] };
  const lines = ["INT. LAB - NIGHT", "MARA", "Hi.", "She goes.", "MA"];
  const live = (index: number, text: string) => ({ start: 0, text, index, atEnd: true });

  it("offers names, with CONT'D for a cue that picks a speech back up", () => {
    const chips = chipsForLine("character", live(4, "MA"), lines, context);
    expect(chips.map((c) => c.label)).toEqual(["MARA (CONT'D)", "MARA", "MARCUS"]);
  });

  it("offers the names on an empty cue", () => {
    const chips = chipsForLine("character", live(4, ""), [...lines.slice(0, 4), ""], context);
    expect(chips.map((c) => c.label)).toContain("PRIYA");
  });

  it("offers INT. and EXT. on an empty heading, then places, then times", () => {
    const empty = chipsForLine("scene-heading", live(0, ""), lines, context);
    expect(empty.map((c) => c.label)).toEqual(["INT.", "EXT.", "INT./EXT."]);
    expect(chipsForLine("scene-heading", live(0, "INT."), lines, context).map((c) => c.label)).toEqual(["LAB"]);
    expect(chipsForLine("scene-heading", live(0, "INT. LAB - "), lines, context)[0].label).toBe("NIGHT");
  });

  it("offers nothing off a cue or heading, or with the caret in the middle of a line", () => {
    expect(chipsForLine("dialogue", live(2, "Hi."), lines, context)).toEqual([]);
    expect(chipsForLine("character", { ...live(4, "MA"), atEnd: false }, lines, context)).toEqual([]);
  });

  it("does not offer what the line already says", () => {
    expect(chipsForLine("character", live(1, "MARCUS"), lines, context)).toEqual([]);
  });
});
