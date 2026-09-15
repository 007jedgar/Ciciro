import {
  shouldInterceptStackRemove,
  STACK_POP_FADE_START,
  stackPopTransform,
} from "../lib/stack-pop";

const WIDTH = 390;

describe("stack pop transition", () => {
  it("starts flush and full-bleed, so the first frame is the screen as it was", () => {
    expect(stackPopTransform(0, WIDTH)).toEqual({
      opacity: 1,
      scale: 1,
      translateX: 0,
      translateY: 0,
      radius: 0,
    });
  });

  it("rounds off, shrinks, and tucks to the right as progress goes to 1", () => {
    const end = stackPopTransform(1, WIDTH);
    expect(end.opacity).toBe(0);
    expect(end.scale).toBeCloseTo(0.8);
    expect(end.radius).toBeGreaterThan(0);
    // Sideways, not downwards: it leaves by the right-hand edge.
    expect(end.translateX).toBeGreaterThan(end.translateY * 4);
  });

  it("travels with the viewport rather than a fixed number of points", () => {
    expect(stackPopTransform(1, 780).translateX).toBeCloseTo(
      stackPopTransform(1, 390).translateX * 2
    );
  });

  it("stays solid while it collapses, and only then fades", () => {
    // Most of the way through the collapse there is still a screen to watch.
    expect(stackPopTransform(STACK_POP_FADE_START, WIDTH).opacity).toBe(1);
    expect(stackPopTransform(STACK_POP_FADE_START, WIDTH).scale).toBeLessThan(0.9);
    const late = stackPopTransform(0.8, WIDTH).opacity;
    expect(late).toBeGreaterThan(0);
    expect(late).toBeLessThan(1);
  });

  it("clamps outside 0..1 rather than running past the end", () => {
    expect(stackPopTransform(-1, WIDTH)).toEqual(stackPopTransform(0, WIDTH));
    expect(stackPopTransform(2, WIDTH)).toEqual(stackPopTransform(1, WIDTH));
  });

  it("only intercepts back/pop actions", () => {
    expect(shouldInterceptStackRemove("GO_BACK")).toBe(true);
    expect(shouldInterceptStackRemove("POP")).toBe(true);
    expect(shouldInterceptStackRemove("POP_TO")).toBe(true);
    expect(shouldInterceptStackRemove("NAVIGATE")).toBe(false);
    expect(shouldInterceptStackRemove("REPLACE")).toBe(false);
  });
});
