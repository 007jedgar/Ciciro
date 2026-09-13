import { skeletonShineX } from "../lib/skeleton";

describe("skeleton shine", () => {
  it("starts off-canvas and sweeps through the block", () => {
    expect(skeletonShineX(0, 100)).toBe(-100);
    expect(skeletonShineX(0.5, 100)).toBe(0);
    expect(skeletonShineX(1, 100)).toBe(100);
  });
});
