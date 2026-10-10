import { render, screen } from "@testing-library/react-native";
import { ScriptSheet, sheetMetrics } from "../components/ScriptSheet";
import { PAGE_COLUMNS, PAGE_LINES } from "../lib/screenplay";
import { scriptPages } from "../lib/script-pages";
import { colors } from "../lib/theme";

const SCRIPT =
  '<p data-sp="scene-heading">INT. LAB - NIGHT</p><p>Rain on the glass.</p><p data-sp="character">MARA</p><p data-sp="dialogue">Stay quiet.</p>';

describe("sheetMetrics", () => {
  it("fits 60 columns of a 0.6 em face inside the sheet at any width", () => {
    for (const width of [280, 343, 390, 430, 768]) {
      const m = sheetMetrics(width);
      expect(m.fontSize * 0.6 * PAGE_COLUMNS + m.padding * 2).toBeLessThanOrEqual(width);
      expect(m.lineHeight).toBeGreaterThan(m.fontSize);
      // Every page is the same height: 54 lines between the edges.
      expect(m.height).toBeCloseTo(m.paddingTop + m.lineHeight * PAGE_LINES + m.padding, 5);
    }
  });

  it("uses most of the width, so the type is as large as it can be", () => {
    const m = sheetMetrics(390);
    expect(m.fontSize * 0.6 * PAGE_COLUMNS).toBeGreaterThan(390 - m.padding * 2 - m.fontSize * 0.6 * 2);
  });
});

describe("ScriptSheet", () => {
  const { pages } = scriptPages([SCRIPT]);
  const props = { metrics: sheetMetrics(360), colors, label: "Page 1" };

  it("draws a page's lines at their columns, with no number on the first page", () => {
    render(<ScriptSheet page={pages[0]} {...props} />);
    expect(screen.getByLabelText("Page 1")).toBeTruthy();
    expect(screen.getByText("INT. LAB - NIGHT")).toBeTruthy();
    expect(screen.getByText("Rain on the glass.")).toBeTruthy();
    // The cue and its line sit in from the margin, as printed.
    // (Testing Library trims text by default; the indent is the point here.)
    const exact = { normalizer: (text: string) => text };
    expect(screen.getByText(/^ {20,}MARA$/, exact)).toBeTruthy();
    expect(screen.getByText(/^ {8,}Stay quiet\.$/, exact)).toBeTruthy();
    expect(screen.queryByText("1.")).toBeNull();
  });

  it("numbers a later page top right", () => {
    render(<ScriptSheet page={{ number: 2, lines: pages[0].lines }} {...props} label="Page 2" />);
    expect(screen.getByText("2.")).toBeTruthy();
  });
});
