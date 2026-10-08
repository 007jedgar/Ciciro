import {
  TOOL_POP_DRIFT,
  TOOL_POP_STAGGER_MS,
  toolPopDelay,
  toolPopTransform,
} from "../lib/chapters-intro";
import {
  consumeNewManuscriptArrival,
  isFirstManuscriptArrival,
  isNewManuscriptArrival,
  markNewManuscriptArrival,
} from "../lib/new-manuscript-arrival";
import { tabSlideInterpolator } from "../lib/manuscript-tab-slide";

describe("tool pop", () => {
  it("starts hidden, a little smaller, and left of its place", () => {
    const start = toolPopTransform(0, TOOL_POP_DRIFT);
    expect(start.opacity).toBe(0);
    expect(start.scale).toBeLessThan(1);
    expect(start.translateX).toBe(-TOOL_POP_DRIFT);
  });

  it("settles at full size, in place", () => {
    expect(toolPopTransform(1, TOOL_POP_DRIFT)).toEqual({ opacity: 1, scale: 1, translateX: -0 });
  });

  it("drifts rightwards as it pops", () => {
    expect(toolPopTransform(0.5, TOOL_POP_DRIFT).translateX).toBeGreaterThan(
      toolPopTransform(0.1, TOOL_POP_DRIFT).translateX
    );
  });

  it("starts each tile a beat after the one to its left", () => {
    expect(toolPopDelay(0)).toBe(0);
    expect(toolPopDelay(3)).toBe(3 * TOOL_POP_STAGGER_MS);
    expect(toolPopDelay(2, 200)).toBe(200 + 2 * TOOL_POP_STAGGER_MS);
  });
});

describe("new manuscript arrival", () => {
  afterEach(() => consumeNewManuscriptArrival("a"));

  it("is true for the manuscript just created, until it is consumed", () => {
    expect(isNewManuscriptArrival("a")).toBe(false);
    markNewManuscriptArrival("a");
    expect(isNewManuscriptArrival("a")).toBe(true);
    // Reading does not clear it: a re-render before the animation starts must still see it.
    expect(isNewManuscriptArrival("a")).toBe(true);
    consumeNewManuscriptArrival("a");
    expect(isNewManuscriptArrival("a")).toBe(false);
  });

  it("flags only an account's first manuscript for the one-time flourish", () => {
    markNewManuscriptArrival("a", true);
    expect(isFirstManuscriptArrival("a")).toBe(true);
    expect(isFirstManuscriptArrival("b")).toBe(false);
    consumeNewManuscriptArrival("a");
    expect(isFirstManuscriptArrival("a")).toBe(false);

    markNewManuscriptArrival("a");
    expect(isNewManuscriptArrival("a")).toBe(true);
    expect(isFirstManuscriptArrival("a")).toBe(false);
  });

  it("does not mistake another manuscript for the new one", () => {
    markNewManuscriptArrival("a");
    expect(isNewManuscriptArrival("b")).toBe(false);
    consumeNewManuscriptArrival("b");
    expect(isNewManuscriptArrival("a")).toBe(true);
  });
});

describe("manuscript tab slide", () => {
  it("maps a tab's side of the active one to an offset on that side", () => {
    const calls: unknown[] = [];
    const progress = { interpolate: (config: unknown) => (calls.push(config), "interpolated") };
    const { sceneStyle } = tabSlideInterpolator(390)({ current: { progress } } as never);
    expect(sceneStyle.transform[0].translateX).toBe("interpolated");
    // Left of the active tab is -1 and sits off the left edge; right is +1, off the right.
    expect(calls).toEqual([{ inputRange: [-1, 0, 1], outputRange: [-390, 0, 390] }]);
  });
});
