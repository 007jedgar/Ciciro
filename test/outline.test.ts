import { describe, expect, it } from "vitest";
import { applyChapterOrder, chapterBlurb, moveItem } from "@/lib/outline";
import type { Chapter } from "@/lib/types";

const ch = (id: string, order: number): Chapter => ({
  id,
  projectId: "p",
  title: id,
  order,
  content: "",
  summary: "",
  status: "draft",
  wordCount: 0,
  revision: 0,
});

describe("outline helpers", () => {
  it("moves an item and clamps the target", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b", "c"], 0, 9)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  it("applies an id order, renumbers, and keeps unlisted chapters last", () => {
    const out = applyChapterOrder([ch("a", 0), ch("b", 1), ch("c", 2)], ["c", "zzz", "a"]);
    expect(out.map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(out.map((c) => c.order)).toEqual([0, 1, 2]);
  });

  it("prefers the summary and falls back to a trimmed opening", () => {
    expect(chapterBlurb("  Beat.  ", "text")).toBe("Beat.");
    expect(chapterBlurb("", "a  b\n c")).toBe("a b c");
    expect(chapterBlurb("", "x".repeat(300))).toBe(`${"x".repeat(180)}...`);
  });
});
