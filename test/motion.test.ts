// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOTION_MS, motionMs, prefersReducedMotion } from "@/lib/motion";
import { REST_FRACTION, scrollDeltaTo } from "@/lib/editor-scroll";
import { boxIndexAt } from "@/lib/outline";

// The --duration-* custom properties globals.css declares, in unscaled ms.
function durationTokens(): Map<string, number> {
  const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");
  const tokens = new Map<string, number>();
  for (const [, name, ms] of css.matchAll(/--(duration-[\w-]+):\s*calc\((\d+)ms \* var\(--motion\)\)/g)) {
    tokens.set(name, Number(ms));
  }
  return tokens;
}

describe("motion tokens", () => {
  // JS waits these out before unmounting or removing a row, so a CSS change
  // that is not repeated here would cut an animation short or leave a ghost.
  it("mirrors the CSS durations JS waits for", () => {
    const tokens = durationTokens();
    expect({
      drawerOut: tokens.get("duration-drawer-out"),
      dialogOut: tokens.get("duration-drawer-out"),
      popoverOut: tokens.get("duration-popover-out"),
      remove: tokens.get("duration-remove"),
      collapse: tokens.get("duration-collapse"),
      accordion: tokens.get("duration-accordion"),
      flash: tokens.get("duration-flash"),
      pulse: tokens.get("duration-pulse"),
      focus: tokens.get("duration-focus"),
      reorder: tokens.get("duration-reorder"),
      drop: tokens.get("duration-drop"),
      typewriter: tokens.get("duration-typewriter"),
      suggestionCollapse: tokens.get("duration-suggestion-fold"),
      keyType: tokens.get("duration-key-type"),
      keyErase: tokens.get("duration-key-erase"),
      wordHold: tokens.get("duration-word-hold"),
    }).toEqual(MOTION_MS);
  });
});

describe("reduced motion", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-reduce-motion");
    vi.unstubAllGlobals();
  });

  it("keeps durations when nothing asks for less motion", () => {
    expect(prefersReducedMotion()).toBe(false);
    expect(motionMs(MOTION_MS.remove)).toBe(MOTION_MS.remove);
  });

  it("stills every wait when the writer turns motion down", () => {
    document.documentElement.setAttribute("data-reduce-motion", "true");
    expect(prefersReducedMotion()).toBe(true);
    expect(motionMs(MOTION_MS.remove)).toBe(0);
  });

  it("stills every wait when the OS asks for reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    expect(prefersReducedMotion()).toBe(true);
    expect(motionMs(MOTION_MS.pulse)).toBe(0);
  });
});

describe("scrollDeltaTo", () => {
  it("is zero when the line already rests where it should", () => {
    expect(scrollDeltaTo(390, 410, 0, 1000)).toBe(0);
  });

  it("measures from the middle of the line to the resting height", () => {
    // Pane 0..1000, rest at 40% = 400. A line centred at 700 needs 300px.
    expect(scrollDeltaTo(690, 710, 0, 1000)).toBe(300);
    expect(scrollDeltaTo(90, 110, 0, 1000)).toBe(-300);
    expect(REST_FRACTION).toBe(0.4);
  });

  it("honours the pane's own offset and a custom fraction", () => {
    expect(scrollDeltaTo(300, 300, 100, 600, 0.5)).toBe(-100);
  });
});

describe("boxIndexAt", () => {
  const boxes = [
    { left: 0, top: 0, right: 100, bottom: 50 },
    { left: 110, top: 0, right: 210, bottom: 50 },
  ];
  it("finds the box under the point", () => {
    expect(boxIndexAt(boxes, 150, 20)).toBe(1);
    expect(boxIndexAt(boxes, 10, 10)).toBe(0);
  });
  it("is -1 in the gap between boxes", () => {
    expect(boxIndexAt(boxes, 105, 20)).toBe(-1);
  });
});
