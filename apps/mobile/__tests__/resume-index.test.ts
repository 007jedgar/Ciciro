import { blocksPlainText } from "../lib/read-aloud-text";
import { resumePlainTextIndex } from "../lib/manuscript";

describe("resumePlainTextIndex", () => {
  const html =
    '<p data-block-id="a">EXT. ROOFTOP - DAY</p><p data-block-id="b">Wind.</p><p data-block-id="c">INT. LAB - NIGHT</p>';

  it("counts one newline between blocks, as the editor's text does", () => {
    const text = blocksPlainText(html);
    const at = resumePlainTextIndex(html, "c", 0);
    expect(at).toBe(text.indexOf("INT. LAB"));
    expect(resumePlainTextIndex(html, "c", 4)).toBe(text.indexOf("INT. LAB") + 4);
  });

  it("is null for a block that is gone", () => {
    expect(resumePlainTextIndex(html, "missing", 0)).toBeNull();
  });
});
