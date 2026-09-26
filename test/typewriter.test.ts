import { describe, expect, it } from "vitest";
import { TYPEWRITER_DEADBAND, typewriterScrollDelta } from "@/lib/typewriter";

describe("typewriterScrollDelta", () => {
  it("scrolls down when the caret is below center", () => {
    expect(typewriterScrollDelta(500, 520, 0, 600)).toBe(210);
  });
  it("scrolls up when the caret is above center", () => {
    expect(typewriterScrollDelta(100, 120, 0, 600)).toBe(-190);
  });
  it("accounts for the container offset", () => {
    expect(typewriterScrollDelta(348, 372, 48, 624)).toBe(0);
  });
  it("ignores drift inside the deadband", () => {
    expect(typewriterScrollDelta(300 + TYPEWRITER_DEADBAND - 2, 300 + TYPEWRITER_DEADBAND - 2, 0, 600)).toBe(0);
  });
});
