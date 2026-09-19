import { fireEvent, render, screen } from "@testing-library/react-native";
import {
  ChapterEditor,
  kindFromEnrichedState,
  marksFromEnrichedState,
} from "../components/ChapterEditor";
import type { EnrichedTextInputInstance, OnChangeStateEvent } from "react-native-enriched-html";

const editorStyle = {
  fontFamily: "Georgia",
  fontSize: 18,
  lineHeight: 28,
  color: "#2a2218",
};

const html = '<p data-block-id="a">Hello there.</p>';

function style(overrides: Partial<OnChangeStateEvent> = {}): OnChangeStateEvent {
  const off = { isActive: false, isConflicting: false, isBlocking: false };
  const on = { isActive: true, isConflicting: false, isBlocking: false };
  return {
    bold: off,
    italic: off,
    underline: off,
    strikeThrough: off,
    inlineCode: off,
    h1: off,
    h2: off,
    h3: off,
    h4: off,
    h5: off,
    h6: off,
    codeBlock: off,
    blockQuote: off,
    orderedList: off,
    unorderedList: off,
    link: off,
    image: off,
    mention: off,
    checkboxList: off,
    alignment: "left",
    ...overrides,
  } as OnChangeStateEvent;
}

describe("ChapterEditor", () => {
  it("does not clobber the native buffer while focused", () => {
    const registerEditor = jest.fn();
    const { rerender } = render(
      <ChapterEditor
        chapterId="c1"
        html={html}
        editorStyle={editorStyle}
        focused
        resumeOffset={null}
        onFocused={jest.fn()}
        onBlurred={jest.fn()}
        onChangeText={jest.fn()}
        onChangeState={jest.fn()}
        onChangeSelection={jest.fn()}
        registerEditor={registerEditor}
      />
    );
    const editor = registerEditor.mock.calls[0][0] as EnrichedTextInputInstance;
    const setValue = jest.spyOn(editor, "setValue");
    rerender(
      <ChapterEditor
        chapterId="c1"
        html='<p data-block-id="a">Stale from sync.</p>'
        editorStyle={editorStyle}
        focused
        resumeOffset={null}
        onFocused={jest.fn()}
        onBlurred={jest.fn()}
        onChangeText={jest.fn()}
        onChangeState={jest.fn()}
        onChangeSelection={jest.fn()}
        registerEditor={registerEditor}
      />
    );
    expect(setValue).not.toHaveBeenCalled();
  });

  it("adopts remote HTML once the field is not focused", async () => {
    const registerEditor = jest.fn();
    const props = {
      chapterId: "c1",
      html,
      editorStyle,
      focused: false,
      resumeOffset: null as number | null,
      onFocused: jest.fn(),
      onBlurred: jest.fn(),
      onChangeText: jest.fn(),
      onChangeState: jest.fn(),
      onChangeSelection: jest.fn(),
      registerEditor,
    };
    const { rerender } = render(<ChapterEditor {...props} />);
    const editor = [...registerEditor.mock.calls].reverse().find((call) => call[0])?.[0] as
      | EnrichedTextInputInstance
      | undefined;
    expect(editor).toBeTruthy();
    rerender(<ChapterEditor {...props} html='<p data-block-id="a">From the desk.</p>' />);
    await expect(editor!.getHTML()).resolves.toBe("<p>From the desk.</p>");
  });

  it("reads toolbar state from the native style payload", () => {
    expect(marksFromEnrichedState(style({ italic: { isActive: true, isConflicting: false, isBlocking: false } })).italic).toBe(
      true
    );
    expect(kindFromEnrichedState(style({ h2: { isActive: true, isConflicting: false, isBlocking: false } }))).toBe(
      "heading"
    );
    expect(
      kindFromEnrichedState(style({ unorderedList: { isActive: true, isConflicting: false, isBlocking: false } }))
    ).toBe("list_item");
  });

  it("forwards typing to the host", () => {
    const onChangeText = jest.fn();
    render(
      <ChapterEditor
        chapterId="c1"
        html={html}
        editorStyle={editorStyle}
        focused
        resumeOffset={null}
        onFocused={jest.fn()}
        onBlurred={jest.fn()}
        onChangeText={onChangeText}
        onChangeState={jest.fn()}
        onChangeSelection={jest.fn()}
        registerEditor={jest.fn()}
      />
    );
    fireEvent.changeText(screen.getByTestId("chapter-editor"), "Hello there. More.");
    expect(onChangeText).toHaveBeenCalledWith("Hello there. More.");
  });

  it("opens the long-press menu after a stationary hold", () => {
    jest.useFakeTimers();
    const onLongPress = jest.fn();
    try {
      render(
        <ChapterEditor
          chapterId="c1"
          html={html}
          editorStyle={editorStyle}
          focused
          resumeOffset={null}
          onFocused={jest.fn()}
          onBlurred={jest.fn()}
          onChangeText={jest.fn()}
          onChangeState={jest.fn()}
          onChangeSelection={jest.fn()}
          onLongPress={onLongPress}
          registerEditor={jest.fn()}
        />
      );
      fireEvent(screen.getByTestId("chapter-editor-shell"), "touchStart", {
        nativeEvent: { pageX: 12, pageY: 40 },
      });
      jest.advanceTimersByTime(419);
      expect(onLongPress).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(onLongPress).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("cancels a long-press when the finger moves", () => {
    jest.useFakeTimers();
    const onLongPress = jest.fn();
    try {
      render(
        <ChapterEditor
          chapterId="c1"
          html={html}
          editorStyle={editorStyle}
          focused
          resumeOffset={null}
          onFocused={jest.fn()}
          onBlurred={jest.fn()}
          onChangeText={jest.fn()}
          onChangeState={jest.fn()}
          onChangeSelection={jest.fn()}
          onLongPress={onLongPress}
          registerEditor={jest.fn()}
        />
      );
      fireEvent(screen.getByTestId("chapter-editor-shell"), "touchStart", {
        nativeEvent: { pageX: 12, pageY: 40 },
      });
      fireEvent(screen.getByTestId("chapter-editor-shell"), "touchMove", {
        nativeEvent: { pageX: 12, pageY: 80 },
      });
      jest.advanceTimersByTime(500);
      expect(onLongPress).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
