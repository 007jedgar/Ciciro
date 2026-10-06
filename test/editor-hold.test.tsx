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
  // useEditor destroys the editor on a timer after unmount; let it run while
  // jsdom's window still exists, or it throws after the file's environment is gone.
  await new Promise((r) => setTimeout(r, 10));
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

  it("carries no caret the writer never placed, and puts one back without taking focus from the Search panel", async () => {
    const search = document.createElement("input");
    document.body.appendChild(search);
    search.focus();
    const ref = createRef<EditorHandle>();
    let landed = "";
    const content = '<p data-block-id="a">First line.</p><p data-block-id="b">Second line.</p>';
    await act(async () =>
      root.render(<Editor ref={ref} content={content} onChange={(html) => (landed = html)} />)
    );
    await settle();
    // Replace all remounts a page the writer never clicked into: nothing to carry.
    expect(ref.current?.getCaret()).toBeNull();
    // A caret carried over from an unfocused page comes back without focus.
    const focused: Element[] = [];
    const focus = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement) {
      focused.push(this);
    });
    await act(async () =>
      root.render(
        <Editor
          key="remounted"
          ref={ref}
          content={content}
          onChange={(html) => (landed = html)}
          restorePosition={{ blockId: "b", offset: 12, focus: false }}
        />
      )
    );
    await settle();
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    focus.mockRestore();
    expect(focused.filter((el) => el.classList.contains("ProseMirror"))).toEqual([]);
    expect(document.activeElement).toBe(search);
    expect(ref.current?.getCaret()).toEqual({ blockId: "b", offset: 12 });
    await act(async () => ref.current?.insertDictation("more words"));
    expect(landed).toMatch(/Second line\. [Mm]ore words/);
    search.remove();
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
