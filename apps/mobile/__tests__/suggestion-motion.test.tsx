import { render, screen, act } from "@testing-library/react-native";
import { RollingNumber } from "../components/RollingNumber";
import { COLLAPSE_MS, FLASH_MS, resolvingPieces } from "../lib/suggestion-review";
import type { SuggestionPiece } from "../lib/suggestions";

const pieces: SuggestionPiece[] = [
  { kind: "context", text: "She " },
  { kind: "delete", text: "walked slowly" },
  { kind: "insert", text: "ambled" },
];

describe("resolvingPieces", () => {
  it("accepting flashes the inserted words and shrinks the struck ones away", () => {
    const start = resolvingPieces(pieces, "accept", 0);
    expect(start.map((p) => p.role)).toEqual(["context", "collapsing", "kept"]);
    expect(start[1].text).toBe("walked slowly");
    expect(start[2].flash).toBe(1);

    const mid = resolvingPieces(pieces, "accept", COLLAPSE_MS / 2);
    expect(mid[1].text.length).toBeLessThan("walked slowly".length);
    expect(mid[1].text.length).toBeGreaterThan(0);
    expect(mid[2].flash).toBeGreaterThan(0.5);

    const done = resolvingPieces(pieces, "accept", FLASH_MS);
    expect(done[1].text).toBe("");
    expect(done[2].flash).toBe(0);
    expect(done[2].text).toBe("ambled");
  });

  it("rejecting is the mirror image", () => {
    const mid = resolvingPieces(pieces, "reject", COLLAPSE_MS / 2);
    expect(mid.map((p) => p.role)).toEqual(["context", "kept", "collapsing"]);
    expect(mid[1].text).toBe("walked slowly");
    expect(mid[2].text.length).toBeLessThan("ambled".length);
    expect(resolvingPieces(pieces, "reject", FLASH_MS)[2].text).toBe("");
  });

  it("leaves context alone and clamps time outside the animation", () => {
    expect(resolvingPieces(pieces, "accept", -50)[0]).toMatchObject({ text: "She ", role: "context" });
    expect(resolvingPieces(pieces, "accept", 99999)[2].flash).toBe(0);
  });
});

describe("RollingNumber", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("shows the number, and keeps the old one just long enough to slide it out", () => {
    const { rerender } = render(<RollingNumber value={3} />);
    expect(screen.getByText("3")).toBeTruthy();
    rerender(<RollingNumber value={2} />);
    expect(screen.getByText("2")).toBeTruthy();
    // The outgoing digits are decoration, hidden from screen readers.
    expect(screen.getByText("3", { includeHiddenElements: true })).toBeTruthy();
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(screen.queryByText("3", { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText("2")).toBeTruthy();
  });
});
