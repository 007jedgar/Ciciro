import { describe, expect, it } from "vitest";
import { backstageLine } from "@/lib/backstage";

describe("backstageLine", () => {
  it("always returns a non-empty status line", () => {
    for (const action of ["read_chapter", "dispatch_draft", "unknown_tool", ""]) {
      expect(backstageLine(action).length).toBeGreaterThan(0);
    }
  });

  it("appends a detail suffix for retrieval actions", () => {
    expect(backstageLine("read_chapter", "Chapter 3").endsWith("· Chapter 3")).toBe(true);
    expect(backstageLine("search_manuscript", "the storm").endsWith("· the storm")).toBe(
      true
    );
  });

  it("does not append a detail suffix for non-retrieval actions", () => {
    expect(backstageLine("append_canon", "ignored")).not.toContain("·");
  });

  it("keeps Ciciro as the only voice (no model names leak)", () => {
    const lines = [
      backstageLine("dispatch_draft"),
      backstageLine("read_bible", "mara.md"),
      backstageLine("compact", "12 pages"),
    ];
    for (const line of lines) {
      expect(line.toLowerCase()).not.toContain("sonnet");
      expect(line.toLowerCase()).not.toContain("haiku");
      expect(line.toLowerCase()).not.toContain("opus");
    }
  });
});
