import { describe, expect, it } from "vitest";
import { bigFontFor } from "@/lib/og/share-image";

// Pins the tier boundaries that stop a long author+title pairing from
// overflowing the fixed 1200x630 canvas (round 2 of owner review: the
// previous fixed size overflowed off the bottom of the image on a long
// pairing, and `overflow: hidden` does not reliably clip it in Satori, so
// the sentence must be sized to actually fit instead).
describe("bigFontFor", () => {
  it("stays at the largest size for a short sentence", () => {
    expect(bigFontFor(0)).toBe(72);
    expect(bigFontFor(75)).toBe(72);
  });

  it("steps down once the sentence runs long", () => {
    expect(bigFontFor(76)).toBe(58);
    expect(bigFontFor(110)).toBe(58);
    expect(bigFontFor(111)).toBe(48);
    expect(bigFontFor(140)).toBe(48);
    expect(bigFontFor(141)).toBe(40);
  });

  it("never returns a size below the smallest tier, even for an extreme pairing", () => {
    // The longest possible sentence given sharePreviewParts' bounds: a
    // 60-char author, "screenplay" (10) and an 80-char title, plus the
    // fixed connector text.
    const extreme = 60 + "is sending you their".length + "screenplay".length + 80;
    expect(bigFontFor(extreme)).toBe(40);
  });
});
