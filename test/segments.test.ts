import { describe, expect, it } from "vitest";
import { joinSegments, parseSegments } from "@/lib/segments";

describe("parseSegments", () => {
  it("treats plain prose as a single markdown segment", () => {
    expect(parseSegments("just some prose")).toEqual([
      { kind: "md", text: "just some prose" },
    ]);
  });

  it("splits markdown around a closed draft block", () => {
    expect(parseSegments("before <draft>the prose</draft> after")).toEqual([
      { kind: "md", text: "before " },
      { kind: "draft", text: "the prose", open: false },
      { kind: "md", text: " after" },
    ]);
  });

  it("marks an unterminated draft block as open (streaming)", () => {
    expect(parseSegments("lead-in <draft>still writing")).toEqual([
      { kind: "md", text: "lead-in " },
      { kind: "draft", text: "still writing", open: true },
    ]);
  });

  it("handles multiple draft blocks", () => {
    const segs = parseSegments("a<draft>one</draft>b<draft>two</draft>");
    expect(segs).toEqual([
      { kind: "md", text: "a" },
      { kind: "draft", text: "one", open: false },
      { kind: "md", text: "b" },
      { kind: "draft", text: "two", open: false },
    ]);
  });
});

describe("joinSegments", () => {
  it("round-trips closed and open drafts", () => {
    const inputs = [
      "before <draft>the prose</draft> after",
      "lead-in <draft>still writing",
      "a<draft>one</draft>b<draft>two</draft>",
      "no drafts at all",
    ];
    for (const input of inputs) {
      expect(joinSegments(parseSegments(input))).toBe(input);
    }
  });
});
