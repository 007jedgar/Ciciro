// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { generalShortcuts, isUnrelatedInput } from "@/lib/shortcuts";

describe("the shortcuts reference", () => {
  it("lists the Mac glyphs on a Mac and the Windows/Linux words elsewhere", () => {
    const mac = generalShortcuts(true, false);
    const other = generalShortcuts(false, false);
    expect(mac.find((r) => r.label === "Find and replace")?.keys).toBe("⌘⇧F");
    expect(other.find((r) => r.label === "Find and replace")?.keys).toBe("Ctrl+Shift+F");
    expect(mac.find((r) => r.label === "Keyboard shortcuts")?.keys).toBe("⌘/");
    expect(other.find((r) => r.label === "Keyboard shortcuts")?.keys).toBe("Ctrl+/");
  });

  it("only lists chapter navigation when there is more than one chapter to jump between", () => {
    expect(generalShortcuts(false, false).some((r) => r.label === "Next chapter")).toBe(false);
    expect(generalShortcuts(false, true).some((r) => r.label === "Next chapter")).toBe(true);
  });
});

describe("isUnrelatedInput", () => {
  it("is true for a plain text field", () => {
    expect(isUnrelatedInput(document.createElement("input"))).toBe(true);
    expect(isUnrelatedInput(document.createElement("textarea"))).toBe(true);
    expect(isUnrelatedInput(document.createElement("select"))).toBe(true);
  });

  it("is true for a contenteditable outside the manuscript editor", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    expect(isUnrelatedInput(div)).toBe(true);
  });

  it("is false for the manuscript editor itself, or its own text node's parent", () => {
    const root = document.createElement("div");
    root.className = "ProseMirror";
    root.setAttribute("contenteditable", "true");
    const paragraph = document.createElement("p");
    root.appendChild(paragraph);
    expect(isUnrelatedInput(root)).toBe(false);
    expect(isUnrelatedInput(paragraph)).toBe(false);
  });

  it("is false for anything that is not an element (null, the window)", () => {
    expect(isUnrelatedInput(null)).toBe(false);
    expect(isUnrelatedInput(window)).toBe(false);
  });
});
