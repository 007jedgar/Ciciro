import { applyPlainEdit, parseInlineHtml, serializeInlineHtml } from "../lib/inline-html";

describe("inline html marks", () => {
  it("round-trips mixed marks", () => {
    const inner = "H<strong>el</strong>lo";
    expect(serializeInlineHtml(parseInlineHtml(inner))).toBe(inner);
  });

  it("keeps neighboring marks when typing inside a run", () => {
    expect(applyPlainEdit("H<strong>el</strong>lo", "Helxlo")).toBe("H<strong>elx</strong>lo");
    expect(applyPlainEdit("<strong>Old</strong>", "New")).toBe("<strong>New</strong>");
    expect(applyPlainEdit("H<strong>e</strong>llo", "Hello!")).toBe("H<strong>e</strong>llo!");
  });
});
