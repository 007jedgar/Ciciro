import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MOTION_MS } from "@/lib/motion";
import { REST_FRACTION, scrollDeltaTo } from "@/lib/editor-scroll";
import { boxIndexAt } from "@/lib/outline";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function token(name: string): number {
  const match = new RegExp(`--${name}:\\s*calc\\((\\d+)ms \\* var\\(--motion\\)\\)`).exec(css);
  if (!match) throw new Error(`--${name} is not a motion-scaled token`);
  return Number(match[1]);
}

describe("motion tokens", () => {
  // JS waits these out before unmounting or removing a row, so a CSS change
  // that is not repeated here would cut an animation short or leave a ghost.
  it("mirrors the CSS durations JS waits for", () => {
    expect(MOTION_MS.drawerOut).toBe(token("duration-drawer-out"));
    expect(MOTION_MS.dialogOut).toBe(token("duration-drawer-out"));
    expect(MOTION_MS.popoverOut).toBe(token("duration-popover-out"));
    expect(MOTION_MS.remove).toBe(token("duration-remove"));
    expect(MOTION_MS.collapse).toBe(token("duration-collapse"));
    expect(MOTION_MS.accordion).toBe(token("duration-accordion"));
    expect(MOTION_MS.flash).toBe(token("duration-flash"));
    expect(MOTION_MS.pulse).toBe(token("duration-pulse"));
    expect(MOTION_MS.focus).toBe(token("duration-focus"));
    expect(MOTION_MS.reorder).toBe(token("duration-reorder"));
    expect(MOTION_MS.drop).toBe(token("duration-drop"));
    expect(MOTION_MS.typewriter).toBe(token("duration-typewriter"));
    expect(MOTION_MS.suggestionCollapse).toBe(token("duration-suggestion-fold"));
  });

  it("stills every token when motion is reduced, by the setting or the OS", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{\s*--motion: 0;/);
    expect(css).toMatch(/:root\[data-reduce-motion="true"\] \{\s*--motion: 0;/);
  });

  it("never hard-codes a duration on a transition or animation it can take from a token", () => {
    const motionSection = css.slice(css.indexOf("/* ---------- Motion and feedback"));
    const hardCoded = motionSection.match(/(?:animation|transition)[^;{}]*\b\d+ms\b/g) ?? [];
    expect(hardCoded).toEqual([]);
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
