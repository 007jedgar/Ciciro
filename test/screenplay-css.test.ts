import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import {
  DUAL_METRICS,
  ELEMENT_METRICS,
  PAGE_COLUMNS,
  SCREENPLAY_ELEMENTS,
  SPEECH_RUNS,
  type DualSide,
  type ScreenplayElement,
} from "@/lib/screenplay";

/**
 * The editor sets the page in CSS (`ch` columns) and src/lib/screenplay.ts sets
 * it in code (the page markers, the page count, the PDF). They have to be the
 * same numbers, or the markers land on the wrong lines. Fix the one that is
 * wrong; ELEMENT_METRICS and SPEECH_RUNS are the source.
 */
const sheet = postcss.parse(readFileSync(join(__dirname, "../src/app/globals.css"), "utf8"));

type Declarations = Map<string, { value: string; important: boolean }>;

type Side = "top" | "right" | "bottom" | "left";

/** A `margin` shorthand's four sides, as the browser expands it. */
function expandMargin(value: string): Record<Side, string> {
  const [top, right = top, bottom = top, left = right] = value.split(/\s+/);
  return { top, right, bottom, left };
}

/**
 * The declarations every unconditional rule naming `selector` sets, later ones
 * winning unless an earlier one is !important, with `margin` expanded to sides.
 */
const bySelector = new Map<string, Declarations>();
sheet.walkRules((rule: Rule) => {
  if (rule.parent?.type !== "root") return;
  for (const raw of rule.selectors) {
    const selector = raw.split(/\s+/).join(" ");
    const decls = bySelector.get(selector) ?? new Map();
    rule.walkDecls((decl) => {
      const sets =
        decl.prop === "margin"
          ? Object.entries(expandMargin(decl.value)).map(([side, value]) => [`margin-${side}`, value] as const)
          : [[decl.prop, decl.value] as const];
      for (const [prop, value] of sets) {
        const was = decls.get(prop);
        if (!was?.important || decl.important) decls.set(prop, { value, important: decl.important });
      }
    });
    bySelector.set(selector, decls);
  }
});

/** The value a block matched by these selectors (least to most specific) ends up with. */
function resolved(selectors: string[], prop: string): string | null {
  let value: string | null = null;
  let important = false;
  for (const selector of selectors) {
    const decl = bySelector.get(selector)?.get(prop);
    if (decl && (!important || decl.important)) {
      value = decl.value;
      important = decl.important;
    }
  }
  return value;
}

const PAGE = ".ProseMirror.screenplay";
const blockSelectors = (element: ScreenplayElement) => [`${PAGE} p`, `${PAGE} p[data-sp="${element}"]`];
const runSelector = (above: string, below: string) => `${PAGE} p[data-sp="${above}"] + p[data-sp="${below}"]`;

describe("the editor's CSS agrees with the page engine", () => {
  it("sets the page 60 columns wide", () => {
    expect(resolved([PAGE], "width")).toBe(`${PAGE_COLUMNS}ch`);
  });

  for (const element of SCREENPLAY_ELEMENTS) {
    const m = ELEMENT_METRICS[element];
    it(`indents and widens ${element} as the engine does`, () => {
      const set = (prop: string) => resolved(blockSelectors(element), prop);
      expect(set("margin-left") ?? "0").toBe(m.indent === 0 ? "0" : `${m.indent}ch`);
      // A block with no width of its own fills the page.
      expect(set("width") ?? resolved([PAGE], "width")).toBe(`${m.width}ch`);
      expect(set("text-transform") === "uppercase").toBe(m.caps);
      expect(set("font-weight") === "700").toBe(m.bold);
      expect(set("text-align") === "right").toBe(m.align === "right");
      expect(set("text-align") === "center").toBe(m.align === "center");
    });
  }

  it("puts no blank line inside a speech, the same pairs as the engine", () => {
    for (const above of SCREENPLAY_ELEMENTS) {
      for (const below of SCREENPLAY_ELEMENTS) {
        const inSpeech = SPEECH_RUNS.some(([a, b]) => a === above && b === below);
        const marginTop = resolved([...blockSelectors(below), runSelector(above, below)], "margin-top");
        expect(marginTop === "0", `${above} then ${below}`).toBe(inSpeech);
      }
    }
  });

  // Dual dialogue sets a speech in a column: the left floats, the right stays in the flow, both from the margin.
  for (const side of ["left", "right"] as DualSide[]) {
    for (const [element, m] of Object.entries(DUAL_METRICS[side]) as [ScreenplayElement, { indent: number; width: number }][]) {
      it(`sets ${element} in the ${side} column of a dual pair as the engine does`, () => {
        const selectors = [
          `${PAGE} p.sp-dual`,
          `${PAGE} p.sp-dual-${side}`,
          `${PAGE} p.sp-dual-${side}[data-sp="${element}"]`,
        ];
        expect(resolved(selectors, "margin-left") ?? "0").toBe(m.indent === 0 ? "0" : `${m.indent}ch`);
        expect(resolved(selectors, "width")).toBe(`${m.width}ch`);
        expect(resolved(selectors, "float") === "left").toBe(side === "left");
      });
    }
  }

  it("keeps the two dual columns inside the page and apart", () => {
    const left = DUAL_METRICS.left.dialogue!;
    const right = DUAL_METRICS.right.dialogue!;
    expect(left.indent + left.width).toBeLessThan(right.indent);
    expect(right.indent + right.width).toBeLessThanOrEqual(PAGE_COLUMNS);
  });
});
