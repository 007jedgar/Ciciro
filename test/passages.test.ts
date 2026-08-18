import { describe, expect, it } from "vitest";
import fixture from "./fixtures/malformed-manuscript.json";
import {
  countPassageOccurrences,
  deletePassageRange,
  normalizePassageComparison,
  splitChapterHtmlAt,
} from "@/lib/passages";

describe("structural passage operations", () => {
  it("splits a fused inline boundary without losing either side", () => {
    const source = fixture.chapters[0].content;
    const split = splitChapterHtmlAt(source, fixture.boundary, 1, 2);
    expect(split).not.toHaveProperty("error");
    if ("error" in split) return;

    expect(normalizePassageComparison(split.sourceContent)).toBe(
      normalizePassageComparison(
        "The hospital improvised a hastily assembled press conference featuring the Surgeon"
      )
    );
    expect(split.destinationContent).not.toContain(fixture.boundary);
    expect(normalizePassageComparison(split.destinationContent)).toContain(
      normalizePassageComparison(fixture.duplicatePassage)
    );
  });

  it("deletes inclusive paragraph ranges and refreshes their index", () => {
    const result = deletePassageRange(
      "<p>Keep this.</p><p>Delete one.</p><p>Delete two.</p><p>Keep that.</p>",
      1,
      "ch1.p2-p3"
    );
    expect(result).not.toHaveProperty("error");
    if ("error" in result) return;

    expect(normalizePassageComparison(result.content)).toBe("keep this. keep that.");
    expect(result.index.paragraphs.map((passage) => passage.id)).toEqual([
      "ch1.p1",
      "ch1.p2",
    ]);
  });

  it("detects normalized duplicates in the destination fixture", () => {
    const destination = fixture.chapters[1].content;
    expect(countPassageOccurrences(destination, fixture.duplicatePassage)).toBe(1);
    expect(
      countPassageOccurrences(
        destination,
        "<p>THE CAMERAS FOUND DR. VALE BEFORE SHE FOUND THE PODIUM.</p> " +
          "<p>She denied the accusation without looking at her notes.</p>"
      )
    ).toBe(1);
  });
});
