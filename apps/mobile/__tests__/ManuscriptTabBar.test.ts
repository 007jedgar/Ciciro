import { keyboardHideProgress } from "../lib/manuscript-tab-bar";

describe("keyboardHideProgress", () => {
  it("stays visible when no keyboard is up", () => {
    expect(keyboardHideProgress(0)).toBe(0);
  });

  it("stays visible for a floating IME add-on shorter than a real keyboard", () => {
    expect(keyboardHideProgress(60)).toBe(0);
    expect(keyboardHideProgress(-60)).toBe(0);
  });

  it("is fully hidden once a real keyboard is up, regardless of sign convention", () => {
    expect(keyboardHideProgress(300)).toBe(1);
    expect(keyboardHideProgress(-300)).toBe(1);
  });

  it("ramps continuously with height, with no step", () => {
    let prev = keyboardHideProgress(0);
    for (let h = 1; h <= 320; h++) {
      const next = keyboardHideProgress(h);
      expect(next).toBeGreaterThanOrEqual(prev);
      expect(next - prev).toBeLessThan(0.05);
      prev = next;
    }
  });
});
