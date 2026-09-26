import { describe, expect, it } from "vitest";
import {
  normalizeContent,
  parseReviewJson,
  reviewDue,
  REVIEW_DUE_MS,
} from "@/lib/weekly-review-view";

describe("weekly review view helpers", () => {
  it("parses fenced and prose-wrapped model JSON", () => {
    const body = '{"summary":"A good week.","looseEnds":["Who has the key?"],"nextSteps":["Write the ferry scene."]}';
    expect(parseReviewJson(body)?.summary).toBe("A good week.");
    expect(parseReviewJson("```json\n" + body + "\n```")?.looseEnds).toEqual(["Who has the key?"]);
    expect(parseReviewJson("Here you go: " + body)?.nextSteps).toEqual(["Write the ferry scene."]);
  });

  it("rejects output with no summary or no JSON", () => {
    expect(parseReviewJson("nope")).toBeNull();
    expect(parseReviewJson('{"looseEnds":["x"]}')).toBeNull();
  });

  it("drops non-string and blank list items and caps the lists", () => {
    const content = normalizeContent({
      summary: " ok ",
      looseEnds: ["a", 3, "  ", null, ...Array.from({ length: 20 }, (_, i) => `q${i}`)],
      nextSteps: "not a list",
    });
    expect(content.summary).toBe("ok");
    expect(content.looseEnds).toHaveLength(8);
    expect(content.looseEnds[0]).toBe("a");
    expect(content.nextSteps).toEqual([]);
  });

  it("is due with no reviews, or once the newest is a week old", () => {
    const now = Date.parse("2026-09-26T12:00:00Z");
    expect(reviewDue([], now)).toBe(true);
    const fresh = new Date(now - 60_000).toISOString();
    const stale = new Date(now - REVIEW_DUE_MS).toISOString();
    expect(reviewDue([{ createdAt: fresh }], now)).toBe(false);
    expect(reviewDue([{ createdAt: stale }, { createdAt: fresh }], now)).toBe(false);
    expect(reviewDue([{ createdAt: stale }], now)).toBe(true);
  });
});
