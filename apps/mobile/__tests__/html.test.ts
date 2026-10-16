import { htmlToPlainText, isChapterEmpty } from "../lib/html";

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
});

describe("htmlToPlainText numeric entities", () => {
  it("decodes the entities Android's editor writes for every non-ASCII letter", () => {
    expect(htmlToPlainText("<p>La ma&#241;ana era fr&#237;a, as&#xED; que &#x1F30A; &#2344;&#2366;&#2357;</p>")).toBe(
      "La mañana era fría, así que 🌊 नाव"
    );
  });

  it("leaves an escaped numeric entity as text and an impossible one alone", () => {
    expect(htmlToPlainText("<p>&amp;#241; &#0; &#xD800; &#1114112;</p>")).toBe("&#241; &#0; &#xD800; &#1114112;");
  });
});

describe("isChapterEmpty", () => {
  it("treats blank TipTap shells as empty", () => {
    expect(isChapterEmpty("")).toBe(true);
    expect(isChapterEmpty("<p></p>")).toBe(true);
    expect(isChapterEmpty("<p>&nbsp;</p>")).toBe(true);
    expect(isChapterEmpty(null)).toBe(true);
  });

  it("treats prose as not empty", () => {
    expect(isChapterEmpty("<p>Hello</p>")).toBe(false);
  });
});
