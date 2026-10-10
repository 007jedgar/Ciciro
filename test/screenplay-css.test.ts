import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ELEMENT_METRICS, PAGE_COLUMNS, SCREENPLAY_ELEMENTS, SPEECH_RUNS } from "@/lib/screenplay";

/**
 * The editor sets the page in CSS (`ch` columns) and src/lib/screenplay.ts sets
 * it in code (the page markers, the page count, the PDF). They have to be the
 * same numbers, or the markers land on the wrong lines. Fix the one that is
 * wrong; ELEMENT_METRICS and SPEECH_RUNS are the source.
 */
const css = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

const declared = (body: string, prop: string): string | null =>
  body.match(new RegExp(`(?:^|[\\s;{])${prop}:\\s*([^;]+);`))?.[1].trim() ?? null;

describe("the editor's CSS agrees with the page engine", () => {
  it("sets the page 60 columns wide", () => {
    expect(declared(rule(".ProseMirror.screenplay"), "width")).toBe(`${PAGE_COLUMNS}ch`);
  });

  for (const element of SCREENPLAY_ELEMENTS) {
    const m = ELEMENT_METRICS[element];
    // An element with no rule of its own (action) sits at the margin, the full width.
    const hasRule = css.includes(`.ProseMirror.screenplay p[data-sp="${element}"] {`);
    it(`indents and widens ${element} as the engine does`, () => {
      const body = hasRule ? rule(`.ProseMirror.screenplay p[data-sp="${element}"]`) : "";
      expect(declared(body, "margin-left") ?? "0").toBe(m.indent === 0 ? "0" : `${m.indent}ch`);
      expect(declared(body, "width") ?? `${PAGE_COLUMNS}ch`).toBe(m.indent === 0 ? `${PAGE_COLUMNS}ch` : `${m.width}ch`);
      expect(/text-transform:\s*uppercase/.test(body)).toBe(m.caps);
      expect(/font-weight:\s*700/.test(body)).toBe(m.bold);
      expect(/text-align:\s*right/.test(body)).toBe(m.align === "right");
    });
  }

  it("puts no blank line inside a speech, the same pairs as the engine", () => {
    for (const [above, below] of SPEECH_RUNS) {
      expect(css).toContain(`.ProseMirror.screenplay p[data-sp="${above}"] + p[data-sp="${below}"]`);
    }
  });
});
