import { htmlToPlainText } from "../lib/html";

describe("htmlToPlainText", () => {
  it("turns TipTap-ish HTML into readable paragraphs", () => {
    expect(
      htmlToPlainText("<p>First.</p><p>Second<br/>line.</p><h2>Heading</h2><p>Last.</p>")
    ).toBe("First.\n\nSecond\nline.\n\nHeading\n\nLast.");
  });

  it("decodes entities and collapses extra blank lines", () => {
    expect(htmlToPlainText("<p>Tom &amp; Ada &lt;3</p><p></p><p>Done.</p>")).toBe(
      "Tom & Ada <3\n\nDone."
    );
  });

  it("hides pending deletions so a phone reader sees the proposed line", () => {
    expect(
      htmlToPlainText(
        '<p>The <del data-suggestion="delete" data-suggestion-id="s">cat</del><ins data-suggestion="insert" data-suggestion-id="s">dog</ins> sat.</p>'
      )
    ).toBe("The dog sat.");
  });
});
