import { formatBarPlacement, headerBarOverlay, hideFormatBarWhileTyping, overlayFormatChrome, showPressMenu, showSelectionBubble } from "../lib/format-chrome";

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

  it("keeps highlight and long-press chips as overlays, not page flow", () => {
    expect(
      overlayFormatChrome({ chrome: "smart", selected: true, pressOpen: true, grammarOpen: false })
    ).toEqual({ bubble: true, press: true });
    expect(
      overlayFormatChrome({ chrome: "smart", selected: true, pressOpen: false, grammarOpen: true })
    ).toEqual({ bubble: false, press: false });
    expect(
      overlayFormatChrome({ chrome: "press", selected: false, pressOpen: true, grammarOpen: false })
    ).toEqual({ bubble: false, press: true });
    expect(
      overlayFormatChrome({ chrome: "selection", selected: true, pressOpen: true, grammarOpen: false })
    ).toEqual({ bubble: true, press: false });
  });

  it("hides the header by fading it, not by collapsing layout", () => {
    expect(headerBarOverlay(0)).toEqual({ opacity: 1, translateY: 0 });
    expect(headerBarOverlay(1)).toEqual({ opacity: 0, translateY: -12 });
  });
});
