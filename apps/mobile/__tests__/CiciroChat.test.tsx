import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, StyleSheet } from "react-native";
import type { ReactNode } from "react";
import { CiciroChat } from "../components/CiciroChat";
import { defaultSettings } from "../lib/app-settings";
import { AppThemeContext } from "../lib/app-theme-context";
import type { ChatMessage } from "../lib/api/types";
import { CLEAR_TIMING } from "../lib/chat-clear";
import { classifyChatFailure } from "../lib/chat-errors";
import { emptyChatStreamState } from "../lib/ciciro-stream";
import { colors, makeLayout } from "../lib/theme";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));

jest.mock("expo-blur", () => {
  const { View } = require("react-native");
  return { BlurView: View };
});

function wrap(ui: ReactNode) {
  const layout = makeLayout(colors);
  return (
    <AppThemeContext.Provider
      value={{
        settings: defaultSettings(),
        colors,
        layout,
        dark: false,
        patch: () => {},
      }}
    >
      {ui}
    </AppThemeContext.Provider>
  );
}

const assistant: ChatMessage = {
  id: "m2",
  role: "assistant",
  content: "A note.\n<draft>The night was long.</draft>",
  kind: "chat",
  turnId: "t1",
  createdAt: "2026-09-14T00:00:00.000Z",
};

const AUTH_FOOTER =
  '401 {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."},"request_id":null}';

const idle = {
  messages: [] as ChatMessage[],
  stream: emptyChatStreamState(),
  streaming: false,
  failure: null,
  phase: null,
  onComposerChange: jest.fn(),
  onSend: jest.fn(),
  onStop: jest.fn(),
  onRetry: jest.fn(),
  onClear: jest.fn(async () => null),
  onUndoClear: jest.fn(),
  onInsertDraft: jest.fn(),
  insertedKeys: new Set<string>(),
  bottomInset: 0,
};

describe("CiciroChat", () => {
  it("shows the empty prompt and hides send until there is text", () => {
    const onSend = jest.fn();
    const { rerender, unmount } = render(
      wrap(<CiciroChat {...idle} composer="   " onSend={onSend} />)
    );
    expect(
      screen.getByText(
        "Ask Ciciro about this manuscript, or pick Continue, Rewrite, or Describe from the writing tools."
      )
    ).toBeTruthy();
    expect(screen.queryByLabelText("Send")).toBeNull();

    rerender(wrap(<CiciroChat {...idle} composer="Tighten the opening." onSend={onSend} />));
    expect(screen.getByLabelText("Send")).toBeTruthy();
    unmount();
  });

  it("sends typed copy and inserts a closed draft into the manuscript", () => {
    const onSend = jest.fn();
    const onInsertDraft = jest.fn();
    const { unmount } = render(
      wrap(
        <CiciroChat
          {...idle}
          messages={[assistant]}
          composer="Tighten the opening."
          onSend={onSend}
          onInsertDraft={onInsertDraft}
        />
      )
    );
    fireEvent.press(screen.getByLabelText("Send"));
    expect(onSend).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByLabelText("Insert into manuscript"));
    expect(onInsertDraft).toHaveBeenCalledWith("The night was long.", "t1", 1);
    unmount();
  });

  it("swaps send for stop while a reply is streaming, and keeps typing alive", () => {
    const onStop = jest.fn();
    const onComposerChange = jest.fn();
    const { unmount } = render(
      wrap(
        <CiciroChat
          {...idle}
          streaming
          composer="Still typing"
          onStop={onStop}
          onComposerChange={onComposerChange}
        />
      )
    );
    expect(screen.queryByLabelText("Send")).toBeNull();
    fireEvent.press(screen.getByLabelText("Stop"));
    expect(onStop).toHaveBeenCalledTimes(1);

    // A turn in flight must not lock the composer.
    const field = screen.getByLabelText("Message Ciciro");
    expect(field.props.editable).not.toBe(false);
    fireEvent.changeText(field, "Still typing more");
    expect(onComposerChange).toHaveBeenCalledWith("Still typing more");
    unmount();
  });

  it("keeps the last reply clear of the dock the thread scrolls under", () => {
    const { unmount } = render(
      wrap(<CiciroChat {...idle} composer="" messages={[assistant]} />)
    );
    fireEvent(screen.getByTestId("chat-dock"), "layout", {
      nativeEvent: { layout: { height: 180, width: 390, x: 0, y: 0 } },
    });
    const padding = StyleSheet.flatten(
      screen.getByTestId("chat-thread").props.contentContainerStyle
    ).paddingBottom;
    expect(padding).toBeGreaterThanOrEqual(180);
    unmount();
  });

  it("lifts the composer onto the keyboard and keeps the tail in reach", () => {
    const keyboardState = jest.requireMock("react-native-keyboard-controller")
      .useKeyboardState as jest.Mock;
    const resting = keyboardState.getMockImplementation();
    keyboardState.mockImplementation((select: (s: unknown) => unknown) =>
      select({ isVisible: true, height: 300 })
    );
    try {
      const { unmount } = render(
        wrap(<CiciroChat {...idle} composer="" bottomInset={96} messages={[assistant]} />)
      );
      fireEvent(screen.getByTestId("chat-dock"), "layout", {
        nativeEvent: { layout: { height: 180, width: 390, x: 0, y: 0 } },
      });
      // The tab bar's reserve is handed back, so the dock rests on the keyboard
      // rather than floating a bar's height above it.
      expect(screen.getByTestId("chat-dock").props.offset).toEqual({ closed: 0, opened: 86 });
      const padding = StyleSheet.flatten(
        screen.getByTestId("chat-thread").props.contentContainerStyle
      ).paddingBottom;
      expect(padding).toBe(180 + (300 + 10 - 96) + 16);
      unmount();
    } finally {
      keyboardState.mockImplementation(resting);
    }
  });

  it("renders a reply's markdown as formatting, not as stray markers", () => {
    const { unmount } = render(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          messages={[
            {
              ...assistant,
              id: "m3",
              content: "## Notes\n\nThe **opening** drags.\n\n- cut the weather",
            },
          ]}
        />
      )
    );
    expect(screen.getByText("Notes")).toBeTruthy();
    expect(screen.getByText("opening")).toBeTruthy();
    expect(screen.getByText("cut the weather")).toBeTruthy();
    expect(screen.queryByText(/\*\*opening\*\*/)).toBeNull();
    unmount();
  });

  it("turns a failed run's footer into a readable notice, not raw provider JSON", () => {
    const { unmount } = render(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          messages={[
            {
              ...assistant,
              id: "m4",
              content: `Here is the passage.\n\n[Ciciro error: ${AUTH_FOOTER}]`,
            },
          ]}
        />
      )
    );
    expect(screen.getByText("Here is the passage.")).toBeTruthy();
    expect(screen.queryByText(/authentication_error/)).toBeNull();
    expect(
      screen.getByText(
        "Ciciro could not reach the writing model — the server's API key was rejected. This needs a fix on the server, not another try."
      )
    ).toBeTruthy();
    // A rejected key will not fix itself, so retry is withheld.
    expect(screen.queryByLabelText("Try again")).toBeNull();

    // The provider's own words stay available behind the disclosure.
    fireEvent.press(screen.getByLabelText("Details"));
    expect(screen.getByText("API key is invalid.")).toBeTruthy();
    unmount();
  });

  it("offers Try again when the failure is transient", () => {
    const onRetry = jest.fn();
    const { unmount } = render(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          onRetry={onRetry}
          failure={classifyChatFailure("Network request failed")}
        />
      )
    );
    fireEvent.press(screen.getByLabelText("Try again"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("surfaces open questions above the thread", () => {
    const onOpenQuestions = jest.fn();
    const { unmount } = render(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          openQuestionCount={2}
          onOpenQuestions={onOpenQuestions}
        />
      )
    );
    fireEvent.press(screen.getByLabelText("Ciciro has 2 open questions"));
    expect(onOpenQuestions).toHaveBeenCalledTimes(1);
    unmount();
  });

  describe("clearing", () => {
    /** Press Clear and take the destructive button in the confirm alert. */
    function confirmClear() {
      const alert = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => {
        buttons?.find((button) => button.style === "destructive")?.onPress?.();
      });
      fireEvent.press(screen.getByLabelText("Clear chat"));
      alert.mockRestore();
    }

    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("collapses the thread, then offers Undo with the stamp the clear returned", async () => {
      const onClear = jest.fn(async () => "2026-09-14T00:00:00.000Z");
      const onUndoClear = jest.fn();
      const { unmount } = render(
        wrap(
          <CiciroChat
            {...idle}
            composer=""
            messages={[assistant]}
            onClear={onClear}
            onUndoClear={onUndoClear}
          />
        )
      );

      confirmClear();
      expect(onClear).toHaveBeenCalledTimes(1);
      // Undo is not offered while the thread is still falling.
      expect(screen.queryByLabelText("Undo")).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(CLEAR_TIMING.collapseMs + CLEAR_TIMING.settleMs + 10);
      });
      await waitFor(() => expect(screen.getByLabelText("Undo")).toBeTruthy());
      expect(screen.getByText("Chat cleared.")).toBeTruthy();

      fireEvent.press(screen.getByLabelText("Undo"));
      expect(onUndoClear).toHaveBeenCalledWith("2026-09-14T00:00:00.000Z");
      expect(screen.queryByLabelText("Undo")).toBeNull();
      unmount();
    });

    it("withdraws the offer once it has stood long enough", async () => {
      const { unmount } = render(
        wrap(
          <CiciroChat
            {...idle}
            composer=""
            messages={[assistant]}
            onClear={jest.fn(async () => "2026-09-14T00:00:00.000Z")}
          />
        )
      );
      confirmClear();
      await act(async () => {
        jest.advanceTimersByTime(CLEAR_TIMING.collapseMs + CLEAR_TIMING.settleMs + 10);
      });
      await waitFor(() => expect(screen.getByLabelText("Undo")).toBeTruthy());

      await act(async () => {
        jest.advanceTimersByTime(CLEAR_TIMING.offerMs + 10);
      });
      expect(screen.queryByLabelText("Undo")).toBeNull();
      unmount();
    });

    it("offers no Undo when the server archived nothing", async () => {
      const { unmount } = render(
        wrap(
          <CiciroChat
            {...idle}
            composer=""
            messages={[assistant]}
            onClear={jest.fn(async () => null)}
          />
        )
      );
      confirmClear();
      await act(async () => {
        jest.advanceTimersByTime(CLEAR_TIMING.collapseMs + CLEAR_TIMING.settleMs + 10);
      });
      expect(screen.queryByLabelText("Undo")).toBeNull();
      unmount();
    });

    it("puts the thread back when the clear request fails", async () => {
      const { unmount } = render(
        wrap(
          <CiciroChat
            {...idle}
            composer=""
            messages={[assistant]}
            onClear={jest.fn(async () => {
              throw new Error("offline");
            })}
          />
        )
      );
      confirmClear();
      await act(async () => {
        jest.advanceTimersByTime(CLEAR_TIMING.collapseMs + CLEAR_TIMING.settleMs + 10);
      });
      // The conversation is still on the server, so it stays on screen.
      expect(screen.getByText("A note.")).toBeTruthy();
      expect(screen.queryByLabelText("Undo")).toBeNull();
      unmount();
    });

    it("does not offer to clear an already empty conversation", () => {
      const onClear = jest.fn(async () => null);
      const { unmount } = render(
        wrap(<CiciroChat {...idle} composer="" messages={[]} onClear={onClear} />)
      );
      fireEvent.press(screen.getByLabelText("Clear chat"));
      expect(onClear).not.toHaveBeenCalled();
      unmount();
    });
  });

  it("shows the thinking mark while a reply is still forming", () => {
    const { rerender, unmount } = render(
      wrap(<CiciroChat {...idle} composer="" streaming phase="running" />)
    );
    expect(screen.getByLabelText("Working")).toBeTruthy();

    // Once prose arrives the mark gives way to the words themselves.
    rerender(
      wrap(
        <CiciroChat
          {...idle}
          composer=""
          streaming
          phase="running"
          stream={{ ...emptyChatStreamState(), text: "She opened the door." }}
        />
      )
    );
    expect(screen.queryByLabelText("Working")).toBeNull();
    expect(screen.getByText("She opened the door.")).toBeTruthy();
    unmount();
  });

  function scrollThread(distanceFromBottom: number, layoutHeight = 600) {
    const contentHeight = distanceFromBottom + layoutHeight;
    fireEvent.scroll(screen.getByTestId("chat-thread"), {
      nativeEvent: {
        contentOffset: { y: 0, x: 0 },
        contentSize: { height: contentHeight, width: 400 },
        layoutMeasurement: { height: layoutHeight, width: 400 },
      },
    });
  }

  it("fades the jump chip in only after two screens above the latest reply", () => {
    const { unmount } = render(
      wrap(<CiciroChat {...idle} composer="" messages={[assistant]} />)
    );
    expect(screen.queryByLabelText("Scroll to latest")).toBeNull();

    scrollThread(600);
    expect(screen.queryByLabelText("Scroll to latest")).toBeNull();

    scrollThread(1200);
    expect(screen.queryByLabelText("Scroll to latest")).toBeNull();

    scrollThread(1200 + 300);
    expect(screen.getByLabelText("Scroll to latest")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Scroll to latest"));
    expect(screen.queryByLabelText("Scroll to latest")).toBeNull();
    unmount();
  });
});
