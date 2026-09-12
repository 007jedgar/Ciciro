import { describe, expect, it } from "vitest";
import { htmlToDoc } from "@/lib/manuscript";
import {
  blockTextById,
  clampBlockOffset,
  resumePlainTextIndex,
} from "@/lib/reading-caret";

describe("reading caret", () => {
  const html =
    '<p data-block-id="b1">The lantern was still burning.</p><p data-block-id="b2">Later.</p>';

  it("clamps offsets to the block text", () => {
    expect(clampBlockOffset("abc", -2)).toBe(0);
    expect(clampBlockOffset("abc", 9)).toBe(3);
    expect(blockTextById(html, "b1")).toBe("The lantern was still burning.");
  });

  it("maps a mid-sentence caret onto plain text", () => {
    expect(resumePlainTextIndex(html, "b1", 4)).toBe(4);
    const second = htmlToDoc(html, 0).doc.blocks[0]!.text.length + 2 + 0;
    expect(resumePlainTextIndex(html, "b2", 0)).toBe(second);
    expect(resumePlainTextIndex(html, "missing", 0)).toBeNull();
  });
});
