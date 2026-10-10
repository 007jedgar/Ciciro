import { keyboardHideProgress, tabBubble } from "../lib/manuscript-tab-bar";

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

describe("tabBubble", () => {
  // An iPhone-width pill: 285 wide with 10 of padding, so three 88.33 tabs.
  const seg = 265 / 3;
  const at = (position: number) => tabBubble(position, 3, seg, 10, 60, 4, 6, 20);

  it("hugs the pill's curve on the outer side of the end tabs", () => {
    const first = at(0);
    expect(first.left).toBe(-6);
    expect(first.leftRadius).toBe(26);
    expect(first.rightRadius).toBe(20);
    const last = at(2);
    expect(last.left + last.width).toBeCloseTo(265 + 6);
    expect(last.leftRadius).toBe(20);
    expect(last.rightRadius).toBe(26);
  });

  it("is a super rounded rectangle on the middle tab", () => {
    const mid = at(1);
    expect(mid.leftRadius).toBe(20);
    expect(mid.rightRadius).toBe(20);
    expect(mid.left).toBeCloseTo(seg + 3);
    expect(mid.width).toBeCloseTo(seg - 6);
  });

  it("covers its whole tab, label included, at every position", () => {
    for (let i = 0; i < 3; i++) {
      const f = at(i);
      // Within a few points of the tab's own edges: nearly the whole segment.
      expect(f.left).toBeLessThanOrEqual(i * seg + 3);
      expect(f.left + f.width).toBeGreaterThanOrEqual((i + 1) * seg - 3);
    }
  });

  it("morphs continuously between tabs and never leaves the pill", () => {
    let prev = at(0);
    for (let p = 0.05; p <= 2; p += 0.05) {
      const next = at(p);
      expect(Math.abs(next.left - prev.left)).toBeLessThan(seg * 0.06);
      expect(Math.abs(next.leftRadius - prev.leftRadius)).toBeLessThan(2);
      prev = next;
    }
    expect(at(-0.1)).toEqual(at(0));
    expect(at(2.1)).toEqual(at(2));
  });

  it("has no width, never a negative one, before the tab row is measured", () => {
    for (const p of [0, 1, 2, 0.5]) {
      const f = tabBubble(p, 3, 0, 10, 60, 4, 6, 20);
      expect(f.width).toBe(0);
    }
  });
});
