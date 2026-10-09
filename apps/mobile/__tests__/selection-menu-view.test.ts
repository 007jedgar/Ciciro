import {
  frameVisible,
  placeSelectionMenu,
  type SelectionFrame,
} from "../lib/selection-menu-view";

const oneLine = (y: number, x = 100, width = 60): SelectionFrame => ({
  topX: x,
  topY: y,
  topWidth: width,
  topHeight: 24,
  bottomX: x,
  bottomY: y,
  bottomWidth: width,
  bottomHeight: 24,
});

const bounds = { width: 390, height: 500 };
const menu = { width: 200, height: 56 };

function place(frame: SelectionFrame) {
  return placeSelectionMenu(frame, menu.width, menu.height, bounds.width, bounds.height);
}

describe("placeSelectionMenu", () => {
  it("goes below the selection, centred on it", () => {
    const placed = place(oneLine(200));
    expect(placed.below).toBe(true);
    expect(placed.top).toBe(200 + 24 + 20);
    expect(placed.left).toBe(130 - 100);
  });

  it("hangs from the last line of a multi-line selection", () => {
    const placed = place({
      topX: 40,
      topY: 100,
      topWidth: 200,
      topHeight: 24,
      bottomX: 100,
      bottomY: 124,
      bottomWidth: 150,
      bottomHeight: 24,
    });
    expect(placed.below).toBe(true);
    expect(placed.top).toBe(124 + 24 + 20);
    expect(placed.left).toBe(100 + 75 - 100);
  });

  it("flips above the system callout when there is no room below", () => {
    const placed = place(oneLine(450));
    expect(placed.below).toBe(false);
    expect(placed.top).toBe(450 - 56 - 12 - 56);
  });

  it("sits as low as the page allows when neither side has room", () => {
    const placed = placeSelectionMenu(oneLine(20), 200, 56, 390, 90);
    expect(placed.top).toBe(90 - 56 - 8);
  });

  it("stays inside the page at both edges", () => {
    expect(place(oneLine(200, 0, 20)).left).toBe(8);
    expect(place(oneLine(200, 380, 10)).left).toBe(390 - 200 - 8);
  });
});

describe("frameVisible", () => {
  it("is false once the selection has scrolled out of the page", () => {
    expect(frameVisible(oneLine(200), 500)).toBe(true);
    expect(frameVisible(oneLine(-40), 500)).toBe(false);
    expect(frameVisible(oneLine(520), 500)).toBe(false);
  });
});
