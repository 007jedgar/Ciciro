import { fadeUpDelay, skeletonShineX } from "../lib/skeleton";

describe("skeleton shine", () => {
  it("starts off-canvas and sweeps through the block", () => {
    expect(skeletonShineX(0, 100)).toBe(-100);
    expect(skeletonShineX(0.5, 100)).toBe(0);
    expect(skeletonShineX(1, 100)).toBe(100);
  });
});

describe("fadeUpDelay", () => {
  it("staggers each item by 60ms and stops growing after the first few", () => {
    expect(fadeUpDelay(0)).toBe(0);
    expect(fadeUpDelay(1)).toBe(60);
    expect(fadeUpDelay(3)).toBe(180);
    expect(fadeUpDelay(40)).toBe(fadeUpDelay(8));
    expect(fadeUpDelay(-2)).toBe(0);
  });
});
