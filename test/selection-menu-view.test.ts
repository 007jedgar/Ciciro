import { describe, expect, it } from "vitest";
import {
  MENU_GAP,
  anchorCenter,
  isMacPlatform,
  isMenuShortcut,
  menuAnnouncement,
  nextIndex,
  placeMenu,
  shortcutLabel,
  splitSynonyms,
  wordRange,
} from "@/lib/selection-menu-view";

const menu = { width: 300, height: 40 };
const base = { startTop: 200, endBottom: 224, centerX: 400, menu, minLeft: 8, maxRight: 792, minTop: 0 };

describe("placeMenu", () => {
  it("sits above the selection, centered on it", () => {
    expect(placeMenu(base)).toEqual({ top: 200 - 40 - MENU_GAP, left: 250, placement: "above" });
  });

  it("drops below when there is no room above on the page", () => {
    const placed = placeMenu({ ...base, startTop: 30 });
    expect(placed.placement).toBe("below");
    expect(placed.top).toBe(224 + MENU_GAP);
  });

  it("counts the toolbar above the page as no room", () => {
    expect(placeMenu({ ...base, startTop: 70, minTop: 40 }).placement).toBe("below");
    expect(placeMenu({ ...base, startTop: 100, minTop: 40 }).placement).toBe("above");
  });

  it("keeps the menu inside the shell at either edge", () => {
    expect(placeMenu({ ...base, centerX: 10 }).left).toBe(8);
    expect(placeMenu({ ...base, centerX: 790 }).left).toBe(792 - 300);
  });

  it("can use room left of the shell, in the pane around the page", () => {
    expect(placeMenu({ ...base, centerX: 10, minLeft: -60 }).left).toBe(-60);
  });

  it("pins a menu wider than its room to the left edge", () => {
    expect(placeMenu({ ...base, maxRight: 280 }).left).toBe(8);
  });
});

describe("anchorCenter", () => {
  it("is halfway between the ends", () => {
    expect(anchorCenter(100, 300)).toBe(200);
  });
});

describe("wordRange", () => {
  it("covers just the word, not the quote or full stop around it", () => {
    expect(wordRange(10, "country")).toMatchObject({ from: 10, to: 17, word: "country" });
    expect(wordRange(10, "“country.”")).toMatchObject({ from: 11, to: 18, word: "country", lead: "“", trail: ".”" });
    expect(wordRange(10, " country ")).toMatchObject({ from: 11, to: 18 });
  });

  it("finds nothing in punctuation", () => {
    expect(wordRange(0, "…")).toBeNull();
  });
});

describe("isMenuShortcut", () => {
  const key = (init: Partial<Parameters<typeof isMenuShortcut>[0]>) => ({
    key: "k",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
  });

  it("is Command-K or Control-K", () => {
    expect(isMenuShortcut(key({ metaKey: true }))).toBe(true);
    expect(isMenuShortcut(key({ ctrlKey: true, key: "K" }))).toBe(true);
  });

  it("is not a bare K or a longer chord", () => {
    expect(isMenuShortcut(key({}))).toBe(false);
    expect(isMenuShortcut(key({ metaKey: true, shiftKey: true }))).toBe(false);
    expect(isMenuShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isMenuShortcut(key({ metaKey: true, key: "j" }))).toBe(false);
  });
});

describe("labels", () => {
  it("names the shortcut for the platform", () => {
    expect(shortcutLabel(true)).toBe("⌘K");
    expect(shortcutLabel(false)).toBe("Ctrl+K");
    expect(menuAnnouncement(true)).toContain("Command K");
    expect(menuAnnouncement(false)).toContain("Control K");
    expect(isMacPlatform("MacIntel")).toBe(true);
    expect(isMacPlatform("Win32")).toBe(false);
    expect(isMacPlatform(undefined)).toBe(false);
  });

  it("never uses an em dash", () => {
    expect(menuAnnouncement(true)).not.toContain("—");
  });
});

describe("nextIndex", () => {
  it("walks the row and wraps", () => {
    expect(nextIndex(0, 4, "ArrowRight")).toBe(1);
    expect(nextIndex(3, 4, "ArrowRight")).toBe(0);
    expect(nextIndex(0, 4, "ArrowLeft")).toBe(3);
    expect(nextIndex(2, 4, "Home")).toBe(0);
    expect(nextIndex(1, 4, "End")).toBe(3);
  });

  it("ignores other keys and an empty row", () => {
    expect(nextIndex(0, 4, "a")).toBeNull();
    expect(nextIndex(0, 0, "ArrowRight")).toBeNull();
  });
});

describe("splitSynonyms", () => {
  it("shows three and keeps the rest for the overflow", () => {
    expect(splitSynonyms(["a", "b", "c", "d", "e"])).toEqual({ shown: ["a", "b", "c"], rest: ["d", "e"] });
    expect(splitSynonyms(["a"])).toEqual({ shown: ["a"], rest: [] });
  });
});
