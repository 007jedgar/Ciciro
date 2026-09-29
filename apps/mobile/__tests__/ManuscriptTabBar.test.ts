import { keyboardCoversTabBar } from "../lib/manuscript-tab-bar";

describe("keyboardCoversTabBar", () => {
  it("stays visible when no keyboard is up", () => {
    expect(keyboardCoversTabBar(0)).toBe(false);
  });

  it("stays visible for a floating IME add-on shorter than a real keyboard", () => {
    // Android's stylus-handwriting toolbar and voice-typing's compact strip report the
    // `ime()` inset as visible while only occupying ~50-90dp, far short of a real keyboard.
    expect(keyboardCoversTabBar(60)).toBe(false);
    expect(keyboardCoversTabBar(-60)).toBe(false);
  });

  it("hides once a real keyboard covers the bar, regardless of sign convention", () => {
    expect(keyboardCoversTabBar(300)).toBe(true);
    expect(keyboardCoversTabBar(-300)).toBe(true);
  });
});
