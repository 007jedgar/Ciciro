import { StyleSheet, type TextInput } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { BlockInput, type BlockInputProps } from "../components/BlockInput";
import { CARET_GUARD, toNativeOffset, withCaretGuard } from "../lib/editor-session";
import type { ManuscriptBlock } from "../lib/manuscript";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
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

  it("starts a new paragraph when Return does not insert a newline", () => {
    const onSplit = jest.fn();
    renderBlock({ focused: true, onSplit });
    const input = screen.getByTestId("block-b1");
    fireEvent(input, "selectionChange", {
      nativeEvent: { selection: { start: toNativeOffset(ORIGINAL.length), end: toNativeOffset(ORIGINAL.length) } },
    });
    fireEvent(input, "submitEditing");
    expect(onSplit).toHaveBeenCalledWith("b1", ORIGINAL, "");
  });

  it("lets a paragraph grow instead of locking one line of height", () => {
    renderBlock();
    const style = StyleSheet.flatten(screen.getByTestId("block-b1").props.style);
    expect(style.height).toBeUndefined();
    expect(style.minHeight).toBe(28);
    expect(screen.getByTestId("block-b1").props.submitBehavior).toBe("newline");
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
