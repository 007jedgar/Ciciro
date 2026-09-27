// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Editor, { type EditorHandle } from "@/components/Editor";

vi.mock("@/components/SettingsProvider", () => ({
  useSettings: () => ({ settings: { autoCorrect: false, typewriterMode: false } }),
}));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  // ProseMirror asks for layout that jsdom does not have.
  document.elementFromPoint = () => null;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });

describe("the editor across an Undo restore", () => {
  it("puts the caret back before telling the page is ready, so a held phrase lands where the writer was", async () => {
    const ref = createRef<EditorHandle>();
    let landed = "";
    const onChange = vi.fn((html: string) => (landed = html));
    await act(async () =>
      root.render(
        <Editor
          ref={ref}
          content='<p data-block-id="a">First line.</p><p data-block-id="b">Second line.</p>'
          onChange={onChange}
          restorePosition={{ blockId: "b", offset: 12 }}
          onReady={() => ref.current?.insertDictation("more words")}
        />
      )
    );
    await settle();
    expect(landed).toContain("First line.</p>");
    expect(landed).toMatch(/Second line\. [Mm]ore words/);
  });

  it("leaves the screenplay bar and suggestion accepts alone while the page is held", async () => {
    const ref = createRef<EditorHandle>();
    const onChange = vi.fn();
    await act(async () =>
      root.render(
        <Editor
          ref={ref}
          kind="screenplay"
          content='<p data-block-id="a">INT. LAB - DAY</p>'
          onChange={onChange}
          readOnly
        />
      )
    );
    await settle();
    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>(".screenplay-bar button"));
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    await act(async () => ref.current?.resolveSuggestions("accept"));
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });
});
