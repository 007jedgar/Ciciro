import {
  RECAP_ABSENCE_MS,
  dismissRecap,
  recapDue,
  resetRecapState,
  shouldShowRecap,
  stuckPromptHref,
} from "../lib/recap";

describe("recap rules", () => {
  beforeEach(resetRecapState);

  it("shows the recap only after a real absence", () => {
    const now = 10 * RECAP_ABSENCE_MS;
    expect(shouldShowRecap(null, now)).toBe(false);
    expect(shouldShowRecap(now - 60_000, now)).toBe(false);
    expect(shouldShowRecap(now - RECAP_ABSENCE_MS, now)).toBe(true);
  });

  it("is not due on a first open, and stays decided for the run", () => {
    expect(recapDue("p1")).toBe(false);
    expect(recapDue("p1", Date.now() + 10 * RECAP_ABSENCE_MS)).toBe(false);
    expect(recapDue("")).toBe(false);
  });

  it("stays dismissed once dismissed", () => {
    dismissRecap("p2");
    expect(recapDue("p2")).toBe(false);
  });

  it("builds the composer href with the prompt encoded", () => {
    expect(stuckPromptHref("p 1", "Cut to the storm & rain?")).toBe(
      "/project/p%201/ciciro?prompt=Cut%20to%20the%20storm%20%26%20rain%3F"
    );
  });
});
