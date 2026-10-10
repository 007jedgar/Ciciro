import { act, fireEvent, render, screen } from "@testing-library/react-native";
import {
  ChapterEditor,
  paragraphSpacingFor,
  kindFromEnrichedState,
  marksFromEnrichedState,
} from "../components/ChapterEditor";
import type { EnrichedTextInputInstance, OnChangeStateEvent } from "react-native-enriched-html";
import { screenplayLayoutConfig, scriptEditorMetrics } from "../lib/script-layout";
import { fonts } from "../lib/theme";

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
  it("does not clobber the native buffer while an edit is in flight", async () => {
    const registerEditor = jest.fn();
    const { rerender } = render(
      <ChapterEditor
        chapterId="c1"
        html={html}
        editorStyle={editorStyle}
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
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("chapter-editor"), "Hello there. Typing now.");
    });
    rerender(
      <ChapterEditor
        chapterId="c1"
        html='<p data-block-id="a">Stale from sync.</p>'
        editorStyle={editorStyle}
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

  it("keeps the native defaultValue fixed while the chapter's html moves on", async () => {
    // A changed defaultValue makes the native view replace its buffer and put
    // the caret at the end of the chapter, so a commit mid-paragraph (typing
    // pauses, an accepted correction) sent the writer's next words there.
    const props = {
      chapterId: "c1",
      html,
      editorStyle,
      resumeOffset: null,
      onFocused: jest.fn(),
      onBlurred: jest.fn(),
      onChangeText: jest.fn(),
      onChangeState: jest.fn(),
      onChangeSelection: jest.fn(),
      registerEditor: jest.fn(),
    };
    const { rerender } = render(<ChapterEditor {...props} />);
    const mounted = screen.getByTestId("chapter-editor").props.defaultValue;
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("chapter-editor"), "Hello there. Typing now.");
    });
    rerender(
      <ChapterEditor {...props} html='<p data-block-id="a">Hello there. Typing now.</p>' />
    );
    expect(screen.getByTestId("chapter-editor").props.defaultValue).toBe(mounted);
    rerender(
      <ChapterEditor {...props} chapterId="c2" html='<p data-block-id="b">Chapter two.</p>' />
    );
    expect(screen.getByTestId("chapter-editor").props.defaultValue).toContain("Chapter two.");
  });

  it("re-registers the native editor when the chapter switches, so a stale ref is never left behind", () => {
    // `key={chapterId}` remounts a fresh native view on every chapter switch,
    // but this component keeps its one React instance. An effect gated on
    // `[registerEditor]` alone only ever registers the first chapter's native
    // instance and leaves the screen's ref pointed at a now-unmounted view
    // forever after, so a later flush's `getHTML()` rejects and the edit in
    // flight is lost. Registration has to re-run per chapter.
    const registerEditor = jest.fn();
    const props = {
      chapterId: "c1",
      html,
      editorStyle,
      resumeOffset: null as number | null,
      onFocused: jest.fn(),
      onBlurred: jest.fn(),
      onChangeText: jest.fn(),
      onChangeState: jest.fn(),
      onChangeSelection: jest.fn(),
      registerEditor,
    };
    const { rerender } = render(<ChapterEditor {...props} />);
    const firstInstance = registerEditor.mock.calls[0][0];
    expect(firstInstance).not.toBeNull();

    rerender(<ChapterEditor {...props} chapterId="c2" html='<p data-block-id="b">Chapter two.</p>' />);

    const lastCall = registerEditor.mock.calls[registerEditor.mock.calls.length - 1];
    expect(lastCall[0]).not.toBeNull();
    expect(lastCall[0]).not.toBe(firstInstance);
  });

  it("adopts remote HTML when nothing has been typed yet", async () => {
    const registerEditor = jest.fn();
    const props = {
      chapterId: "c1",
      html,
      editorStyle,
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

  it("still adopts a content correction after a programmatic focus with no typing (cold-open race)", async () => {
    // Reproduces the bug-2 trigger: the resume effect focuses the input
    // imperatively to restore the caret on reopen, before the user has typed
    // anything. That native focus alone must never block a legitimate later
    // correction to `html` - only an actual edit should.
    const registerEditor = jest.fn();
    const props = {
      chapterId: "c1",
      html,
      editorStyle,
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
    fireEvent(screen.getByTestId("chapter-editor"), "focus");
    rerender(<ChapterEditor {...props} html='<p data-block-id="a">From the desk.</p>' />);
    await expect(editor!.getHTML()).resolves.toBe("<p>From the desk.</p>");
  });

  function renderForEcho(initial: string) {
    const registerEditor = jest.fn();
    const props = {
      chapterId: "c1",
      html: initial,
      editorStyle,
      resumeOffset: null as number | null,
      onFocused: jest.fn(),
      onBlurred: jest.fn(),
      onChangeText: jest.fn(),
      onChangeState: jest.fn(),
      onChangeSelection: jest.fn(),
      registerEditor,
    };
    const view = render(<ChapterEditor {...props} />);
    const editor = [...registerEditor.mock.calls].reverse().find((call) => call[0])?.[0] as
      | (EnrichedTextInputInstance & { emitNativeChangeText: (value: string) => void })
      | undefined;
    expect(editor).toBeTruthy();
    return { ...view, props, editor: editor! };
  }

  it("ignores a native onChangeText echo of its own setValue, so a later correction still lands", async () => {
    // The native editor re-emits onChangeText for a programmatic setValue,
    // not just for real typing, before the user has touched anything. Only
    // a buffer that differs from what the sync effect applied is a real edit.
    const { props, editor, rerender } = renderForEcho(html);
    await act(async () => editor.emitNativeChangeText("Hello there."));
    expect(props.onChangeText).not.toHaveBeenCalled();
    rerender(<ChapterEditor {...props} html='<p data-block-id="a">From the desk.</p>' />);
    await expect(editor.getHTML()).resolves.toBe("<p>From the desk.</p>");
  });

  it("ignores the newline-separated echo of a multi-paragraph quote", async () => {
    const quote = '<blockquote data-block-id="q"><p>Line one.</p><p>Line two.</p></blockquote>';
    const { props, editor, rerender } = renderForEcho(quote);
    await act(async () => editor.emitNativeChangeText("Line one.\nLine two."));
    expect(props.onChangeText).not.toHaveBeenCalled();
    rerender(
      <ChapterEditor
        {...props}
        html='<blockquote data-block-id="q"><p>Line one.</p><p>Line two, corrected.</p></blockquote>'
      />
    );
    await expect(editor.getHTML()).resolves.toBe(
      "<blockquote><p>Line one.</p><p>Line two, corrected.</p></blockquote>"
    );
  });

  it("still treats the first keystroke after a sync as a real edit", async () => {
    const { props, editor, rerender } = renderForEcho(html);
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("chapter-editor"), "Hello there. Typing now.");
    });
    expect(props.onChangeText).toHaveBeenCalledWith("Hello there. Typing now.");
    const setValue = jest.spyOn(editor, "setValue");
    rerender(<ChapterEditor {...props} html='<p data-block-id="a">Stale from sync.</p>' />);
    expect(setValue).not.toHaveBeenCalled();
  });

  it("holds a correction that arrives while an echo is being checked, then applies it", async () => {
    const { props, editor, rerender } = renderForEcho(html);
    const setValue = jest.spyOn(editor, "setValue");
    act(() => editor.emitNativeChangeText("Hello there."));
    rerender(<ChapterEditor {...props} html='<p data-block-id="a">From the desk.</p>' />);
    expect(setValue).not.toHaveBeenCalled();
    await act(async () => {});
    expect(props.onChangeText).not.toHaveBeenCalled();
    await expect(editor.getHTML()).resolves.toBe("<p>From the desk.</p>");
  });

  it("tells the screen when a correction replaces the buffer", () => {
    const onContentApplied = jest.fn();
    const { props, rerender } = renderForEcho(html);
    rerender(
      <ChapterEditor
        {...props}
        onContentApplied={onContentApplied}
        html='<p data-block-id="a">From the desk.</p>'
      />
    );
    expect(onContentApplied).toHaveBeenCalledTimes(1);
    rerender(
      <ChapterEditor
        {...props}
        onContentApplied={onContentApplied}
        html='<p data-block-id="b">From the desk.</p>'
      />
    );
    expect(onContentApplied).toHaveBeenCalledTimes(1);
  });

  it("lets corrections land again once an unfocused edit (dictation after blur) commits", async () => {
    const { props, editor, rerender } = renderForEcho(html);
    const markEdited = props.registerEditor.mock.calls.find((call) => call[0])?.[1] as () => void;
    markEdited();
    editor.setValue("<html><p>Hello there. Dictated.</p></html>");
    const setValue = jest.spyOn(editor, "setValue");
    rerender(<ChapterEditor {...props} html='<p data-block-id="a">Hello there. Dictated.</p>' />);
    await act(async () => {});
    expect(setValue).not.toHaveBeenCalled();
    rerender(<ChapterEditor {...props} html='<p data-block-id="a">From the desk.</p>' />);
    await expect(editor.getHTML()).resolves.toBe("<p>From the desk.</p>");
  });

  it("discards an unfocused settle read that a newer edit overtook", async () => {
    const { props, editor, rerender } = renderForEcho(html);
    const markEdited = props.registerEditor.mock.calls.find((call) => call[0])?.[1] as () => void;
    markEdited();
    editor.setValue("<html><p>Hello there. Phrase one.</p></html>");
    rerender(
      <ChapterEditor {...props} html='<p data-block-id="a">Hello there. Phrase one.</p>' />
    );
    markEdited();
    editor.setValue("<html><p>Hello there. Phrase one. Phrase two.</p></html>");
    await act(async () => {});
    const setValue = jest.spyOn(editor, "setValue");
    rerender(<ChapterEditor {...props} html='<p data-block-id="a">From the desk.</p>' />);
    await act(async () => {});
    expect(setValue).not.toHaveBeenCalled();
  });

  it("keeps an unfocused edit protected until html holds that edit's own content", async () => {
    const { props, editor, rerender } = renderForEcho(html);
    const markEdited = props.registerEditor.mock.calls.find((call) => call[0])?.[1] as () => void;
    markEdited();
    editor.setValue("<html><p>Hello there. Phrase one. Phrase two.</p></html>");
    const setValue = jest.spyOn(editor, "setValue");
    rerender(
      <ChapterEditor {...props} html='<p data-block-id="a">Hello there. Phrase one.</p>' />
    );
    await act(async () => {});
    rerender(<ChapterEditor {...props} html='<p data-block-id="a">From the desk.</p>' />);
    await act(async () => {});
    expect(setValue).not.toHaveBeenCalled();
    await expect(editor.getHTML()).resolves.toBe(
      "<html><p>Hello there. Phrase one. Phrase two.</p></html>"
    );
  });

  it("holds off syncing after a toolbar or dictation edit reported through markEdited", () => {
    const registerEditor = jest.fn();
    const props = {
      chapterId: "c1",
      html,
      editorStyle,
      resumeOffset: null as number | null,
      onFocused: jest.fn(),
      onBlurred: jest.fn(),
      onChangeText: jest.fn(),
      onChangeState: jest.fn(),
      onChangeSelection: jest.fn(),
      registerEditor,
    };
    const { rerender } = render(<ChapterEditor {...props} />);
    const [editor, markEdited] = [...registerEditor.mock.calls].reverse().find((call) => call[0]) as [
      EnrichedTextInputInstance,
      () => void,
    ];
    const setValue = jest.spyOn(editor, "setValue");
    markEdited();
    rerender(<ChapterEditor {...props} html='<p data-block-id="a"><strong>Hello</strong> there.</p>' />);
    expect(setValue).not.toHaveBeenCalled();
  });

  it("leaves the buffer alone when new html renders the same as what it last applied", () => {
    const registerEditor = jest.fn();
    const props = {
      chapterId: "c1",
      html,
      editorStyle,
      resumeOffset: null as number | null,
      onFocused: jest.fn(),
      onBlurred: jest.fn(),
      onChangeText: jest.fn(),
      onChangeState: jest.fn(),
      onChangeSelection: jest.fn(),
      registerEditor,
    };
    const { rerender } = render(<ChapterEditor {...props} />);
    const editor = [...registerEditor.mock.calls].reverse().find((call) => call[0])?.[0] as EnrichedTextInputInstance;
    const setValue = jest.spyOn(editor, "setValue");
    rerender(<ChapterEditor {...props} html='<p data-block-id="b">Hello there.</p>' />);
    expect(setValue).not.toHaveBeenCalled();
  });

  it("resumes adopting corrections once the field blurs after typing", async () => {
    const registerEditor = jest.fn();
    const props = {
      chapterId: "c1",
      html,
      editorStyle,
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
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("chapter-editor"), "Hello there. Typing now.");
    });
    const setValue = jest.spyOn(editor!, "setValue");
    rerender(<ChapterEditor {...props} html='<p data-block-id="a">Stale from sync.</p>' />);
    expect(setValue).not.toHaveBeenCalled();
    fireEvent(screen.getByTestId("chapter-editor"), "blur");
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

  it("spaces paragraphs in ems of the editor font, without storing blank paragraphs", () => {
    expect(paragraphSpacingFor(20)).toBeCloseTo(18);
    render(
      <ChapterEditor
        chapterId="c1"
        html={html}
        editorStyle={editorStyle}
        resumeOffset={null}
        onFocused={jest.fn()}
        onBlurred={jest.fn()}
        onChangeText={jest.fn()}
        onChangeState={jest.fn()}
        onChangeSelection={jest.fn()}
        registerEditor={jest.fn()}
      />
    );
    const input = screen.getByTestId("chapter-editor");
    expect(input.props.paragraphSpacing).toBeCloseTo(editorStyle.fontSize * 0.9);
    expect(input.props.defaultValue).not.toMatch(/<p>\s*<\/p>/);
  });

  it("forwards typing to the host", async () => {
    const onChangeText = jest.fn();
    render(
      <ChapterEditor
        chapterId="c1"
        html={html}
        editorStyle={editorStyle}
        resumeOffset={null}
        onFocused={jest.fn()}
        onBlurred={jest.fn()}
        onChangeText={onChangeText}
        onChangeState={jest.fn()}
        onChangeSelection={jest.fn()}
        registerEditor={jest.fn()}
      />
    );
    await act(async () => {
      fireEvent.changeText(screen.getByTestId("chapter-editor"), "Hello there. More.");
    });
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

  it("pads only the bottom in typewriter mode so no top of the page is blank", () => {
    render(
      <ChapterEditor
        chapterId="c1"
        html={html}
        editorStyle={editorStyle}
        resumeOffset={null}
        bottomInset={16}
        typewriter
        onFocused={jest.fn()}
        onBlurred={jest.fn()}
        onChangeText={jest.fn()}
        onChangeState={jest.fn()}
        onChangeSelection={jest.fn()}
        registerEditor={jest.fn()}
      />
    );
    fireEvent(screen.getByTestId("chapter-editor-shell"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 396 } },
    });
    const { paddingTop, paddingBottom } = screen.getByTestId("chapter-editor").props.style;
    expect(paddingTop).toBeUndefined();
    expect(paddingBottom).toBe(16 + 190);
  });
  describe("in a script's page layout", () => {
    const script =
      '<p data-block-id="h" data-sp="scene-heading">INT. LAB - DAY</p><p data-block-id="c" data-sp="character">MARA</p>';
    const props = {
      chapterId: "c1",
      html: script,
      editorStyle,
      resumeOffset: null,
      onFocused: jest.fn(),
      onBlurred: jest.fn(),
      onChangeText: jest.fn(),
      onChangeState: jest.fn(),
      onChangeSelection: jest.fn(),
    };
    const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 600 } } });

    it("waits for its width, so the first layout is already the page's", () => {
      render(<ChapterEditor {...props} registerEditor={jest.fn()} scriptLayout />);
      expect(screen.queryByTestId("chapter-editor")).toBeNull();
      fireEvent(screen.getByTestId("chapter-editor-shell"), "layout", layout(390));
      expect(screen.getByTestId("chapter-editor")).toBeTruthy();
    });

    it("sets the type to fit the 60 columns and hands the native view the page", () => {
      render(<ChapterEditor {...props} registerEditor={jest.fn()} scriptLayout />);
      fireEvent(screen.getByTestId("chapter-editor-shell"), "layout", layout(390));
      const input = screen.getByTestId("chapter-editor");
      const { fontSize, lineHeight } = scriptEditorMetrics(390);
      expect(input.props.style).toMatchObject({ fontFamily: fonts.mono, fontSize, lineHeight });
      // A blank line is one line of the page, and the reader's text size never scales it.
      expect(input.props.paragraphSpacing).toBe(lineHeight);
      expect(input.props.allowFontScaling).toBe(false);
      expect(input.props.screenplay).toBe(screenplayLayoutConfig());
    });

    it("gives the native view each line's element, since it carries them itself", () => {
      render(<ChapterEditor {...props} registerEditor={jest.fn()} scriptLayout />);
      fireEvent(screen.getByTestId("chapter-editor-shell"), "layout", layout(390));
      expect(screen.getByTestId("chapter-editor").props.defaultValue).toBe(
        '<p data-sp="scene-heading">INT. LAB - DAY</p><p data-sp="character">MARA</p>'
      );
    });

    it("leaves the editor exactly as it was with the layout off", () => {
      render(<ChapterEditor {...props} registerEditor={jest.fn()} />);
      const input = screen.getByTestId("chapter-editor");
      expect(input.props.screenplay).toBeUndefined();
      expect(input.props.allowFontScaling).toBeUndefined();
      expect(input.props.defaultValue).toBe("<p>INT. LAB - DAY</p><p>MARA</p>");
      expect(input.props.style.fontFamily).toBe(editorStyle.fontFamily);
      expect(input.props.paragraphSpacing).toBeCloseTo(editorStyle.fontSize * 0.9);
    });

    it("remounts the native view when the layout is switched, and re-registers it", () => {
      const registerEditor = jest.fn();
      const { rerender } = render(<ChapterEditor {...props} registerEditor={registerEditor} />);
      const first = registerEditor.mock.calls.filter(([ref]) => ref).at(-1)?.[0];
      rerender(<ChapterEditor {...props} registerEditor={registerEditor} scriptLayout />);
      fireEvent(screen.getByTestId("chapter-editor-shell"), "layout", layout(390));
      expect(screen.getByTestId("chapter-editor").props.defaultValue).toContain("data-sp=");
      const second = registerEditor.mock.calls.filter(([ref]) => ref).at(-1)?.[0];
      expect(second).toBeTruthy();
      expect(second).not.toBe(first);
    });

    it("does not read its own setValue echo as typing, tags and all", async () => {
      const onChangeText = jest.fn();
      const registerEditor = jest.fn();
      const { rerender } = render(
        <ChapterEditor {...props} onChangeText={onChangeText} registerEditor={registerEditor} scriptLayout />
      );
      fireEvent(screen.getByTestId("chapter-editor-shell"), "layout", layout(390));
      const editor = registerEditor.mock.calls.filter(([ref]) => ref).at(-1)?.[0] as EnrichedTextInputInstance & {
        emitNativeChangeText: (value: string) => void;
      };
      rerender(
        <ChapterEditor
          {...props}
          html={'<p data-block-id="h" data-sp="scene-heading">INT. LAB - NIGHT</p><p data-block-id="c" data-sp="character">MARA</p>'}
          onChangeText={onChangeText}
          registerEditor={registerEditor}
          scriptLayout
        />
      );
      await act(async () => editor.emitNativeChangeText("INT. LAB - NIGHT\nMARA"));
      expect(onChangeText).not.toHaveBeenCalled();
    });
  });
});
