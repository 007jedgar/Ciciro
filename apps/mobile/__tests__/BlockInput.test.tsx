import { StyleSheet, Text, type TextInput } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { BlockInput, type BlockInputProps } from "../components/BlockInput";
import { CARET_GUARD, toNativeOffset, withCaretGuard } from "../lib/editor-session";
import type { ManuscriptBlock } from "../lib/manuscript";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

const ORIGINAL = "Hello this is first test of the chapter writing.";
const EDITED = "Hello this is the second test of the chapter writing.";

const block: ManuscriptBlock = {
  id: "b1",
  kind: "paragraph",
  html: `<p data-block-id="b1">${ORIGINAL}</p>`,
  text: ORIGINAL,
};

const editorStyle = {
  fontFamily: "Georgia",
  fontSize: 18,
  lineHeight: 28,
  color: "#2a2218",
};

function renderBlock(overrides: Partial<BlockInputProps> = {}) {
  const draftsRef = overrides.draftsRef ?? { current: new Map<string, string>() };
  const props: BlockInputProps = {
    block,
    editorStyle,
    autoCorrect: false,
    focused: false,
    resumeOffset: null,
    pendingFocus: null,
    popup: null,
    draftsRef,
    onFocused: jest.fn(),
    onBlurred: jest.fn(),
    onDraft: jest.fn(),
    onSplit: jest.fn(),
    onMerge: jest.fn(),
    onCaret: jest.fn(),
    onComposing: jest.fn(),
    onCaretPlaced: jest.fn(),
    registerInput: jest.fn(),
    ...overrides,
  };
  const result = render(<BlockInput {...props} />);
  return { ...result, props, draftsRef };
}

async function flushFrames() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe("BlockInput", () => {
  it("keeps typing when a focused block gets stale HTML from sync", () => {
    const { rerender, props } = renderBlock({ focused: true });
    const input = screen.getByTestId("block-b1");
    fireEvent(input, "focus");
    fireEvent.changeText(input, EDITED);
    expect(input.props.value).toBe(withCaretGuard(EDITED));

    rerender(
      <BlockInput
        {...props}
        focused
        block={{ ...block, text: ORIGINAL, html: `<p data-block-id="b1">${ORIGINAL}</p>` }}
      />
    );
    expect(screen.getByTestId("block-b1").props.value).toBe(withCaretGuard(EDITED));
  });

  it("restores the in-progress draft if the row remounts", () => {
    const draftsRef = { current: new Map<string, string>() };
    const first = renderBlock({ focused: true, draftsRef });
    fireEvent.changeText(screen.getByTestId("block-b1"), EDITED);
    first.unmount();

    renderBlock({
      focused: true,
      draftsRef,
      block: { ...block, text: ORIGINAL },
    });
    expect(screen.getByTestId("block-b1").props.value).toBe(withCaretGuard(EDITED));
  });

  it("aligns prose to the top left and does not pass a controlled selection", () => {
    renderBlock();
    const input = screen.getByTestId("block-b1");
    const style = StyleSheet.flatten(input.props.style);
    expect(style.textAlign).toBe("left");
    expect(style.textAlignVertical).toBe("top");
    expect(input.props.selection).toBeUndefined();
    expect(input.props.selectTextOnFocus).toBe(false);
  });

  it("registers the native input so split/merge can move focus", () => {
    const registerInput = jest.fn();
    renderBlock({ registerInput });
    expect(registerInput).toHaveBeenCalledWith("b1", expect.anything());
    const node = registerInput.mock.calls[0][1] as TextInput | null;
    expect(node).not.toBeNull();
  });

  it("starts a new paragraph when Return inserts a newline", () => {
    const onSplit = jest.fn();
    renderBlock({ focused: true, onSplit });
    fireEvent.changeText(screen.getByTestId("block-b1"), `${ORIGINAL}\nmore`);
    expect(onSplit).toHaveBeenCalledWith("b1", ORIGINAL, "more");
    expect(screen.getByTestId("block-b1").props.value).toBe(withCaretGuard(ORIGINAL));
  });

  it("does not split at offset 0 when the Return key fires before the newline", () => {
    const onSplit = jest.fn();
    renderBlock({ focused: true, onSplit });
    const input = screen.getByTestId("block-b1");
    fireEvent(input, "keyPress", { nativeEvent: { key: "Enter" } });
    expect(onSplit).not.toHaveBeenCalled();
    expect(input.props.value).toBe(withCaretGuard(ORIGINAL));
  });

  it("splits at the native newline when the caret report is still at the start", () => {
    const onSplit = jest.fn();
    renderBlock({ focused: true, onSplit });
    const input = screen.getByTestId("block-b1");
    fireEvent(input, "textInput", {
      nativeEvent: {
        text: "\n",
        previousText: withCaretGuard(ORIGINAL),
        range: { start: toNativeOffset(ORIGINAL.length), end: toNativeOffset(ORIGINAL.length) },
      },
    });
    expect(onSplit).toHaveBeenCalledWith("b1", ORIGINAL, "");
    expect(input.props.value).toBe(withCaretGuard(ORIGINAL));
  });

  it("strips a leftover Return newline without inserting a second paragraph", () => {
    const onSplit = jest.fn();
    renderBlock({ focused: true, onSplit });
    const input = screen.getByTestId("block-b1");
    fireEvent.changeText(input, `${ORIGINAL}\n`);
    fireEvent.changeText(input, `${ORIGINAL}\n`);
    expect(onSplit).toHaveBeenCalledTimes(1);
    expect(onSplit).toHaveBeenCalledWith("b1", ORIGINAL, "");
    expect(input.props.value).toBe(withCaretGuard(ORIGINAL));
  });

  it("inserts a paragraph before when Return lands at the start of the field", () => {
    const onSplit = jest.fn();
    renderBlock({ focused: true, onSplit });
    fireEvent.changeText(screen.getByTestId("block-b1"), `\n${ORIGINAL}`);
    expect(onSplit).toHaveBeenCalledWith("b1", "", ORIGINAL);
  });

  it("starts a new paragraph when Return does not insert a newline", async () => {
    const onSplit = jest.fn();
    renderBlock({ focused: true, onSplit });
    const input = screen.getByTestId("block-b1");
    fireEvent(input, "selectionChange", {
      nativeEvent: { selection: { start: toNativeOffset(ORIGINAL.length), end: toNativeOffset(ORIGINAL.length) } },
    });
    fireEvent(input, "submitEditing");
    await flushFrames();
    expect(onSplit).toHaveBeenCalledWith("b1", ORIGINAL, "");
  });

  it("paints bold on the marked characters instead of the whole paragraph", () => {
    renderBlock({
      block: {
        ...block,
        html: `<p data-block-id="b1"><strong>He</strong>llo this is first test of the chapter writing.</p>`,
      },
    });
    const overlay = screen.getByTestId("block-b1-marks");
    const marked = overlay.findAllByType(Text).filter((node) => {
      const style = StyleSheet.flatten(node.props.style);
      return style?.fontWeight === "600" && node.props.children === "He";
    });
    expect(marked).toHaveLength(1);
    expect(StyleSheet.flatten(screen.getByTestId("block-b1").props.style).fontWeight).toBe("400");
    expect(StyleSheet.flatten(screen.getByTestId("block-b1").props.style).color).toBe("transparent");
  });

  it("reports the selected character range", () => {
    const onCaret = jest.fn();
    renderBlock({ focused: true, onCaret });
    fireEvent(screen.getByTestId("block-b1"), "selectionChange", {
      nativeEvent: { selection: { start: toNativeOffset(1), end: toNativeOffset(2) } },
    });
    expect(onCaret).toHaveBeenCalledWith("b1", 1, 2);
  });

  it("pins a format bubble to a highlighted range", () => {
    const onToggleMark = jest.fn();
    renderBlock({
      formatBubble: {
        start: 1,
        end: 5,
        marks: { bold: false, italic: false, underline: false, strike: false },
        onToggleMark,
      },
    });
    expect(screen.getByTestId("format-bubble")).toBeTruthy();
    fireEvent(screen.getByLabelText("Bold"), "pressIn");
    expect(onToggleMark).toHaveBeenCalledWith("bold");
  });

  it("opens a paragraph menu from a long press", () => {
    const onPressFormat = jest.fn();
    const onSetKind = jest.fn();
    renderBlock({
      onPressFormat,
      pressMenu: { kind: "paragraph", onSetKind },
    });
    fireEvent(screen.getByTestId("block-b1-wrap"), "longPress");
    expect(onPressFormat).toHaveBeenCalled();
    expect(screen.getByTestId("format-press")).toBeTruthy();
    fireEvent(screen.getByLabelText("Quote"), "pressIn");
    expect(onSetKind).toHaveBeenCalledWith("quote");
  });

  it("does not empty the paragraph when submitEditing is stuck at offset 0", async () => {
    const onSplit = jest.fn();
    renderBlock({ focused: true, onSplit });
    const input = screen.getByTestId("block-b1");
    fireEvent(input, "submitEditing");
    fireEvent.changeText(input, `${ORIGINAL}\n`);
    await flushFrames();
    expect(onSplit).toHaveBeenCalledTimes(1);
    expect(onSplit).toHaveBeenCalledWith("b1", ORIGINAL, "");
    expect(input.props.value).toBe(withCaretGuard(ORIGINAL));
  });

  it("places the pending caret only after the native field focuses", () => {
    const onCaretPlaced = jest.fn();
    renderBlock({ pendingFocus: { id: "b1", offset: 0 }, onCaretPlaced });
    expect(onCaretPlaced).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId("block-b1"), "focus");
    expect(onCaretPlaced).toHaveBeenCalledWith("b1");
  });

  it("applies an accepted correction to the live field", async () => {
    const onCaretPlaced = jest.fn();
    const draftsRef = { current: new Map([["b1", ORIGINAL]]) };
    const corrected = "Hello this is the second test of the chapter writing.";
    const { rerender, props } = renderBlock({
      focused: true,
      draftsRef,
      onCaretPlaced,
    });
    fireEvent(screen.getByTestId("block-b1"), "focus");
    rerender(
      <BlockInput
        {...props}
        focused
        draftsRef={draftsRef}
        onCaretPlaced={onCaretPlaced}
        pendingFocus={{ id: "b1", offset: corrected.length, text: corrected }}
      />
    );
    await flushFrames();
    expect(screen.getByTestId("block-b1").props.value).toBe(withCaretGuard(corrected));
    expect(draftsRef.current.get("b1")).toBe(corrected);
    expect(onCaretPlaced).toHaveBeenCalledWith("b1");
  });

  it("lets a paragraph grow instead of locking one line of height", () => {
    renderBlock();
    const style = StyleSheet.flatten(screen.getByTestId("block-b1").props.style);
    expect(style.height).toBeUndefined();
    expect(style.minHeight).toBe(28);
    expect(screen.getByTestId("block-b1").props.submitBehavior).toBe("newline");
  });

  it("sizes the paragraph from the painted prose, not the native field", () => {
    // iOS reports a multiline field's content height a frame or two late, and
    // it still holds the Return newline while the controlled value catches up.
    // While that field drove layout, every Return and Backspace bounced the
    // page: a short frame, then a frame one line too tall, then the truth.
    renderBlock();
    const painted = StyleSheet.flatten(screen.getByTestId("block-b1-marks").props.style);
    expect(painted.position).toBeUndefined();
    expect(painted.minHeight).toBe(28);
    const field = StyleSheet.flatten(screen.getByTestId("block-b1").props.style);
    expect(field.position).toBe("absolute");
    expect(field.top).toBe(0);
    expect(field.left).toBe(0);
    expect(field.right).toBe(0);
  });

  it("keeps marked letters on the same typeface as the field", () => {
    renderBlock({
      block: {
        ...block,
        html: `<p data-block-id="b1"><em>Hello</em> this is first test of the chapter writing.</p>`,
      },
    });
    const overlay = screen.getByTestId("block-b1-marks");
    const italic = overlay.findAllByType(Text).filter((node) => {
      const nested = StyleSheet.flatten(node.props.style);
      return nested?.fontStyle === "italic" && node.props.children === "Hello";
    });
    expect(italic).toHaveLength(1);
    expect(StyleSheet.flatten(italic[0].props.style).fontFamily).toBe("Georgia");
    expect(StyleSheet.flatten(italic[0].props.style).fontSize).toBe(18);
  });

  it("paints the caret on the overlay so mixed marks cannot shove it through a letter", () => {
    renderBlock({ focused: true });
    fireEvent(screen.getByTestId("block-b1"), "focus");
    expect(screen.getByTestId("block-b1").props.caretHidden).toBe(true);
    expect(screen.getByTestId("block-b1-caret")).toBeTruthy();
    fireEvent(screen.getByTestId("block-b1-caret-probe"), "textLayout", {
      nativeEvent: {
        lines: [{ x: 0, y: 0, width: 120, height: 28, text: ORIGINAL.slice(0, 10) }],
      },
    });
    const caret = StyleSheet.flatten(screen.getByTestId("block-b1-caret").props.style);
    expect(caret.left).toBe(119);
    expect(caret.transform).toBeUndefined();
  });

  it("slants the caret when the insertion point is in italic", () => {
    renderBlock({
      focused: true,
      block: {
        ...block,
        html: `<p data-block-id="b1"><em>${ORIGINAL}</em></p>`,
      },
    });
    fireEvent(screen.getByTestId("block-b1"), "focus");
    fireEvent(screen.getByTestId("block-b1"), "selectionChange", {
      nativeEvent: { selection: { start: toNativeOffset(4), end: toNativeOffset(4) } },
    });
    const caret = StyleSheet.flatten(screen.getByTestId("block-b1-caret").props.style);
    expect(caret.transform).toEqual([{ skewX: "-13deg" }]);
  });

  it("adopts the folded-in text when a merge sends the caret back", async () => {
    // Backspace at offset 0 lands on a paragraph that is already mounted and
    // already holds a draft entry, so neither sync effect will pick the merged
    // sentence up. It has to arrive with the caret.
    const draftsRef = { current: new Map([["b1", ORIGINAL]]) };
    const merged = `${ORIGINAL} And the rest of it.`;
    const { rerender, props } = renderBlock({ draftsRef });
    expect(screen.getByTestId("block-b1").props.value).toBe(withCaretGuard(ORIGINAL));

    rerender(
      <BlockInput
        {...props}
        draftsRef={draftsRef}
        pendingFocus={{ id: "b1", offset: ORIGINAL.length, text: merged }}
      />
    );
    fireEvent(screen.getByTestId("block-b1"), "focus");
    await flushFrames();
    expect(screen.getByTestId("block-b1").props.value).toBe(withCaretGuard(merged));
    expect(draftsRef.current.get("b1")).toBe(merged);
  });

  it("merges when the leading caret guard is deleted", () => {
    const onMerge = jest.fn();
    renderBlock({ focused: true, onMerge });
    const input = screen.getByTestId("block-b1");
    expect(input.props.value).toBe(withCaretGuard(ORIGINAL));
    fireEvent.changeText(input, ORIGINAL);
    expect(onMerge).toHaveBeenCalledWith("b1", ORIGINAL);
  });

  it("merges on a native textInput backspace at offset 0", () => {
    const onMerge = jest.fn();
    renderBlock({ focused: true, onMerge });
    const input = screen.getByTestId("block-b1");
    fireEvent(input, "selectionChange", {
      nativeEvent: { selection: { start: CARET_GUARD.length, end: CARET_GUARD.length } },
    });
    fireEvent(input, "textInput", {
      nativeEvent: { text: "", previousText: withCaretGuard(ORIGINAL), range: { start: 0, end: 0 } },
    });
    expect(onMerge).toHaveBeenCalledWith("b1", ORIGINAL);
  });
});
