import { formatBarPlacement, hideFormatBarWhileTyping } from "../lib/format-chrome";

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
});
