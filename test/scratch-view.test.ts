import { describe, expect, it } from "vitest";
import { scratchNoteUpdated } from "@/lib/scratch-view";

describe("scratchNoteUpdated", () => {
  const now = new Date(2026, 8, 26, 9, 0);
  const at = (d: Date) => d.toISOString();

  it("labels recent edits in minutes and hours", () => {
    expect(scratchNoteUpdated(at(new Date(2026, 8, 26, 8, 59, 30)), now)).toBe("updated now");
    expect(scratchNoteUpdated(at(new Date(2026, 8, 26, 8, 45)), now)).toBe("updated 15m ago");
    expect(scratchNoteUpdated(at(new Date(2026, 8, 26, 6, 0)), now)).toBe("updated 3h ago");
  });

  it("calls the previous calendar day yesterday", () => {
    expect(scratchNoteUpdated(at(new Date(2026, 8, 25, 23, 0)), now)).toBe("updated yesterday");
    expect(scratchNoteUpdated(at(new Date(2026, 8, 25, 1, 0)), now)).toBe("updated yesterday");
  });

  it("counts calendar days within a week, then shows the date", () => {
    expect(scratchNoteUpdated(at(new Date(2026, 8, 24, 20, 0)), now)).toBe("updated 2d ago");
    expect(scratchNoteUpdated(at(new Date(2026, 8, 10, 12, 0)), now)).toMatch(/^updated \S+/);
    expect(scratchNoteUpdated(at(new Date(2026, 8, 10, 12, 0)), now)).not.toMatch(/ago|yesterday/);
  });
});
