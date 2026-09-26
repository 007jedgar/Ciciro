import { describe, expect, it } from "vitest";
import { locateCommentAnchor, sanitizeReaderHtml } from "@/lib/share-html";
import { isShareTokenShape, nearestOccurrence, shareLinkStatus } from "@/lib/share-view";

describe("sanitizeReaderHtml", () => {
  it("keeps formatting and block ids", () => {
    const html =
      '<h2 data-block-id="h">Title</h2><p data-block-id="a">One <em>two</em> <strong>three</strong><br>four</p>' +
      '<blockquote data-block-id="q"><p data-block-id="q1">Quoted</p></blockquote>' +
      '<ul><li data-block-id="l"><p>Item</p></li></ul><hr data-block-id="s">';
    expect(sanitizeReaderHtml(html)).toBe(html.replace('<hr data-block-id="s">', '<hr data-block-id="s">'));
  });

  it("drops attributes, unknown tags, and executable content", () => {
    expect(
      sanitizeReaderHtml(
        '<p data-block-id="a" style="x" onclick="evil()" class="c">A<img src=x onerror=evil()>' +
          '<a href="javascript:evil()">B</a><script>evil()</script><style>p{}</style>' +
          "<iframe src=//x>inner</iframe><svg><script>evil()</script></svg>C</p>"
      )
    ).toBe('<p data-block-id="a">ABC</p>');
  });

  it("drops a block id that could break out of its attribute", () => {
    expect(sanitizeReaderHtml('<p data-block-id="a&quot; onclick=&quot;x">T</p>')).toBe("<p>T</p>");
    expect(sanitizeReaderHtml("<p data-block-id='a b'>T</p>")).toBe("<p>T</p>");
  });

  it("re-escapes text and drops comments", () => {
    expect(sanitizeReaderHtml("<p>&lt;script&gt;x&lt;/script&gt; &amp; &#60;b&#62; <!-- note --></p>")).toBe(
      "<p>&lt;script&gt;x&lt;/script&gt; &amp; &lt;b&gt; </p>"
    );
    expect(sanitizeReaderHtml("<p>a&nbsp;b \"q\" 'r'</p>")).toBe("<p>a&nbsp;b &quot;q&quot; &#39;r&#39;</p>");
  });

  it("drops everything after an unclosed script", () => {
    expect(sanitizeReaderHtml("<p>ok</p><script>evil()<p>more</p>")).toBe("<p>ok</p>");
  });
});

describe("locateCommentAnchor", () => {
  const html = '<p data-block-id="a">The cold hall was cold.</p><p data-block-id="b">A cold <em>night</em>.</p>';

  it("picks the occurrence nearest where the reader saw it", () => {
    expect(locateCommentAnchor(html, { blockId: "a", quote: "cold", offset: 17 })).toEqual({
      blockId: "a",
      offset: 18,
      length: 4,
    });
    expect(locateCommentAnchor(html, { blockId: "a", quote: "cold", offset: 0 })).toEqual({
      blockId: "a",
      offset: 4,
      length: 4,
    });
  });

  it("looks in other paragraphs when the quote left its own", () => {
    expect(locateCommentAnchor(html, { blockId: "a", quote: "cold night", offset: 0 })).toEqual({
      blockId: "b",
      offset: 2,
      length: 10,
    });
  });

  it("falls back to the paragraph, then to nothing", () => {
    expect(locateCommentAnchor(html, { blockId: "b", quote: "warm", offset: 40 })).toEqual({
      blockId: "b",
      offset: 13,
      length: 0,
    });
    expect(locateCommentAnchor(html, { blockId: "gone", quote: "warm", offset: 0 })).toBeNull();
  });

  it("treats a non-breaking space as a space", () => {
    expect(nearestOccurrence("a b", "a b", 0)).toBe(0);
    expect(nearestOccurrence("a b", "a b", 0)).toBe(0);
  });
});

describe("share link helpers", () => {
  it("derives a link's status", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    expect(shareLinkStatus({ expiresAt: null, revokedAt: null }, now)).toBe("active");
    expect(shareLinkStatus({ expiresAt: "2026-01-11T00:00:00Z", revokedAt: null }, now)).toBe("active");
    expect(shareLinkStatus({ expiresAt: "2026-01-10T00:00:00Z", revokedAt: null }, now)).toBe("expired");
    expect(shareLinkStatus({ expiresAt: "2026-01-11T00:00:00Z", revokedAt: "2026-01-09T00:00:00Z" }, now)).toBe(
      "revoked"
    );
  });

  it("only accepts token-shaped strings", () => {
    expect(isShareTokenShape("A".repeat(43))).toBe(true);
    expect(isShareTokenShape("A".repeat(42))).toBe(false);
    expect(isShareTokenShape(`${"A".repeat(42)}/`)).toBe(false);
    expect(isShareTokenShape(undefined)).toBe(false);
  });
});
