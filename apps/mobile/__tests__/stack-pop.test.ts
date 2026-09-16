import {
  CONTAINED_POP_OVER_STACK_SCREEN_OPTIONS,
  ownsStackRemove,
  POP_OVER_STACK_SCREEN_OPTIONS,
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

describe("screens that leave by the pop transition", () => {
  // The collapse plays on the leaving screen, so the screen being returned to
  // has to already be on show underneath. A pushed card detaches it and the
  // whole thing plays against an empty background — which is what closing a
  // manuscript did, because `project/[id]` was left as a plain pushed card.
  it("are presented over the stack rather than in place of it", () => {
    expect(POP_OVER_STACK_SCREEN_OPTIONS.presentation).toBe("transparentModal");
  });

  it("use the contained variant when the stack is nested in another one", () => {
    // A plain transparent modal comes from the react root, so it would sit over
    // the window instead of over the parent stack's own screens.
    expect(CONTAINED_POP_OVER_STACK_SCREEN_OPTIONS.presentation).toBe(
      "containedTransparentModal"
    );
  });

  it("leave the page colour to the collapsing view, not the screen content", () => {
    // An opaque content background sits a level above the animated view and
    // would stay full-screen for the whole collapse, hiding the destination.
    expect(POP_OVER_STACK_SCREEN_OPTIONS.contentStyle.backgroundColor).toBe("transparent");
    expect(CONTAINED_POP_OVER_STACK_SCREEN_OPTIONS.contentStyle.backgroundColor).toBe(
      "transparent"
    );
  });

  it("intercepts the action a manuscript's back button actually dispatches", () => {
    // The manuscript header closes with `router.dismissTo("/manuscripts")`,
    // which expo-router sends as POP_TO rather than GO_BACK.
    expect(shouldInterceptStackRemove("POP_TO")).toBe(true);
  });
});

describe("which screen plays the pop", () => {
  const root = { key: "stack-root", index: 1 };
  const nested = { key: "stack-project", index: 0 };

  it("is the one whose own navigator is removing it", () => {
    const dismissTo = { type: "POP_TO", target: "stack-root" };
    expect(ownsStackRemove(dismissTo, root)).toBe(true);
    // The tabs inside the manuscript hear the same removal first, but it is
    // not theirs to play: they would collapse over their own background and
    // re-dispatch with a route key the root stack does not know.
    expect(ownsStackRemove(dismissTo, nested)).toBe(false);
  });

  it("gives an untargeted back to the deepest stack that can go back", () => {
    const back = { type: "GO_BACK" };
    expect(ownsStackRemove(back, nested)).toBe(false);
    expect(ownsStackRemove(back, root)).toBe(true);
    expect(ownsStackRemove(back, { key: "stack-project", index: 1 })).toBe(true);
  });
});

describe("ownsStackRemove without a navigator state", () => {
  it("lets the action through untouched rather than guessing", () => {
    expect(ownsStackRemove({ type: "GO_BACK" }, undefined)).toBe(false);
  });
});
