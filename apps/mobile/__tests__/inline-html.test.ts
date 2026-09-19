import {
  applyPlainEdit,
  marksCovering,
  parseInlineHtml,
  serializeInlineHtml,
  splitInnerHtml,
  toggleMarkInRange,
} from "../lib/inline-html";

describe("inline html marks", () => {
  it("round-trips mixed marks", () => {
    const inner = "H<strong>el</strong>lo";
    expect(serializeInlineHtml(parseInlineHtml(inner))).toBe(inner);
  });

  it("toggles a single character when the range is collapsed", () => {
    expect(toggleMarkInRange("Hello", 1, 1, "bold")).toBe("H<strong>e</strong>llo");
    expect(toggleMarkInRange("Hello", 5, 5, "italic")).toBe("Hell<em>o</em>");
  });

  it("toggles only the selected range", () => {
    expect(toggleMarkInRange("Hello", 1, 3, "bold")).toBe("H<strong>el</strong>lo");
    expect(toggleMarkInRange("H<strong>el</strong>lo", 1, 3, "bold")).toBe("Hello");
  });

  it("keeps neighboring marks when typing inside a run", () => {
    expect(applyPlainEdit("H<strong>el</strong>lo", "Helxlo")).toBe("H<strong>elx</strong>lo");
    expect(applyPlainEdit("<strong>Old</strong>", "New")).toBe("<strong>New</strong>");
    expect(applyPlainEdit("H<strong>e</strong>llo", "Hello!")).toBe("H<strong>e</strong>llo!");
  });

  it("reports marks covering a caret or a highlight", () => {
    expect(marksCovering("H<strong>el</strong>lo", 1, 3)).toEqual({
      bold: true,
      italic: false,
      underline: false,
      strike: false,
    });
    expect(marksCovering("H<strong>el</strong>lo", 1, 1).bold).toBe(true);
    expect(marksCovering("H<strong>el</strong>lo", 2, 2).bold).toBe(true);
    expect(marksCovering("H<strong>el</strong>lo", 0, 3).bold).toBe(false);
  });

  it("splits inner html without flattening marks", () => {
    expect(splitInnerHtml("<strong>Hello world.</strong>", 5)).toEqual({
      left: "<strong>Hello</strong>",
      right: "<strong> world.</strong>",
    });
  });
});
