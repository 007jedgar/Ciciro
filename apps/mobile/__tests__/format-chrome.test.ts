import { formatBarPlacement, hideFormatBarWhileTyping, showPressMenu, showSelectionBubble } from "../lib/format-chrome";

describe("format chrome placement", () => {
  it("pins a smart header and a keyboard bar, and hides the header while typing", () => {
    expect(formatBarPlacement("smart")).toBe("header");
    expect(formatBarPlacement("always")).toBe("accessory");
    expect(formatBarPlacement("selection")).toBe("none");
    expect(formatBarPlacement("press")).toBe("none");
    expect(hideFormatBarWhileTyping("smart", true)).toBe(true);
    expect(hideFormatBarWhileTyping("smart", false)).toBe(false);
    expect(hideFormatBarWhileTyping("always", true)).toBe(false);
  });

  it("shows a highlight bubble and a long-press menu for the matching homes", () => {
    expect(showSelectionBubble("smart", true)).toBe(true);
    expect(showSelectionBubble("selection", true)).toBe(true);
    expect(showSelectionBubble("smart", false)).toBe(false);
    expect(showSelectionBubble("always", true)).toBe(false);
    expect(showSelectionBubble("press", true)).toBe(false);
    expect(showPressMenu("smart")).toBe(true);
    expect(showPressMenu("press")).toBe(true);
    expect(showPressMenu("selection")).toBe(false);
    expect(showPressMenu("always")).toBe(false);
  });
});
