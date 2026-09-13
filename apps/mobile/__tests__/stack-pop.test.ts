import { shouldInterceptStackRemove, stackPopTransform } from "../lib/stack-pop";

describe("stack pop transition", () => {
  it("shrinks, fades, and moves down-right as progress goes to 1", () => {
    expect(stackPopTransform(0)).toEqual({ opacity: 1, scale: 1, translateX: 0, translateY: 0 });
    const end = stackPopTransform(1);
    expect(end.opacity).toBe(0);
    expect(end.scale).toBeCloseTo(0.88);
    expect(end.translateX).toBeGreaterThan(0);
    expect(end.translateY).toBeGreaterThan(end.translateX);
  });

  it("only intercepts back/pop actions", () => {
    expect(shouldInterceptStackRemove("GO_BACK")).toBe(true);
    expect(shouldInterceptStackRemove("POP")).toBe(true);
    expect(shouldInterceptStackRemove("POP_TO")).toBe(true);
    expect(shouldInterceptStackRemove("NAVIGATE")).toBe(false);
    expect(shouldInterceptStackRemove("REPLACE")).toBe(false);
  });
});
